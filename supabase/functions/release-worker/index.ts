import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";
import { updateCheckRun } from "../_shared/github.ts";
import { json, options, stableError } from "../_shared/http.ts";
import {
  decideRelease,
  type PlanningCapability,
} from "../_shared/release-planning.ts";

const inputSchema = z.object({
  release_id: z.string().uuid(),
  attempt: z.number().int().positive().default(1),
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return options(request);
  if (request.method !== "POST") {
    return json(request, 405, {
      error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." },
    });
  }
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (
    !serviceRoleKey ||
    !supabaseUrl ||
    request.headers.get("authorization") !== `Bearer ${serviceRoleKey}`
  ) {
    return json(request, 403, {
      error: { code: "FORBIDDEN", message: "Internal authorization required." },
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let releaseId: string | undefined;
  try {
    const input = inputSchema.parse(await request.json());
    releaseId = input.release_id;
    const existingDecision = await admin
      .from("release_decisions")
      .select("id, status, summary")
      .eq("release_id", input.release_id)
      .eq("attempt", input.attempt)
      .maybeSingle();
    if (existingDecision.error) throw existingDecision.error;
    if (existingDecision.data) {
      return json(request, 200, {
        data: existingDecision.data,
        idempotent_replay: true,
      });
    }

    const releaseResult = await admin
      .from("releases")
      .select("*")
      .eq("id", input.release_id)
      .maybeSingle();
    if (releaseResult.error || !releaseResult.data) {
      throw new Error("Release not found");
    }
    const release = releaseResult.data;
    if (!release.github_installation_id || !release.check_run_id) {
      throw new Error("Release GitHub check is not configured");
    }
    const installationResult = await admin
      .from("github_installations")
      .select("installation_id, status")
      .eq("id", release.github_installation_id)
      .eq("workspace_id", release.workspace_id)
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

    await updateCheckRun({
      installationId: installation.installation_id,
      repositoryFullName: release.repository_full_name,
      checkRunId: release.check_run_id,
      status: "in_progress",
      title: "Running tenant compatibility checks",
      summary:
        "CanaryGrid selected representative customer configurations and is running API journeys.",
      detailsUrl,
    });
    const running = await admin
      .from("releases")
      .update({ status: "running", completed_at: null })
      .eq("id", release.id)
      .eq("workspace_id", release.workspace_id);
    if (running.error) throw running.error;

    const [capabilityLinks, archetypeLinks, journeysResult] = await Promise.all(
      [
        admin
          .from("release_capabilities")
          .select("capability_id, capabilities(id, name, criticality)")
          .eq("release_id", release.id)
          .eq("workspace_id", release.workspace_id),
        admin
          .from("release_archetype_selections")
          .select("archetype_id")
          .eq("release_id", release.id)
          .eq("workspace_id", release.workspace_id),
        admin
          .from("journeys")
          .select("id, name, journey_capabilities(capability_id)")
          .eq("workspace_id", release.workspace_id)
          .eq("active", true),
      ],
    );
    if (capabilityLinks.error || archetypeLinks.error || journeysResult.error) {
      throw capabilityLinks.error ?? archetypeLinks.error ??
        journeysResult.error;
    }

    const affectedCapabilities = (capabilityLinks.data ?? [])
      .map((link) => link.capabilities)
      .filter(Boolean) as unknown as PlanningCapability[];
    const affectedIds = new Set(
      (capabilityLinks.data ?? []).map((link) => link.capability_id),
    );
    const journeyCapabilityMap = new Map<string, Set<string>>();
    for (const journey of journeysResult.data ?? []) {
      journeyCapabilityMap.set(
        journey.id,
        new Set(
          journey.journey_capabilities
            .map((link) => link.capability_id)
            .filter((id) => affectedIds.has(id)),
        ),
      );
    }
    const missingJourneyCapabilityIds = [...affectedIds].filter((
      capabilityId,
    ) =>
      ![...journeyCapabilityMap.values()].some((ids) => ids.has(capabilityId))
    );

    const archetypeIds = (archetypeLinks.data ?? []).map((item) =>
      item.archetype_id
    );
    const archetypeCoverage = archetypeIds.length
      ? await admin
        .from("archetype_capabilities")
        .select("archetype_id, capability_id")
        .eq("workspace_id", release.workspace_id)
        .in("archetype_id", archetypeIds)
      : { data: [], error: null };
    if (archetypeCoverage.error) throw archetypeCoverage.error;
    const coveredByArchetype = new Map<string, Set<string>>();
    for (const link of archetypeCoverage.data ?? []) {
      const ids = coveredByArchetype.get(link.archetype_id) ??
        new Set<string>();
      ids.add(link.capability_id);
      coveredByArchetype.set(link.archetype_id, ids);
    }

    const jobs: Array<{ journeyId: string; archetypeId: string }> = [];
    for (const journey of journeysResult.data ?? []) {
      const journeyCapabilityIds = journeyCapabilityMap.get(journey.id) ??
        new Set();
      if (!journeyCapabilityIds.size) continue;
      for (const archetypeId of archetypeIds) {
        const archetypeCapabilityIds = coveredByArchetype.get(archetypeId) ??
          new Set<string>();
        if (
          [...journeyCapabilityIds].some((id) => archetypeCapabilityIds.has(id))
        ) {
          jobs.push({ journeyId: journey.id, archetypeId });
        }
      }
    }

    const runResults = await Promise.all(
      jobs.map(async (job) => {
        const response = await fetch(
          `${supabaseUrl}/functions/v1/journey-run`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${serviceRoleKey}`,
              apikey: serviceRoleKey,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              workspace_id: release.workspace_id,
              release_id: release.id,
              journey_id: job.journeyId,
              archetype_id: job.archetypeId,
              idempotency_key:
                `release:${release.id}:attempt:${input.attempt}:journey:${job.journeyId}:archetype:${job.archetypeId}`,
            }),
          },
        );
        if (!response.ok) return { id: null, status: "error" };
        const body = await response.json();
        return {
          id: typeof body?.data?.id === "string" ? body.data.id : null,
          status: typeof body?.data?.status === "string"
            ? body.data.status
            : "error",
        };
      }),
    );

    const uncoveredIds = await uncoveredCapabilityIds(
      admin,
      release.id,
      release.workspace_id,
    );
    const uncoveredResult = uncoveredIds.length
      ? await admin
        .from("capabilities")
        .select("id, name, criticality")
        .eq("workspace_id", release.workspace_id)
        .in("id", uncoveredIds)
      : { data: [], error: null };
    if (uncoveredResult.error) throw uncoveredResult.error;
    const uncovered = (uncoveredResult.data ?? []) as PlanningCapability[];
    const decision = decideRelease({
      runStatuses: runResults.map((run) => run.status),
      uncoveredCapabilities: uncovered,
      missingJourneyCapabilityIds,
    });
    const summary = [
      `${
        runResults.filter((run) => run.status === "passed").length
      } of ${runResults.length} required runs passed.`,
      ...decision.reasons,
    ].join(" ");
    const decisionInsert = await admin
      .from("release_decisions")
      .insert({
        workspace_id: release.workspace_id,
        release_id: release.id,
        attempt: input.attempt,
        commit_sha: release.commit_sha,
        status: decision.status,
        summary,
        reasons: decision.reasons,
        run_ids: runResults.flatMap((run) => (run.id ? [run.id] : [])),
        uncovered_capability_ids: uncovered.map((capability) => capability.id),
      })
      .select("id")
      .single();
    if (decisionInsert.error) {
      if (decisionInsert.error.code === "23505") {
        const replay = await admin
          .from("release_decisions")
          .select("id, status, summary")
          .eq("release_id", release.id)
          .eq("attempt", input.attempt)
          .single();
        if (!replay.error) {
          return json(request, 200, {
            data: replay.data,
            idempotent_replay: true,
          });
        }
      }
      throw decisionInsert.error;
    }

    await updateCheckRun({
      installationId: installation.installation_id,
      repositoryFullName: release.repository_full_name,
      checkRunId: release.check_run_id,
      status: "completed",
      conclusion: decision.status === "passed" ? "success" : "failure",
      title: decision.status === "passed"
        ? "Tenant compatibility checks passed"
        : "Tenant compatibility checks failed",
      summary,
      detailsUrl,
    });
    const completed = await admin
      .from("releases")
      .update({
        status: decision.status,
        completed_at: new Date().toISOString(),
      })
      .eq("id", release.id)
      .eq("workspace_id", release.workspace_id);
    if (completed.error) throw completed.error;
    await admin.from("audit_logs").insert({
      workspace_id: release.workspace_id,
      action: "release.decision_recorded",
      entity_type: "release",
      entity_id: release.id,
      metadata: {
        decision_id: decisionInsert.data.id,
        attempt: input.attempt,
        status: decision.status,
        run_count: runResults.length,
      },
    });
    return json(request, 200, {
      data: {
        id: decisionInsert.data.id,
        status: decision.status,
        summary,
      },
    });
  } catch (error) {
    if (releaseId) {
      await admin
        .from("releases")
        .update({ status: "error", completed_at: new Date().toISOString() })
        .eq("id", releaseId);
    }
    const stable = stableError(error);
    return json(request, stable.status, { error: stable });
  }
});

async function uncoveredCapabilityIds(
  admin: SupabaseClient,
  releaseId: string,
  workspaceId: string,
): Promise<string[]> {
  const [affected, selections] = await Promise.all([
    admin
      .from("release_capabilities")
      .select("capability_id")
      .eq("release_id", releaseId)
      .eq("workspace_id", workspaceId),
    admin
      .from("release_archetype_selections")
      .select("archetype_id")
      .eq("release_id", releaseId)
      .eq("workspace_id", workspaceId),
  ]);
  if (affected.error || selections.error) {
    throw affected.error ?? selections.error;
  }
  const affectedIds = (affected.data ?? []).map((item) => item.capability_id);
  const archetypeIds = (selections.data ?? []).map((item) => item.archetype_id);
  if (!affectedIds.length) return [];
  if (!archetypeIds.length) return affectedIds;
  const covered = await admin
    .from("archetype_capabilities")
    .select("capability_id")
    .eq("workspace_id", workspaceId)
    .in("archetype_id", archetypeIds)
    .in("capability_id", affectedIds);
  if (covered.error) throw covered.error;
  const coveredIds = new Set(
    (covered.data ?? []).map((item) => item.capability_id),
  );
  return affectedIds.filter((id) => !coveredIds.has(id));
}

function releaseDetailsUrl(releaseId: string): string {
  const appUrl = Deno.env.get("PUBLIC_APP_URL") ?? "http://localhost:8080";
  return `${appUrl.replace(/\/$/, "")}/releases/${releaseId}`;
}
