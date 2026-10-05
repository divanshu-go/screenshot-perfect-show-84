import { z } from "npm:zod@3.25.76";
import { requireWorkspaceRole } from "../_shared/auth.ts";
import { decryptCredential } from "../_shared/crypto.ts";
import { json, options, stableError } from "../_shared/http.ts";

const payloadSchema = z.object({
  workspace_id: z.string().uuid(),
  credential_id: z.string().uuid(),
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return options(request);
  if (request.method !== "POST")
    return json(request, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } });

  try {
    const payload = payloadSchema.parse(await request.json());
    const { admin } = await requireWorkspaceRole(request, payload.workspace_id, "admin");
    const credential = await admin
      .from("credential_records")
      .select("id, encrypted_payload, integrations!inner(id, active)")
      .eq("id", payload.credential_id)
      .eq("workspace_id", payload.workspace_id)
      .maybeSingle();
    if (credential.error || !credential.data) throw new Error("Credential not found");

    let healthy = false;
    try {
      const decrypted = await decryptCredential(credential.data.encrypted_payload);
      healthy =
        Object.keys(decrypted).length > 0 &&
        Boolean((credential.data.integrations as unknown as { active: boolean }).active);
    } catch {
      healthy = false;
    }

    const checkedAt = new Date().toISOString();
    const update = await admin
      .from("credential_records")
      .update({
        health_status: healthy ? "healthy" : "unhealthy",
        last_checked_at: checkedAt,
      })
      .eq("id", payload.credential_id)
      .eq("workspace_id", payload.workspace_id);
    if (update.error) throw update.error;

    return json(request, 200, {
      data: {
        id: payload.credential_id,
        health_status: healthy ? "healthy" : "unhealthy",
        last_checked_at: checkedAt,
        check: "encrypted_payload",
      },
    });
  } catch (error) {
    const stable = stableError(error);
    return json(request, stable.status, { error: stable });
  }
});
