import { z } from "npm:zod@3.25.76";
import { requireWorkspaceRole } from "../_shared/auth.ts";
import {
  createInstallationState,
  getInstallation,
  githubAppSlug,
  listInstallationRepositories,
  verifyInstallationState,
} from "../_shared/github.ts";
import { json, options, stableError } from "../_shared/http.ts";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("install_url"),
    workspace_id: z.string().uuid(),
  }),
  z.object({
    action: z.literal("bind"),
    state: z.string().min(20).max(4000),
    installation_id: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("disconnect"),
    workspace_id: z.string().uuid(),
    installation_id: z.number().int().positive(),
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
    const input = requestSchema.parse(await request.json());
    if (input.action === "install_url") {
      const { user } = await requireWorkspaceRole(
        request,
        input.workspace_id,
        "owner",
      );
      const state = await createInstallationState({
        workspaceId: input.workspace_id,
        userId: user.id,
      });
      return json(request, 200, {
        data: {
          url:
            `https://github.com/apps/${githubAppSlug()}/installations/new?state=${
              encodeURIComponent(state)
            }`,
        },
      });
    }

    if (input.action === "bind") {
      const state = await verifyInstallationState(input.state);
      const { admin, user } = await requireWorkspaceRole(
        request,
        state.workspace_id,
        "owner",
      );
      if (user.id !== state.user_id) {
        throw new Error("Installation state belongs to another user");
      }

      const [installation, repositories] = await Promise.all([
        getInstallation(input.installation_id),
        listInstallationRepositories(input.installation_id),
      ]);
      const existing = await admin
        .from("github_installations")
        .select("id, workspace_id")
        .eq("installation_id", installation.id)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data && existing.data.workspace_id !== state.workspace_id) {
        throw new Error("Installation is already bound to another workspace");
      }
      const binding = existing.data
        ? await admin
          .from("github_installations")
          .update({
            github_account_id: installation.account.id,
            github_account_login: installation.account.login,
            status: installation.suspended_at ? "suspended" : "active",
            installed_by: user.id,
          })
          .eq("id", existing.data.id)
          .eq("workspace_id", state.workspace_id)
          .select("id")
          .single()
        : await admin
          .from("github_installations")
          .insert({
            workspace_id: state.workspace_id,
            installation_id: installation.id,
            github_account_id: installation.account.id,
            github_account_login: installation.account.login,
            status: installation.suspended_at ? "suspended" : "active",
            installed_by: user.id,
          })
          .select("id")
          .single();
      if (binding.error) throw binding.error;

      const repositoryRows = repositories.map((repository) => ({
        workspace_id: state.workspace_id,
        github_installation_id: binding.data.id,
        repository_id: repository.id,
        owner_login: repository.owner.login,
        repository_name: repository.name,
        repository_full_name: repository.full_name,
        default_branch: repository.default_branch,
        active: true,
      }));
      if (repositoryRows.length) {
        const saved = await admin
          .from("github_installation_repositories")
          .upsert(repositoryRows, {
            onConflict: "github_installation_id,repository_id",
          });
        if (saved.error) throw saved.error;
      }
      await admin.from("audit_logs").insert({
        workspace_id: state.workspace_id,
        actor_user_id: user.id,
        action: "github_installation.bound",
        entity_type: "github_installation",
        entity_id: binding.data.id,
        metadata: {
          account_login: installation.account.login,
          repository_count: repositories.length,
        },
      });
      return json(request, 200, {
        data: {
          installation_id: installation.id,
          account_login: installation.account.login,
          repositories: repositoryRows.map((repository) => ({
            id: repository.repository_id,
            full_name: repository.repository_full_name,
          })),
        },
      });
    }

    const { admin, user } = await requireWorkspaceRole(
      request,
      input.workspace_id,
      "owner",
    );
    const installation = await admin
      .from("github_installations")
      .select("id")
      .eq("workspace_id", input.workspace_id)
      .eq("installation_id", input.installation_id)
      .maybeSingle();
    if (installation.error || !installation.data) {
      throw new Error("Installation not found");
    }
    const changed = await admin
      .from("github_installations")
      .update({ status: "removed" })
      .eq("id", installation.data.id)
      .eq("workspace_id", input.workspace_id);
    if (changed.error) throw changed.error;
    const repositories = await admin
      .from("github_installation_repositories")
      .update({ active: false })
      .eq("github_installation_id", installation.data.id)
      .eq("workspace_id", input.workspace_id);
    if (repositories.error) throw repositories.error;
    await admin.from("audit_logs").insert({
      workspace_id: input.workspace_id,
      actor_user_id: user.id,
      action: "github_installation.disconnected",
      entity_type: "github_installation",
      entity_id: installation.data.id,
    });
    return json(request, 200, { data: { disconnected: true } });
  } catch (error) {
    const stable = stableError(error);
    return json(request, stable.status, { error: stable });
  }
});
