import { z } from "npm:zod@3.25.76";
import { requireWorkspaceRole } from "../_shared/auth.ts";
import { encryptCredential } from "../_shared/crypto.ts";
import { json, options, stableError } from "../_shared/http.ts";

const payloadSchema = z.object({
  workspace_id: z.string().uuid(),
  credential_id: z.string().uuid().optional(),
  integration_id: z.string().uuid(),
  archetype_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(120),
  secret: z
    .record(z.string().min(1).max(80), z.string().min(1).max(20_000))
    .refine((value) => Object.keys(value).length <= 30, "Too many secret fields"),
  expires_at: z.string().datetime().nullable().optional(),
});

const metadataColumns =
  "id, workspace_id, integration_id, archetype_id, name, encryption_version, health_status, last_checked_at, expires_at, created_by, created_at, updated_at";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return options(request);
  if (request.method !== "POST")
    return json(request, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } });

  try {
    const payload = payloadSchema.parse(await request.json());
    const { admin, user } = await requireWorkspaceRole(request, payload.workspace_id, "admin");

    const integration = await admin
      .from("integrations")
      .select("id")
      .eq("id", payload.integration_id)
      .eq("workspace_id", payload.workspace_id)
      .eq("active", true)
      .maybeSingle();
    if (integration.error || !integration.data) throw new Error("Active provider not found");

    if (payload.archetype_id) {
      const archetype = await admin
        .from("tenant_archetypes")
        .select("id")
        .eq("id", payload.archetype_id)
        .eq("workspace_id", payload.workspace_id)
        .is("archived_at", null)
        .maybeSingle();
      if (archetype.error || !archetype.data) throw new Error("Archetype not found");
    }

    const encryptedPayload = await encryptCredential(payload.secret);
    const values = {
      integration_id: payload.integration_id,
      archetype_id: payload.archetype_id ?? null,
      name: payload.name,
      encrypted_payload: encryptedPayload,
      encryption_version: 1,
      health_status: "unknown",
      last_checked_at: null,
      expires_at: payload.expires_at ?? null,
    };

    const result = payload.credential_id
      ? await admin
          .from("credential_records")
          .update(values)
          .eq("id", payload.credential_id)
          .eq("workspace_id", payload.workspace_id)
          .select(metadataColumns)
          .single()
      : await admin
          .from("credential_records")
          .insert({
            ...values,
            workspace_id: payload.workspace_id,
            created_by: user.id,
          })
          .select(metadataColumns)
          .single();

    if (result.error) throw result.error;
    return json(request, payload.credential_id ? 200 : 201, {
      data: result.data,
    });
  } catch (error) {
    const stable = stableError(error);
    return json(request, stable.status, { error: stable });
  }
});
