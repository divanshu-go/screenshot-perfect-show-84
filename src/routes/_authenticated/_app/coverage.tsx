import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Check, Grid3x3, Minus } from "lucide-react";
import { EmptyState, ErrorBox, Loading, PageHeader, StatusBadge } from "@/components/app/ui-bits";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/_app/coverage")({
  head: () => ({ meta: [{ title: "Coverage — CanaryGrid" }] }),
  component: PCoverage,
});

export function PCoverage() {
  const { workspace } = useWorkspace();
  const query = useQuery({
    queryKey: ["coverage", workspace.id],
    queryFn: async () => {
      const [capabilities, archetypes] = await Promise.all([
        supabase
          .from("capabilities")
          .select("*, capability_path_rules(glob_pattern)")
          .eq("workspace_id", workspace.id)
          .eq("active", true)
          .order("name"),
        supabase
          .from("tenant_archetypes")
          .select("id, name, risk_weight, archetype_capabilities(capability_id)")
          .eq("workspace_id", workspace.id)
          .eq("active", true)
          .is("archived_at", null)
          .order("name"),
      ]);
      if (capabilities.error || archetypes.error) {
        throw capabilities.error ?? archetypes.error;
      }
      return {
        capabilities: capabilities.data ?? [],
        archetypes: archetypes.data ?? [],
      };
    },
  });

  if (query.isLoading) return <Loading label="Loading coverage" />;
  if (query.error || !query.data) {
    return (
      <ErrorBox message="Couldn't load capability coverage." onRetry={() => query.refetch()} />
    );
  }
  const { capabilities, archetypes } = query.data;
  if (capabilities.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Coverage"
          description="Capability coverage across representative tenant archetypes."
        />
        <EmptyState
          icon={<Grid3x3 className="h-5 w-5" />}
          title="Define the first capability"
          body="Capabilities connect repository paths, API journeys, and representative tenant archetypes."
          action={
            <Link
              to="/settings"
              search={{ installation_id: undefined, state: undefined }}
              className="text-sm font-medium text-primary hover:underline"
            >
              Configure capabilities
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coverage"
        description="Capability coverage across representative tenant archetypes."
      />
      {archetypes.length === 0 && (
        <EmptyState
          title="No tenant archetypes"
          body="Create an archetype to see which customer configurations cover each capability."
          action={
            <Link to="/archetypes" className="text-sm font-medium text-primary hover:underline">
              Create an archetype
            </Link>
          }
        />
      )}
      {archetypes.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-md border md:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                    Capability
                  </th>
                  {archetypes.map((archetype) => (
                    <th
                      key={archetype.id}
                      className="px-3 py-3 text-center text-xs font-medium text-muted-foreground"
                    >
                      {archetype.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {capabilities.map((capability) => (
                  <tr key={capability.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{capability.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StatusBadge status={capability.criticality} />
                        <span className="font-mono text-xs text-muted-foreground">
                          {capability.capability_path_rules.length} path{" "}
                          {capability.capability_path_rules.length === 1 ? "rule" : "rules"}
                        </span>
                      </div>
                    </td>
                    {archetypes.map((archetype) => {
                      const covered = archetype.archetype_capabilities.some(
                        (link) => link.capability_id === capability.id,
                      );
                      return (
                        <td key={archetype.id} className="px-3 py-3 text-center">
                          {covered ? (
                            <Check className="mx-auto h-4 w-4 text-success" aria-label="Covered" />
                          ) : (
                            <Minus
                              className="mx-auto h-4 w-4 text-muted-foreground"
                              aria-label="Not covered"
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-4 md:hidden">
            {capabilities.map((capability) => (
              <section key={capability.id} className="rounded-md border p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-sm font-medium">{capability.name}</h2>
                  <StatusBadge status={capability.criticality} />
                </div>
                <ul className="mt-3 space-y-2">
                  {archetypes.map((archetype) => {
                    const covered = archetype.archetype_capabilities.some(
                      (link) => link.capability_id === capability.id,
                    );
                    return (
                      <li key={archetype.id} className="flex items-center justify-between text-sm">
                        <span>{archetype.name}</span>
                        {covered ? (
                          <Check className="h-4 w-4 text-success" aria-label="Covered" />
                        ) : (
                          <Minus
                            className="h-4 w-4 text-muted-foreground"
                            aria-label="Not covered"
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
