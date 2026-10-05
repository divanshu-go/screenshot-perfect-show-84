import { z } from "npm:zod@3.25.76";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireWorkspaceRole } from "../_shared/auth.ts";
import { decryptCredential } from "../_shared/crypto.ts";
import { json, options, stableError } from "../_shared/http.ts";
import { safeFetch, validateOutboundUrl } from "../_shared/network.ts";
import {
  boundedEvidence,
  evaluateAssertion,
  type ExtractionRule,
  extractValues,
  type JourneyAssertion,
  redactEvidence,
  renderTemplate,
} from "../../../src/lib/journey-domain.ts";

const payloadSchema = z.object({
  workspace_id: z.string().uuid(),
  journey_id: z.string().uuid(),
  archetype_id: z.string().uuid(),
  release_id: z.string().uuid().nullable().optional(),
  idempotency_key: z.string().min(8).max(200),
});

type AdminClient = Awaited<ReturnType<typeof requireWorkspaceRole>>["admin"];
type StepRow = {
  id: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  path_template: string;
  request_headers: unknown;
  request_body: unknown;
  extraction_rules: unknown;
  continue_on_failure: boolean;
  is_cleanup: boolean;
  position: number;
  journey_assertions: Array<{
    id: string;
    assertion_type: JourneyAssertion["assertion_type"];
    target: string | null;
    operator: string;
    expected_value: unknown;
  }>;
};

