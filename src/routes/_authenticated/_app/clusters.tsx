import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Layers, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorBox,
  Loading,
  Mono,
  PageHeader,
  StatusBadge,
} from "@/components/app/ui-bits";
import { Panel } from "@/components/app/app-surfaces";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError, permissions, useWorkspace } from "@/lib/workspace";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";

export const Route = createFileRoute("/_authenticated/_app/clusters")({
  head: () => ({ meta: [{ title: "Failure Clusters — CanaryGrid" }] }),
  component: PClusters,
});

export function PClusters() {
  const { workspace } = useWorkspace();
  const { canEdit } = permissions(workspace.role);
  useWorkspaceRealtime(
    workspace.id,
    ["failure_clusters", "failure_cluster_runs", "runs"],
    ["clusters"],
  );
  const query = useQuery({
    queryKey: ["clusters", workspace.id],
    queryFn: async () => {
      const result = await supabase
        .from("failure_clusters")
        .select(
          "*, failure_cluster_runs(run_id, runs(id, journey_name, archetype_name, status, release_id, releases(id, pull_request_number, title)))",
        )
        .eq("workspace_id", workspace.id)
        .order("last_seen_at", { ascending: false });
      if (result.error) throw result.error;
      return result.data ?? [];
    },
  });
  const update = useMutation({
    mutationFn: async ({
      clusterId,
      status,
    }: {
      clusterId: string;
      status: "open" | "acknowledged" | "resolved";
    }) => {
      const { error } = await supabase.functions.invoke("cluster-action", {
        body: {
          workspace_id: workspace.id,
          cluster_id: clusterId,
          status,
        },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Failure cluster updated");
      await query.refetch();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  if (query.isLoading) return <Loading label="Loading failure clusters" />;
  if (query.error || !query.data) {
    return <ErrorBox message="Couldn't load failure clusters." onRetry={() => query.refetch()} />;
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Failure Clusters"
        description="Repeated failures grouped by stable fingerprints from sanitized evidence."
      />
      {query.data.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-5 w-5" />}
          title="No failure clusters"
          body="Failures from manual and release runs will be grouped here. Passing runs do not create clusters."
          action={
            <Link to="/runs" className="text-sm font-medium text-primary hover:underline">
              Review runs
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {query.data.map((cluster) => {
            const linkedRuns = cluster.failure_cluster_runs.flatMap((link) =>
              link.runs ? [link.runs] : [],
            );
            const release = linkedRuns.find((run) => run.releases)?.releases;
            return (
              <Panel
                key={cluster.id}
                title={cluster.title}
                description="Suspected cause based on deterministic evidence, not a production diagnosis."
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={cluster.status} />
                  <Mono>{cluster.fingerprint}</Mono>
                  <span className="text-xs text-muted-foreground">
                    {linkedRuns.length} occurrence{linkedRuns.length === 1 ? "" : "s"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Last seen {new Date(cluster.last_seen_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {cluster.summary ?? "The runner recorded equivalent sanitized failures."}
                </p>
                <div className="mt-4 divide-y rounded-md border">
                  {linkedRuns.map((run) => (
                    <div
                      key={run.id}
                      className="flex flex-col gap-2 px-3 py-2.5 text-sm sm:flex-row sm:items-center"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{run.journey_name}</span>
                        <span className="text-xs text-muted-foreground">{run.archetype_name}</span>
                      </span>
                      <StatusBadge status={run.status} />
                      {run.release_id && (
                        <Link
                          to="/releases/$releaseId"
                          params={{ releaseId: run.release_id }}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Open release
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
                {canEdit && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {cluster.status !== "acknowledged" && cluster.status !== "resolved" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate({ clusterId: cluster.id, status: "acknowledged" })
                        }
                      >
                        Acknowledge
                      </Button>
                    )}
                    {cluster.status !== "resolved" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ clusterId: cluster.id, status: "resolved" })}
                      >
                        Resolve
                      </Button>
                    )}
                    {cluster.status === "resolved" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ clusterId: cluster.id, status: "open" })}
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Reopen
                      </Button>
                    )}
                    {release && (
                      <Button size="sm" variant="ghost" asChild>
                        <Link to="/releases/$releaseId" params={{ releaseId: release.id }}>
                          Rerun or waive in release
                        </Link>
                      </Button>
                    )}
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
