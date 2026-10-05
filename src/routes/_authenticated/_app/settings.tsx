import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Loading, ErrorBox } from "@/components/app/ui-bits";
import { useWorkspace } from "@/lib/workspace";
import { supabase } from "@/integrations/supabase/client";
import {
  CapabilitySettings,
  GitHubSettings,
  IntegrationSettings,
  TeamSettings,
  WorkspaceSettings,
  type SettingsData,
} from "@/components/app/settings-sections";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/_app/settings")({
  head: () => ({ meta: [{ title: "Settings — CanaryGrid" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    installation_id:
      typeof search["installation_id"] === "string" ? search["installation_id"] : undefined,
    state: typeof search["state"] === "string" ? search["state"] : undefined,
  }),
  component: PSettings,
});

export function PSettings() {
  const { workspace, userId } = useWorkspace();
  const search = Route.useSearch();
  const query = useQuery({
    queryKey: ["settings", workspace.id],
    queryFn: async () => {
      const [members, invitations, hosts, integrations, capabilities, github] = await Promise.all([
        supabase.rpc("list_workspace_members", { _workspace_id: workspace.id }),
        supabase
          .from("workspace_invitations")
          .select("*")
          .eq("workspace_id", workspace.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("workspace_allowed_hosts")
          .select("*")
          .eq("workspace_id", workspace.id)
          .order("hostname"),
        supabase.from("integrations").select("*").eq("workspace_id", workspace.id).order("name"),
        supabase
          .from("capabilities")
          .select("*, capability_path_rules(id, glob_pattern)")
          .eq("workspace_id", workspace.id)
          .order("name"),
        supabase
          .from("github_installations")
          .select(
            "*, github_installation_repositories(id, repository_full_name, default_branch, active)",
          )
          .eq("workspace_id", workspace.id)
          .order("created_at", { ascending: false }),
      ]);
      for (const result of [members, invitations, hosts, integrations, capabilities, github]) {
        if (result.error) throw result.error;
      }
      return {
        members: members.data ?? [],
        invitations: invitations.data ?? [],
        allowedHosts: hosts.data ?? [],
        integrations: integrations.data ?? [],
        capabilities: capabilities.data ?? [],
        githubInstallations: github.data ?? [],
      } satisfies SettingsData;
    },
  });

  if (query.isLoading) return <Loading label="Loading settings" />;
  if (query.error || !query.data)
    return <ErrorBox message="Couldn't load workspace settings." onRetry={() => query.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage the workspace, access, release coverage, and trusted outbound APIs."
      />
      <Tabs defaultValue={search.installation_id ? "github" : "workspace"}>
        <TabsList className="h-auto w-full justify-start overflow-x-auto">
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="capabilities">Capabilities</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="github">GitHub</TabsTrigger>
        </TabsList>
        <TabsContent value="workspace" className="mt-5">
          <WorkspaceSettings workspace={workspace} userId={userId} />
        </TabsContent>
        <TabsContent value="team" className="mt-5">
          <TeamSettings workspace={workspace} userId={userId} data={query.data} />
        </TabsContent>
        <TabsContent value="capabilities" className="mt-5">
          <CapabilitySettings workspace={workspace} capabilities={query.data.capabilities} />
        </TabsContent>
        <TabsContent value="providers" className="mt-5">
          <IntegrationSettings workspace={workspace} data={query.data} />
        </TabsContent>
        <TabsContent value="github" className="mt-5">
          <GitHubSettings
            workspace={workspace}
            installations={query.data.githubInstallations}
            callback={search}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