type StepOutcome = {
  status: "passed" | "failed" | "error" | "skipped";
  errorCode?: string;
  errorMessage?: string;
  fingerprint?: string;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return options(request);
  if (request.method !== "POST") {
    return json(request, 405, {
      error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." },
    });
  }

  const correlationId = crypto.randomUUID();
  let runId: string | undefined;
  const startedAt = Date.now();
  try {
    const payload = payloadSchema.parse(await request.json());
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const internal = serviceRoleKey &&
      request.headers.get("authorization") === `Bearer ${serviceRoleKey}`;
    const context = internal
      ? {
        admin: createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        }),
        actorId: null,
      }
      : await requireWorkspaceRole(request, payload.workspace_id, "engineer")
        .then(({ admin, user }) => ({ admin, actorId: user.id }));
    const { admin } = context;

    const existing = await admin
      .from("runs")
      .select("id, status, created_at")
      .eq("workspace_id", payload.workspace_id)
      .eq("idempotency_key", payload.idempotency_key)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      return json(request, 200, {
        data: existing.data,
        idempotent_replay: true,
      });
    }

    if (context.actorId) {
      await enforceRateLimit(admin, payload.workspace_id, context.actorId);
    }
    const loaded = await loadRunConfiguration(admin, payload);

    const created = await admin
      .from("runs")
      .insert({
        workspace_id: payload.workspace_id,
        release_id: payload.release_id ?? null,
        journey_id: payload.journey_id,
        archetype_id: payload.archetype_id,
        journey_name: loaded.journey.name,
        archetype_name: loaded.archetype.name,
        triggered_by: context.actorId,
        trigger_type: payload.release_id ? "pull_request" : "manual",
        status: "running",
        idempotency_key: payload.idempotency_key,
        correlation_id: correlationId,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (created.error) {
      if (created.error.code === "23505") {
        const replay = await admin
          .from("runs")
          .select("id, status, created_at")
          .eq("workspace_id", payload.workspace_id)
          .eq("idempotency_key", payload.idempotency_key)
          .single();
        if (!replay.error) {
          return json(request, 200, {
            data: replay.data,
            idempotent_replay: true,
          });
        }
      }
      throw created.error;
    }
    const activeRunId = created.data.id;
    runId = activeRunId;

    const secrets = loaded.credential
      ? await decryptCredential(loaded.credential.encrypted_payload)
      : {};
    const variables: Record<string, unknown> = {
      credential: secrets,
      archetype: {
        id: loaded.archetype.id,
        name: loaded.archetype.name,
        region: loaded.archetype.region,
        auth_mode: loaded.archetype.auth_mode,
        permission_profile: loaded.archetype.permission_profile,
        metadata: loaded.archetype.metadata,
      },
    };
    const configuredSecretValues = Object.values(secrets);
    const primary = loaded.steps.filter((step) => !step.is_cleanup);
    const cleanup = loaded.steps.filter((step) => step.is_cleanup);
    const outcomes: StepOutcome[] = [];
    let stopPrimary = false;

    for (const step of primary) {
      if (stopPrimary) {
        await persistSkippedStep(
          admin,
          activeRunId,
          payload.workspace_id,
          step,
        );
        outcomes.push({ status: "skipped" });
        continue;
      }
      const outcome = await executeStep({
        admin,
        runId: activeRunId,
        workspaceId: payload.workspace_id,
        step,
        baseUrl: loaded.integration.base_url,
        allowedHosts: loaded.allowedHosts,
        variables,
        configuredSecretValues,
        deadline: startedAt + loaded.journey.timeout_ms,
      });
      outcomes.push(outcome);
      if (outcome.status !== "passed" && !step.continue_on_failure) {
        stopPrimary = true;
      }
    }

    for (const step of cleanup) {
      const outcome = await executeStep({
        admin,
        runId: activeRunId,
        workspaceId: payload.workspace_id,
        step,
        baseUrl: loaded.integration.base_url,
        allowedHosts: loaded.allowedHosts,
        variables,
        configuredSecretValues,
        deadline: startedAt + loaded.journey.timeout_ms,
      });
      outcomes.push(outcome);
    }

    const finalStatus = outcomes.some((outcome) => outcome.status === "error")
      ? "error"
      : outcomes.some((outcome) => outcome.status === "failed")
      ? "failed"
      : "passed";
    const completedAt = new Date().toISOString();
    const update = await admin
      .from("runs")
      .update({
        status: finalStatus,
        completed_at: completedAt,
        duration_ms: Date.now() - startedAt,
      })
      .eq("id", activeRunId)
      .eq("workspace_id", payload.workspace_id);
    if (update.error) throw update.error;

    if (finalStatus !== "passed") {
      await persistFailureClusters(
        admin,
        payload.workspace_id,
        payload.release_id ?? null,
        activeRunId,
        outcomes,
      );
    }

    console.log(
      JSON.stringify({
        event: "journey_run_completed",
        correlation_id: correlationId,
        run_id: activeRunId,
        workspace_id: payload.workspace_id,
        status: finalStatus,
        duration_ms: Date.now() - startedAt,
      }),
    );
    return json(request, 200, {
      data: {
        id: activeRunId,
        status: finalStatus,
        correlation_id: correlationId,
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch (error) {
    const stable = stableError(error);
    if (runId) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const { createClient } = await import("npm:@supabase/supabase-js@2");
        const admin = createClient(supabaseUrl, serviceRoleKey);
        await admin
          .from("runs")
          .update({
            status: "error",
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - startedAt,
          })
          .eq("id", runId);
      } catch {
        console.error(
          JSON.stringify({
            event: "journey_run_error_persist_failed",
            correlation_id: correlationId,
            run_id: runId,
          }),
        );
      }
    }
    return json(request, stable.status, {
      error: { ...stable, correlation_id: correlationId },
    });
  }
});

async function loadRunConfiguration(
  admin: AdminClient,
  payload: z.infer<typeof payloadSchema>,
) {
  const [journeyResult, stepsResult, archetypeResult, hostsResult] =
    await Promise.all([
      admin
        .from("journeys")
        .select("id, name, integration_id, timeout_ms, active")
        .eq("id", payload.journey_id)
        .eq("workspace_id", payload.workspace_id)
        .maybeSingle(),
      admin
        .from("journey_steps")
        .select("*, journey_assertions(*)")
        .eq("journey_id", payload.journey_id)
        .eq("workspace_id", payload.workspace_id)
        .order("is_cleanup")
        .order("position"),
      admin
        .from("tenant_archetypes")
        .select(
          "id, name, region, auth_mode, permission_profile, metadata, active, archived_at",
        )
        .eq("id", payload.archetype_id)
        .eq("workspace_id", payload.workspace_id)
        .maybeSingle(),
      admin
        .from("workspace_allowed_hosts")
        .select("hostname")
        .eq("workspace_id", payload.workspace_id),
    ]);
  if (
    journeyResult.error || !journeyResult.data || !journeyResult.data.active
  ) {
    throw new Error("Active journey not found");
  }
  if (stepsResult.error || !stepsResult.data?.length) {
    throw new Error("Journey has no steps");
  }
  if (
    archetypeResult.error ||
    !archetypeResult.data ||
    !archetypeResult.data.active ||
    archetypeResult.data.archived_at
  ) {
    throw new Error("Active archetype not found");
  }
  if (hostsResult.error) throw hostsResult.error;
  if (!journeyResult.data.integration_id) {
    throw new Error("Journey provider is not configured");
  }

  const integrationResult = await admin
    .from("integrations")
    .select("id, base_url, active")
    .eq("id", journeyResult.data.integration_id)
    .eq("workspace_id", payload.workspace_id)
    .maybeSingle();
  if (
    integrationResult.error || !integrationResult.data ||
    !integrationResult.data.active
  ) {
    throw new Error("Active provider not found");
  }

  const credentialsResult = await admin
    .from("credential_records")
    .select("id, archetype_id, encrypted_payload, expires_at")
    .eq("workspace_id", payload.workspace_id)
    .eq("integration_id", integrationResult.data.id);
  if (credentialsResult.error) throw credentialsResult.error;
  const credential =
    credentialsResult.data.find((item) =>
      item.archetype_id === payload.archetype_id
    ) ??
      credentialsResult.data.find((item) => item.archetype_id === null) ??
      null;
  if (
    credential?.expires_at &&
    new Date(credential.expires_at).getTime() <= Date.now()
  ) {
    throw new Error("Credential has expired");
  }

  const allowedHosts = new Set(
    (hostsResult.data ?? []).map((item) => item.hostname.toLowerCase()),
  );
  const baseUrl = await validateOutboundUrl(
    integrationResult.data.base_url,
    allowedHosts,
  );

  if (payload.release_id) {
    const release = await admin
      .from("releases")
      .select("id")
      .eq("id", payload.release_id)
      .eq("workspace_id", payload.workspace_id)
      .maybeSingle();
    if (release.error || !release.data) throw new Error("Release not found");
  }

  return {
    journey: journeyResult.data,
    steps: stepsResult.data as unknown as StepRow[],
    archetype: archetypeResult.data,
    integration: { ...integrationResult.data, base_url: baseUrl.toString() },
    allowedHosts,
    credential,
  };
}

async function executeStep(input: {
  admin: AdminClient;
  runId: string;
  workspaceId: string;
  step: StepRow;
  baseUrl: string;
  allowedHosts: Set<string>;
  variables: Record<string, unknown>;
  configuredSecretValues: string[];
  deadline: number;
}): Promise<StepOutcome> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let stepResultId: string | undefined;
  try {
    const remainingMs = input.deadline - Date.now();
    if (remainingMs <= 0) throw new Error("Journey timeout exceeded");
    const renderedPath = renderTemplate(
      input.step.path_template,
      input.variables,
    );
    if (typeof renderedPath !== "string") {
      throw new Error("Step path did not render to text");
    }
    const baseUrl = new URL(input.baseUrl);
    const requestUrl = new URL(renderedPath, baseUrl);
    if (requestUrl.hostname !== baseUrl.hostname) {
      throw new Error("Step path cannot change the provider hostname");
    }

    const renderedHeaders = renderTemplate(
      input.step.request_headers ?? {},
      input.variables,
    ) as Record<string, string>;
    const headers = normalizeHeaders(renderedHeaders);
    const renderedBody = input.step.request_body === null
      ? undefined
      : renderTemplate(input.step.request_body, input.variables);
    const body = renderedBody === undefined
      ? undefined
      : JSON.stringify(renderedBody);
    if (body && !headers["content-type"]) {
      headers["content-type"] = "application/json";
    }

    const response = await safeFetch(requestUrl, {
      method: input.step.method,
      headers,
      body: input.step.method === "GET" || input.step.method === "HEAD"
        ? undefined
        : body,
    }, {
      allowedHosts: input.allowedHosts,
      timeoutMs: Math.min(10_000, remainingMs),
    });

    const extractionRules = Array.isArray(input.step.extraction_rules)
      ? (input.step.extraction_rules as ExtractionRule[])
      : [];
    const extracted = extractValues(extractionRules, response);
    Object.assign(input.variables, extracted);

    const assertions = input.step.journey_assertions.map((assertion) => ({
      assertion_type: assertion.assertion_type,
      target: assertion.target ?? undefined,
      operator: assertion.operator,
      expected_value: assertion.expected_value,
    }));
    const assertionOutcomes = assertions.map((assertion) =>
      evaluateAssertion(assertion, response)
    );
    const passed = assertionOutcomes.every((outcome) => outcome.passed);
    const errorMessage = passed
      ? undefined
      : assertionOutcomes.find((outcome) => !outcome.passed)?.message ??
        "Assertion failed";
    const fingerprint = errorMessage
      ? await failureFingerprint("assertion_failure", errorMessage)
      : undefined;

    const inserted = await input.admin
      .from("run_step_results")
      .insert({
        workspace_id: input.workspaceId,
        run_id: input.runId,
        journey_step_id: input.step.id,
        step_name: input.step.name,
        position: input.step.position,
        status: passed ? "passed" : "failed",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedMs,
        request_summary: boundedEvidence(
          redactEvidence(
            {
              method: input.step.method,
              url: requestUrl.toString(),
              headers: sanitizeEvidenceHeaders(headers),
              body: renderedBody,
            },
            input.configuredSecretValues,
          ),
        ),
        response_summary: boundedEvidence(
          redactEvidence(
            {
              status: response.status,
              headers: sanitizeEvidenceHeaders(response.headers),
              body: response.body,
            },
            input.configuredSecretValues,
          ),
        ),
        error_code: passed ? null : "assertion_failure",
        error_message: errorMessage ?? null,
        fingerprint: fingerprint ?? null,
      })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;
    stepResultId = inserted.data.id;

    if (assertionOutcomes.length) {
      const assertionInsert = await input.admin.from("assertion_results")
        .insert(
          assertionOutcomes.map((outcome, index) => ({
            workspace_id: input.workspaceId,
            run_step_result_id: stepResultId!,
            journey_assertion_id: input.step.journey_assertions[index]?.id ??
              null,
            passed: outcome.passed,
            actual_value: toJsonValue(outcome.actual),
            message: outcome.message,
          })),
        );
      if (assertionInsert.error) throw assertionInsert.error;
    }
    return {
      status: passed ? "passed" : "failed",
      errorCode: passed ? undefined : "assertion_failure",
      errorMessage,
      fingerprint,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = classifyRunError(errorMessage);
    const fingerprint = await failureFingerprint(errorCode, errorMessage);
    if (!stepResultId) {
      const insert = await input.admin.from("run_step_results").insert({
        workspace_id: input.workspaceId,
        run_id: input.runId,
        journey_step_id: input.step.id,
        step_name: input.step.name,
        position: input.step.position,
        status: "error",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedMs,
        error_code: errorCode,
        error_message: safeProviderError(errorMessage),
        fingerprint,
      });
      if (insert.error) throw insert.error;
    } else {
      const update = await input.admin
        .from("run_step_results")
        .update({
          status: "error",
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - startedMs,
          error_code: errorCode,
          error_message: safeProviderError(errorMessage),
          fingerprint,
        })
        .eq("id", stepResultId)
        .eq("workspace_id", input.workspaceId);
      if (update.error) throw update.error;
    }
    return {
      status: "error",
      errorCode,
      errorMessage: safeProviderError(errorMessage),
      fingerprint,
    };
  }
}

async function persistSkippedStep(
  admin: AdminClient,
  runId: string,
  workspaceId: string,
  step: StepRow,
) {
  const insert = await admin.from("run_step_results").insert({
    workspace_id: workspaceId,
    run_id: runId,
    journey_step_id: step.id,
    step_name: step.name,
    position: step.position,
    status: "skipped",
    error_code: "prior_step_failed",
    error_message: "Skipped because an earlier required step failed.",
  });
  if (insert.error) throw insert.error;
}

async function persistFailureClusters(
  admin: AdminClient,
  workspaceId: string,
  releaseId: string | null,
  runId: string,
  outcomes: StepOutcome[],
) {
  for (const outcome of outcomes) {
    if (!outcome.fingerprint) continue;
    const cluster = await admin
      .from("failure_clusters")
      .upsert(
        {
          workspace_id: workspaceId,
          release_id: releaseId,
          fingerprint: outcome.fingerprint,
          title: humanizeErrorCode(outcome.errorCode ?? "run_failure"),
          summary: outcome.errorMessage ?? "Journey step failed.",
          suspected_cause: outcome.errorCode ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,fingerprint" },
      )
      .select("id")
      .single();
    if (cluster.error) throw cluster.error;
    const link = await admin
      .from("failure_cluster_runs")
      .upsert({
        workspace_id: workspaceId,
        failure_cluster_id: cluster.data.id,
        run_id: runId,
      });
    if (link.error) throw link.error;
  }
}

async function enforceRateLimit(
  admin: AdminClient,
  workspaceId: string,
  userId: string,
) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const result = await admin
    .from("runs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("triggered_by", userId)
    .gte("created_at", since);
  if (result.error) throw result.error;
  if ((result.count ?? 0) >= 20) throw new Error("Run rate limit exceeded");
}

function normalizeHeaders(
  value: Record<string, unknown>,
): Record<string, string> {
  const blocked = new Set([
    "host",
    "connection",
    "content-length",
    "transfer-encoding",
    "x-forwarded-for",
    "x-forwarded-host",
  ]);
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.toLowerCase();
    if (blocked.has(name)) {
      throw new Error(`Request header ${rawName} is not allowed`);
    }
    if (typeof rawValue !== "string") {
      throw new Error(`Request header ${rawName} must be text`);
    }
    headers[name] = rawValue;
  }
  return headers;
}

function sanitizeEvidenceHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const sensitive = new Set([
    "authorization",
    "cookie",
    "proxy-authorization",
    "set-cookie",
    "www-authenticate",
    "x-api-key",
    "api-key",
  ]);
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      sensitive.has(name.toLowerCase()) ? "[REDACTED]" : value,
    ]),
  );
}

function classifyRunError(message: string): string {
  if (/timeout|aborted/i.test(message)) return "timeout";
  if (
    /private network|allowlist|blocked|hostname|https|port 443/i.test(message)
  ) {
    return "ssrf_blocked";
  }
  if (/too large/i.test(message)) return "size_limit";
  if (/malformed json/i.test(message)) return "malformed_response";
  if (/template|missing template/i.test(message)) return "template_error";
  if (/extraction/i.test(message)) return "extraction_failure";
  if (/fetch|network|dns|resolve/i.test(message)) return "network_error";
  return "execution_error";
}

function safeProviderError(message: string): string {
  return message.replace(/https?:\/\/[^\s]+/gi, "[provider URL]").slice(
    0,
    1000,
  );
}

function humanizeErrorCode(code: string): string {
  return code
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

async function failureFingerprint(
  kind: string,
  message: string,
): Promise<string> {
  const normalized = `${kind.toLowerCase()}\0${
    message
      .toLowerCase()
      .replace(/\b\d+\b/g, "<number>")
      .replace(/\s+/g, " ")
      .trim()
  }`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function toJsonValue(value: unknown): unknown {
  return value === undefined ? null : value;
}
