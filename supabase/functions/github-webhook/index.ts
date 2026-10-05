import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";
import {
  createCheckRun,
  listPullRequestFiles,
  verifyGitHubWebhook,
} from "../_shared/github.ts";
import { json } from "../_shared/http.ts";
import {
  impactedCapabilities,
  type PlanningArchetype,
  type PlanningCapability,
  selectReleaseArchetypes,
} from "../_shared/release-planning.ts";

const allowedEvents = new Set([
  "installation",
  "installation_repositories",
  "pull_request",
]);

const pullRequestSchema = z.object({
  action: z.enum(["opened", "synchronize", "reopened"]),
  installation: z.object({ id: z.number().int().positive() }),
  repository: z.object({
    id: z.number().int().positive(),
    full_name: z.string(),
  }),
  pull_request: z.object({
    number: z.number().int().positive(),
    title: z.string(),
    head: z.object({
      sha: z.string().regex(/^[0-9a-f]{7,40}$/),
      ref: z.string(),
    }),
    user: z.object({ login: z.string() }),
  }),
});

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json(request, 405, {
      error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." },
    });
  }
  const rawBody = await request.text();
  let signatureValid = false;
  try {
    signatureValid = await verifyGitHubWebhook(
      rawBody,
      request.headers.get("x-hub-signature-256"),
    );
  } catch {
    return json(request, 503, {
      error: {
        code: "GITHUB_NOT_CONFIGURED",
        message: "GitHub webhook verification is not configured.",
      },
    });
  }
  if (!signatureValid) {
    return json(request, 401, {
      error: {
        code: "INVALID_SIGNATURE",
        message: "Webhook signature is invalid.",
      },
    });
  }

  const deliveryId = request.headers.get("x-github-delivery");
  const eventName = request.headers.get("x-github-event");
  if (!deliveryId || !eventName) {
    return json(request, 400, {
      error: {
        code: "INVALID_WEBHOOK",
        message: "GitHub delivery headers are missing.",
      },
    });
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(request, 503, {
      error: {
        code: "SERVER_CONFIGURATION",
        message: "Server configuration is unavailable.",
      },
    });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(request, 400, {
      error: { code: "INVALID_JSON", message: "Webhook payload is invalid." },
    });
  }
  const installationId = installationIdFromPayload(payload);
  const delivery = await admin
    .from("webhook_deliveries")
    .insert({
      provider: "github",
      delivery_id: deliveryId,
      event_name: eventName,
      installation_id: installationId,
      status: "processing",
    })
    .select("id")
    .single();
  if (delivery.error?.code === "23505") {
    return json(request, 200, { data: { duplicate: true } });
  }
  if (delivery.error) {
    return json(request, 500, {
      error: {
        code: "DELIVERY_PERSISTENCE",
        message: "Could not record the webhook.",
      },
    });
  }

  try {
    if (!allowedEvents.has(eventName)) {
      await finishDelivery(admin, delivery.data.id, "ignored");
      return json(request, 200, { data: { ignored: true } });
    }
    if (eventName === "installation") {
      await handleInstallationEvent(admin, payload);
      await finishDelivery(admin, delivery.data.id, "completed");
      return json(request, 200, { data: { accepted: true } });
    }
    if (eventName === "installation_repositories") {
      await handleRepositoryEvent(admin, payload);
      await finishDelivery(admin, delivery.data.id, "completed");
      return json(request, 200, { data: { accepted: true } });
    }

    const parsed = pullRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const action = typeof payload.action === "string" ? payload.action : "";
      if (!["opened", "synchronize", "reopened"].includes(action)) {
        await finishDelivery(admin, delivery.data.id, "ignored");
        return json(request, 200, { data: { ignored: true } });
      }
      throw new Error("Pull request webhook payload is invalid");
    }
    const result = await planPullRequest(admin, parsed.data);
    await finishDelivery(admin, delivery.data.id, "completed");

    const worker = fetch(`${supabaseUrl}/functions/v1/release-worker`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        release_id: result.releaseId,
        attempt: result.attempt,
      }),
    }).then(async (response) => {
      if (!response.ok) {
        await admin
          .from("releases")
          .update({ status: "error", completed_at: new Date().toISOString() })
          .eq("id", result.releaseId);
      }
    });
    const edgeRuntime = (
      globalThis as typeof globalThis & {
        EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
      }
    ).EdgeRuntime;
    if (edgeRuntime) edgeRuntime.waitUntil(worker);
    else await worker;

    return json(request, 202, {
      data: { release_id: result.releaseId, status: "planning" },
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Webhook processing failed";
    await finishDelivery(
      admin,
      delivery.data.id,
      "failed",
      classifyWebhookError(message),
    );
    return json(request, 500, {
      error: {
        code: classifyWebhookError(message),
        message: "GitHub event processing failed safely.",
      },
    });
  }
});

