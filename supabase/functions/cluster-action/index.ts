import { z } from "npm:zod@3.25.76";
import { requireWorkspaceRole } from "../_shared/auth.ts";
import { json, options, stableError } from "../_shared/http.ts";

const inputSchema = z.object({
  workspace_id: z.string().uuid(),
  cluster_id: z.string().uuid(),
  status: z.enum(["open", "acknowledged", "resolved"]),
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return options(request);
  if (request.method !== "POST") {
    return json(request, 405, {
      error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." },
    });
  }
  try {
    const input = inputSchema.parse(await request.json());
    const { admin, user } = await requireWorkspaceRole(
      request,
      input.workspace_id,
      "engineer",
    );
    const updated = await admin
      .from("failure_clusters")
      .update({ status: input.status })
      .eq("id", input.cluster_id)
      .eq("workspace_id", input.workspace_id)
      .select("id, status")
      .maybeSingle();
    if (updated.error || !updated.data) throw new Error("Failure cluster not found");
    await admin.from("audit_logs").insert({
      workspace_id: input.workspace_id,
      actor_user_id: user.id,
      action: `failure_cluster.${input.status}`,
      entity_type: "failure_cluster",
      entity_id: input.cluster_id,
    });
    return json(request, 200, { data: updated.data });
  } catch (error) {
    const stable = stableError(error);
    return json(request, stable.status, { error: stable });
  }
});
