import { z } from "npm:zod@3.25.76";
import { requireWorkspaceRole } from "../_shared/auth.ts";
import { createCheckRun, updateCheckRun } from "../_shared/github.ts";
import { json, options, stableError } from "../_shared/http.ts";

const inputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("rerun"),
    workspace_id: z.string().uuid(),
    release_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("waive"),
    workspace_id: z.string().uuid(),
    release_id: z.string().uuid(),
    decision_id: z.string().uuid(),
    failure_cluster_id: z.string().uuid().nullable().optional(),
    scope: z.string().trim().min(2).max(200),
    reason: z.string().trim().min(10).max(2000),
    expires_at: z.string().datetime().nullable().optional(),
  }),
]);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return options(request);
  if (request.method !== "POST") {
    return json(request, 405, {
      error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." },
    });
  }
  try {
    const input = inputSchema.parse(await request.json());
    const minimumRole = input.action === "waive" ? "admin" : "engineer";
    const { admin, user } = await requireWorkspaceRole(
      request,
      input.workspace_id,
      minimumRole,
    );
    const releaseResult = await admin
      .from("releases")
      .select("*")
      .eq("id", input.release_id)
      .eq("workspace_id", input.workspace_id)
      .maybeSingle();
    if (releaseResult.error || !releaseResult.data) {
      throw new Error("Release not found");
    }
    const release = releaseResult.data;
    if (!release.github_installation_id) {
      throw new Error("GitHub installation not found");
    }
    const installationResult = await admin
      .from("github_installations")
      .select("installation_id, status")
      .eq("id", release.github_installation_id)
      .eq("workspace_id", input.workspace_id)
      .maybeSingle();
    if (
      installationResult.error ||
      !installationResult.data ||
      installationResult.data.status !== "active"
    ) {
      throw new Error("GitHub installation is not active");
    }
    const installation = installationResult.data;
    const detailsUrl = releaseDetailsUrl(release.id);

    if (input.action === "waive") {
      const latest = await admin
        .from("release_decisions")
        .select("id, status, commit_sha, summary")
        .eq("release_id", release.id)
        .eq("workspace_id", input.workspace_id)
        .order("attempt", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (
        latest.error ||
        !latest.data ||
        latest.data.id !== input.decision_id ||
        latest.data.status !== "failed" ||
        latest.data.commit_sha !== release.commit_sha
      ) {
        throw new Error("Only the latest failed decision can be waived");
      }
      const existingWaiver = await admin
        .from("waivers")
        .select("id, created_at, reason, approved_by")
        .eq("release_decision_id", latest.data.id)
        .eq("scope", input.scope)
        .maybeSingle();
      if (existingWaiver.error) throw existingWaiver.error;
      if (
        existingWaiver.data &&
        (existingWaiver.data.reason !== input.reason ||
          existingWaiver.data.approved_by !== user.id)
      ) {
        throw new Error("This decision scope already has an immutable waiver");
      }
      const waiver = existingWaiver.data
        ? { data: existingWaiver.data, error: null }
        : await admin
          .from("waivers")
          .insert({
            workspace_id: input.workspace_id,
            release_id: release.id,
            release_decision_id: latest.data.id,
            failure_cluster_id: input.failure_cluster_id ?? null,
            scope: input.scope,
            reason: input.reason,
            expires_at: input.expires_at ?? null,
            approved_by: user.id,
          })
          .select("id, created_at")
          .single();
      if (waiver.error || !waiver.data) {
        throw waiver.error ?? new Error("Waiver could not be recorded");
      }
      const summary =
        `Original decision: ${latest.data.summary}\n\nWaived by an authorized workspace administrator. Scope: ${input.scope}. Reason: ${input.reason}`;
      const changed = await admin
        .from("releases")
        .update({ status: "waived", completed_at: new Date().toISOString() })
        .eq("id", release.id)
        .eq("workspace_id", input.workspace_id);
      if (changed.error) throw changed.error;
      if (release.check_run_id) {
        try {
          await updateCheckRun({
            installationId: installation.installation_id,
            repositoryFullName: release.repository_full_name,
            checkRunId: release.check_run_id,
            status: "completed",
            conclusion: "success",
            title: "Tenant compatibility failure waived",
            summary,
            detailsUrl,
          });
        } catch (error) {
          await admin.from("audit_logs").insert({
            workspace_id: input.workspace_id,
            actor_user_id: user.id,
            action: "github.check_sync_failed",
            entity_type: "release",
            entity_id: release.id,
            metadata: { operation: "waiver" },
          });
          throw error;
        }
      }
      await admin.from("audit_logs").insert({
        workspace_id: input.workspace_id,
        actor_user_id: user.id,
        action: "release.waiver_created",
        entity_type: "waiver",
        entity_id: waiver.data.id,
        metadata: {
          release_id: release.id,
          decision_id: latest.data.id,
          scope: input.scope,
        },
      });
      return json(request, 200, { data: waiver.data });
    }

    const reserved = await admin
      .from("releases")
      .update({ status: "planning", completed_at: null })
      .eq("id", release.id)
      .eq("workspace_id", input.workspace_id)
      .in("status", ["passed", "failed", "waived", "error"])
      .select("id")
      .maybeSingle();
    if (reserved.error) throw reserved.error;
    if (!reserved.data) {
      throw new Error("A release evaluation is already in progress");
    }

    const previous = await admin
      .from("release_decisions")
      .select("attempt", { count: "exact", head: true })
      .eq("release_id", release.id);
    if (previous.error) throw previous.error;
    const attempt = (previous.count ?? 0) + 1;
    try {
      const checkRunId = await createCheckRun({
        installationId: installation.installation_id,
        repositoryFullName: release.repository_full_name,
        sha: release.commit_sha,
        detailsUrl,
      });
      const checkSaved = await admin
        .from("releases")
        .update({ check_run_id: checkRunId })
        .eq("id", release.id)
        .eq("workspace_id", input.workspace_id);
      if (checkSaved.error) throw checkSaved.error;

      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const response = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/release-worker`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${serviceRoleKey}`,
            apikey: serviceRoleKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({ release_id: release.id, attempt }),
        },
      );
      if (!response.ok) throw new Error("Release worker could not start");
      await admin.from("audit_logs").insert({
        workspace_id: input.workspace_id,
        actor_user_id: user.id,
        action: "release.rerun_requested",
        entity_type: "release",
        entity_id: release.id,
        metadata: { attempt },
      });
      return json(request, 202, {
        data: { release_id: release.id, attempt, status: "planning" },
      });
    } catch (error) {
      await admin
        .from("releases")
        .update({ status: "error", completed_at: new Date().toISOString() })
        .eq("id", release.id)
        .eq("workspace_id", input.workspace_id);
      throw error;
    }
  } catch (error) {
    const stable = stableError(error);
    return json(request, stable.status, { error: stable });
  }
});

function releaseDetailsUrl(releaseId: string): string {
  const appUrl = Deno.env.get("PUBLIC_APP_URL") ?? "http://localhost:8080";
  return `${appUrl.replace(/\/$/, "")}/releases/${releaseId}`;
}