async function planPullRequest(
  admin: SupabaseClient,
  payload: z.infer<typeof pullRequestSchema>,
) {
  const installation = await admin
    .from("github_installations")
    .select("id, workspace_id, installation_id, status")
    .eq("installation_id", payload.installation.id)
    .maybeSingle();
  if (
    installation.error ||
    !installation.data ||
    installation.data.status !== "active"
  ) {
    throw new Error("GitHub installation is not active or bound");
  }
  const binding = installation.data;
  const repository = await admin
    .from("github_installation_repositories")
    .select("id")
    .eq("workspace_id", binding.workspace_id)
    .eq("github_installation_id", binding.id)
    .eq("repository_id", payload.repository.id)
    .eq("repository_full_name", payload.repository.full_name)
    .eq("active", true)
    .maybeSingle();
  if (repository.error || !repository.data) {
    throw new Error("GitHub repository is not bound to this workspace");
  }

  const files = await listPullRequestFiles({
    installationId: binding.installation_id,
    repositoryFullName: payload.repository.full_name,
    pullNumber: payload.pull_request.number,
  });
  const releaseResult = await admin
    .from("releases")
    .upsert(
      {
        workspace_id: binding.workspace_id,
        github_installation_id: binding.id,
        repository_full_name: payload.repository.full_name,
        pull_request_number: payload.pull_request.number,
        commit_sha: payload.pull_request.head.sha,
        ref: payload.pull_request.head.ref,
        title: payload.pull_request.title,
        author_login: payload.pull_request.user.login,
        status: "planning",
        completed_at: null,
      },
      { onConflict: "workspace_id,repository_full_name,commit_sha" },
    )
    .select("id")
    .single();
  if (releaseResult.error) throw releaseResult.error;
  const releaseId = releaseResult.data.id;

  const [capabilitiesResult, rulesResult, archetypesResult, archetypeLinks] =
    await Promise.all([
      admin
        .from("capabilities")
        .select("id, name, criticality")
        .eq("workspace_id", binding.workspace_id)
        .eq("active", true),
      admin
        .from("capability_path_rules")
        .select("capability_id, glob_pattern")
        .eq("workspace_id", binding.workspace_id),
      admin
        .from("tenant_archetypes")
        .select("id, name, risk_weight")
        .eq("workspace_id", binding.workspace_id)
        .eq("active", true)
        .is("archived_at", null),
      admin
        .from("archetype_capabilities")
        .select("archetype_id, capability_id")
        .eq("workspace_id", binding.workspace_id),
    ]);
  const loadError = capabilitiesResult.error ??
    rulesResult.error ??
    archetypesResult.error ??
    archetypeLinks.error;
  if (loadError) throw loadError;

  const capabilities = (capabilitiesResult.data ?? []).map((capability) => ({
    id: capability.id,
    name: capability.name,
    criticality: capability.criticality,
    globs: (rulesResult.data ?? [])
      .filter((rule) => rule.capability_id === capability.id)
      .map((rule) => rule.glob_pattern),
  })) as PlanningCapability[];
  const impacted = impactedCapabilities(
    files.map((file) => file.filename),
    capabilities,
  );
  const archetypes = (archetypesResult.data ?? []).map((archetype) => ({
    id: archetype.id,
    name: archetype.name,
    riskWeight: archetype.risk_weight,
    capabilityIds: (archetypeLinks.data ?? [])
      .filter((link) => link.archetype_id === archetype.id)
      .map((link) => link.capability_id),
  })) as PlanningArchetype[];
  const selection = selectReleaseArchetypes(impacted, archetypes);

  const cleared = await Promise.all([
    admin.from("release_changed_files").delete().eq("release_id", releaseId),
    admin.from("release_capabilities").delete().eq("release_id", releaseId),
    admin.from("release_archetype_selections").delete().eq(
      "release_id",
      releaseId,
    ),
  ]);
  const clearError = cleared.find((result) => result.error)?.error;
  if (clearError) throw clearError;
  if (files.length) {
    const saved = await admin.from("release_changed_files").insert(
      files.map((file) => ({
        workspace_id: binding.workspace_id,
        release_id: releaseId,
        path: file.filename,
        additions: file.additions,
        deletions: file.deletions,
        status: file.status,
      })),
    );
    if (saved.error) throw saved.error;
  }
  if (impacted.length) {
    const saved = await admin.from("release_capabilities").insert(
      impacted.map((capability) => ({
        workspace_id: binding.workspace_id,
        release_id: releaseId,
        capability_id: capability.id,
        reason: "Repository path rule matched a changed file.",
      })),
    );
    if (saved.error) throw saved.error;
  }
  if (selection.selected.length) {
    const saved = await admin.from("release_archetype_selections").insert(
      selection.selected.map((selected) => ({
        workspace_id: binding.workspace_id,
        release_id: releaseId,
        archetype_id: selected.archetype.id,
        archetype_name: selected.archetype.name,
        selection_reason:
          `Covers ${selected.newlyCoveredIds.length} newly affected capabilities with weighted benefit ${selected.weightedBenefit}.`,
        coverage_score: impacted.length === 0
          ? 1
          : selected.newlyCoveredIds.length / impacted.length,
      })),
    );
    if (saved.error) throw saved.error;
  }

  const previousDecisions = await admin
    .from("release_decisions")
    .select("attempt", { count: "exact", head: true })
    .eq("release_id", releaseId);
  if (previousDecisions.error) throw previousDecisions.error;
  const attempt = (previousDecisions.count ?? 0) + 1;
  const checkRunId = await createCheckRun({
    installationId: binding.installation_id,
    repositoryFullName: payload.repository.full_name,
    sha: payload.pull_request.head.sha,
    detailsUrl: releaseDetailsUrl(releaseId),
  });
  const checkSaved = await admin
    .from("releases")
    .update({ check_run_id: checkRunId, status: "planning" })
    .eq("id", releaseId)
    .eq("workspace_id", binding.workspace_id);
  if (checkSaved.error) throw checkSaved.error;
  await admin.from("audit_logs").insert({
    workspace_id: binding.workspace_id,
    action: "release.planned",
    entity_type: "release",
    entity_id: releaseId,
    metadata: {
      attempt,
      changed_file_count: files.length,
      impacted_capability_count: impacted.length,
      selected_archetype_count: selection.selected.length,
      uncovered_capability_ids: selection.uncovered,
    },
  });
  return { releaseId, attempt };
}

async function handleInstallationEvent(
  admin: SupabaseClient,
  payload: Record<string, unknown>,
) {
  const installationId = installationIdFromPayload(payload);
  if (!installationId) throw new Error("Installation payload is invalid");
  const action = typeof payload.action === "string" ? payload.action : "";
  const status = action === "deleted"
    ? "removed"
    : action === "suspend"
    ? "suspended"
    : action === "unsuspend"
    ? "active"
    : null;
  if (!status) return;
  const result = await admin
    .from("github_installations")
    .update({ status })
    .eq("installation_id", installationId)
    .select("id, workspace_id");
  if (result.error) throw result.error;
  if (status !== "active") {
    for (const binding of result.data ?? []) {
      await admin
        .from("github_installation_repositories")
        .update({ active: false })
        .eq("github_installation_id", binding.id)
        .eq("workspace_id", binding.workspace_id);
    }
  }
}

async function handleRepositoryEvent(
  admin: SupabaseClient,
  payload: Record<string, unknown>,
) {
  const installationId = installationIdFromPayload(payload);
  if (!installationId) {
    throw new Error("Installation repository payload is invalid");
  }
  const installation = await admin
    .from("github_installations")
    .select("id, workspace_id")
    .eq("installation_id", installationId)
    .maybeSingle();
  if (installation.error) throw installation.error;
  if (!installation.data) return;
  const binding = installation.data;
  const added = Array.isArray(payload.repositories_added)
    ? payload.repositories_added
    : [];
  const removed = Array.isArray(payload.repositories_removed)
    ? payload.repositories_removed
    : [];
  for (const repository of added) {
    const parsed = repositorySchema.safeParse(repository);
    if (!parsed.success) continue;
    const saved = await admin
      .from("github_installation_repositories")
      .upsert(
        {
          workspace_id: binding.workspace_id,
          github_installation_id: binding.id,
          repository_id: parsed.data.id,
          owner_login: parsed.data.full_name.split("/")[0]!,
          repository_name: parsed.data.name,
          repository_full_name: parsed.data.full_name,
          default_branch: parsed.data.default_branch ?? "main",
          active: true,
        },
        { onConflict: "github_installation_id,repository_id" },
      );
    if (saved.error) throw saved.error;
  }
  const removedIds = removed.flatMap((repository) => {
    const parsed = repositorySchema.safeParse(repository);
    return parsed.success ? [parsed.data.id] : [];
  });
  if (removedIds.length) {
    const changed = await admin
      .from("github_installation_repositories")
      .update({ active: false })
      .eq("github_installation_id", binding.id)
      .in("repository_id", removedIds);
    if (changed.error) throw changed.error;
  }
}

const repositorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string().optional(),
});

function installationIdFromPayload(
  payload: Record<string, unknown>,
): number | null {
  const installation = payload.installation;
  if (
    typeof installation === "object" &&
    installation !== null &&
    "id" in installation &&
    typeof installation.id === "number"
  ) {
    return installation.id;
  }
  return null;
}

async function finishDelivery(
  admin: SupabaseClient,
  id: string,
  status: "completed" | "ignored" | "failed",
  errorCode?: string,
) {
  await admin
    .from("webhook_deliveries")
    .update({
      status,
      error_code: errorCode ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);
}

function classifyWebhookError(message: string): string {
  if (/rate limit/i.test(message)) return "GITHUB_RATE_LIMIT";
  if (/not active|suspend/i.test(message)) return "INSTALLATION_INACTIVE";
  if (/not bound/i.test(message)) return "REPOSITORY_NOT_BOUND";
  if (/not found/i.test(message)) return "GITHUB_NOT_FOUND";
  return "WEBHOOK_PROCESSING_FAILED";
}

function releaseDetailsUrl(releaseId: string): string {
  const appUrl = Deno.env.get("PUBLIC_APP_URL") ?? "http://localhost:8080";
  return `${appUrl.replace(/\/$/, "")}/releases/${releaseId}`;
}
