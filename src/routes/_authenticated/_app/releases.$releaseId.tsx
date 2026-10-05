import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileCode2, FlaskConical, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  EmptyState,
  ErrorBox,
  Loading,
  Mono,
  PageHeader,
  StatusBadge,
} from "@/components/app/ui-bits";
import { DataTable, Panel, tableCellClass, tableHeaderClass } from "@/components/app/app-surfaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError, permissions, useWorkspace } from "@/lib/workspace";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";

export const Route = createFileRoute("/_authenticated/_app/releases/$releaseId")({
  head: () => ({ meta: [{ title: "Release detail — CanaryGrid" }] }),
  component: ReleaseDetail,
});

export function ReleaseDetail() {
  const { releaseId } = Route.useParams();
  const { workspace } = useWorkspace();
  const { canAdmin, canEdit } = permissions(workspace.role);
  const [scope, setScope] = useState("Entire release");
  const [reason, setReason] = useState("");
  useWorkspaceRealtime(
    workspace.id,
    ["releases", "release_decisions", "runs", "run_step_results", "failure_clusters", "waivers"],
    ["release-detail"],
  );

  const query = useQuery({
    queryKey: ["release-detail", workspace.id, releaseId],
    queryFn: async () => {
      const releaseResult = await supabase
        .from("releases")
        .select("*")
        .eq("workspace_id", workspace.id)
        .eq("id", releaseId)
        .maybeSingle();
      if (releaseResult.error) throw releaseResult.error;
      if (!releaseResult.data) return null;
      const [files, capabilities, selections, runs, decisions, waivers, clusters, audit] =
        await Promise.all([
          supabase
            .from("release_changed_files")
            .select("*")
            .eq("workspace_id", workspace.id)
            .eq("release_id", releaseId)
            .order("path"),
          supabase
            .from("release_capabilities")
            .select("reason, capabilities(id, name, criticality)")
            .eq("workspace_id", workspace.id)
            .eq("release_id", releaseId),
          supabase
            .from("release_archetype_selections")
            .select("*")
            .eq("workspace_id", workspace.id)
            .eq("release_id", releaseId)
            .order("coverage_score", { ascending: false }),
          supabase
            .from("runs")
            .select("*")
            .eq("workspace_id", workspace.id)
            .eq("release_id", releaseId)
            .order("created_at", { ascending: false }),
          supabase
            .from("release_decisions")
            .select("*")
            .eq("workspace_id", workspace.id)
            .eq("release_id", releaseId)
            .order("attempt", { ascending: false }),
          supabase
            .from("waivers")
            .select("*, profiles(display_name)")
            .eq("workspace_id", workspace.id)
            .eq("release_id", releaseId)
            .order("created_at", { ascending: false }),
          supabase
            .from("failure_clusters")
            .select("*")
            .eq("workspace_id", workspace.id)
            .eq("release_id", releaseId)
            .order("last_seen_at", { ascending: false }),
          supabase
            .from("audit_logs")
            .select("*")
            .eq("workspace_id", workspace.id)
            .eq("entity_id", releaseId)
            .order("created_at", { ascending: false }),
        ]);
      for (const result of [
        files,
        capabilities,
        selections,
        runs,
        decisions,
        waivers,
        clusters,
        audit,
      ]) {
        if (result.error) throw result.error;
      }
      const runIds = (runs.data ?? []).map((run) => run.id);
      const steps = runIds.length
        ? await supabase
            .from("run_step_results")
            .select("*, assertion_results(*)")
            .eq("workspace_id", workspace.id)
            .in("run_id", runIds)
            .order("position")
        : { data: [], error: null };
      if (steps.error) throw steps.error;
      return {
        release: releaseResult.data,
        files: files.data ?? [],
        capabilities: capabilities.data ?? [],
        selections: selections.data ?? [],
        runs: runs.data ?? [],
        decisions: decisions.data ?? [],
        waivers: waivers.data ?? [],
        clusters: clusters.data ?? [],
        audit: audit.data ?? [],
        steps: steps.data ?? [],
      };
    },
  });

  const action = useMutation({
    mutationFn: async (
      input:
        | { action: "rerun" }
        | {
            action: "waive";
            decision_id: string;
            scope: string;
            reason: string;
          },
    ) => {
      const { data, error } = await supabase.functions.invoke("release-action", {
        body: {
          ...input,
          workspace_id: workspace.id,
          release_id: releaseId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (_data, input) => {
      toast.success(input.action === "rerun" ? "Release rerun completed" : "Waiver recorded");
      setReason("");
      await query.refetch();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  if (query.isLoading) return <Loading label="Loading release evidence" />;
  if (query.error) {
    return <ErrorBox message="Couldn't load this release." onRetry={() => query.refetch()} />;
  }
  if (!query.data) {
    return (
      <EmptyState
        title="Release not found"
        body="This release does not exist in the current workspace or you do not have access."
        action={
          <Link to="/releases" className="text-sm font-medium text-primary hover:underline">
            Return to releases
          </Link>
        }
      />
    );
  }

  const data = query.data;
  const latestDecision = data.decisions[0];
  const canWaive =
    canAdmin && data.release.status === "failed" && latestDecision?.status === "failed";
  const canRerun = canEdit && ["passed", "failed", "waived", "error"].includes(data.release.status);

  return (
    <div className="space-y-6">
      <Link
        to="/releases"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All releases
      </Link>
      <PageHeader
        title={`${data.release.pull_request_number ? `PR #${data.release.pull_request_number} · ` : ""}${
          data.release.title ?? data.release.repository_full_name
        }`}
        description={`${data.release.repository_full_name} · ${data.release.commit_sha.slice(0, 12)}`}
        actions={
          <>
            {canRerun && (
              <Button
                onClick={() => action.mutate({ action: "rerun" })}
                disabled={action.isPending}
              >
                <FlaskConical className="h-4 w-4" /> Rerun gate
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={!canWaive || action.isPending}>
                  Grant waiver
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Grant a decision-bound waiver</AlertDialogTitle>
                  <AlertDialogDescription>
                    The failed decision remains immutable. This waiver records who accepted the
                    risk, why, and its exact scope.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <label className="space-y-2 text-sm">
                  <span>Scope</span>
                  <Input value={scope} onChange={(event) => setScope(event.target.value)} />
                </label>
                <label className="space-y-2 text-sm">
                  <span>Reason</span>
                  <Textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Explain why this specific failure is safe to accept"
                  />
                </label>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={
                      !latestDecision || scope.trim().length < 2 || reason.trim().length < 10
                    }
                    onClick={() =>
                      latestDecision &&
                      action.mutate({
                        action: "waive",
                        decision_id: latestDecision.id,
                        scope,
                        reason,
                      })
                    }
                  >
                    Record waiver
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        }
      />

      <section className="grid border-y sm:grid-cols-3">
        <Metric label="Effective decision">
          <StatusBadge status={data.release.status} />
        </Metric>
        <Metric label="Latest immutable decision" bordered>
          <StatusBadge status={latestDecision?.status ?? "pending"} />
        </Metric>
        <Metric label="Completed" bordered>
          <span className="text-sm">
            {data.release.completed_at
              ? new Date(data.release.completed_at).toLocaleString()
              : "Evaluation in progress"}
          </span>
        </Metric>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-6">
          <Panel
            title="Changed-file mapping"
            description="Repository paths matched against configured customer-facing capabilities."
          >
            <div className="mb-4 flex flex-wrap gap-2">
              {data.capabilities.map((link) =>
                link.capabilities ? (
                  <span
                    key={link.capabilities.id}
                    className="inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
                  >
                    {link.capabilities.name}
                    <StatusBadge status={link.capabilities.criticality} />
                  </span>
                ) : null,
              )}
              {data.capabilities.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  No configured capability matched these files.
                </span>
              )}
            </div>
            <div className="divide-y rounded-md border">
              {data.files.map((file) => (
                <div key={file.id} className="flex items-center gap-3 px-3 py-2.5">
                  <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Mono className="min-w-0 flex-1 break-all">{file.path}</Mono>
                  <span className="text-xs text-muted-foreground">
                    +{file.additions} −{file.deletions}
                  </span>
                </div>
              ))}
              {data.files.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">
                  GitHub did not return changed files for this release.
                </p>
              )}
            </div>
          </Panel>

          <Panel
            title="Selected archetypes"
            description="Deterministic weighted coverage for the affected capabilities."
          >
            <ol className="divide-y">
              {data.selections.map((selection, index) => (
                <li key={selection.archetype_id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted text-xs font-medium">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{selection.archetype_name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selection.selection_reason}
                    </p>
                  </div>
                </li>
              ))}
              {data.selections.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No archetype was required or available for this change.
                </p>
              )}
            </ol>
          </Panel>

          <Panel title="Run matrix" description={`${data.runs.length} persisted journey runs.`}>
            <DataTable>
              <thead>
                <tr>
                  <th className={tableHeaderClass}>Journey</th>
                  <th className={tableHeaderClass}>Archetype</th>
                  <th className={tableHeaderClass}>Result</th>
                  <th className={tableHeaderClass}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.id}>
                    <td className={tableCellClass}>{run.journey_name}</td>
                    <td className={tableCellClass}>{run.archetype_name}</td>
                    <td className={tableCellClass}>
                      <StatusBadge status={run.status} />
                    </td>
                    <td className={tableCellClass}>
                      <Mono>{run.duration_ms === null ? "—" : `${run.duration_ms}ms`}</Mono>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            {data.runs.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                No journey runs were required or execution has not started.
              </p>
            )}
          </Panel>

          <Panel
            title="Sanitized evidence"
            description="Bounded request, response, and assertion records. Secrets are removed server-side."
          >
            <div className="space-y-2">
              {data.steps.map((step) => (
                <details key={step.id} className="rounded-md border px-3 py-2">
                  <summary className="cursor-pointer list-none text-sm font-medium">
                    <span className="mr-2">{step.step_name}</span>
                    <StatusBadge status={step.status} />
                  </summary>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <Evidence title="Request" value={step.request_summary} />
                    <Evidence title="Response" value={step.response_summary} />
                  </div>
                  {step.error_message && (
                    <p className="mt-3 text-sm text-destructive">{step.error_message}</p>
                  )}
                </details>
              ))}
              {data.steps.length === 0 && (
                <p className="text-sm text-muted-foreground">No step evidence has been recorded.</p>
              )}
            </div>
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel title="Decision record">
            {latestDecision ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">Attempt {latestDecision.attempt}</span>
                </div>
                <p className="text-muted-foreground">{latestDecision.summary}</p>
                <time className="block text-xs text-muted-foreground">
                  {new Date(latestDecision.decided_at).toLocaleString()}
                </time>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No immutable decision has been recorded yet.
              </p>
            )}
          </Panel>

          <Panel title="Failure clusters">
            <div className="space-y-3">
              {data.clusters.map((cluster) => (
                <div key={cluster.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{cluster.title}</p>
                    <StatusBadge status={cluster.status} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{cluster.summary}</p>
                  <Mono className="mt-2 block text-muted-foreground">{cluster.fingerprint}</Mono>
                </div>
              ))}
              {data.clusters.length === 0 && (
                <p className="text-sm text-muted-foreground">No failures were clustered.</p>
              )}
            </div>
          </Panel>

          <Panel title="Waivers">
            <div className="space-y-3">
              {data.waivers.map((waiver) => (
                <div key={waiver.id} className="rounded-md border border-warning/35 p-3">
                  <p className="text-sm font-medium">{waiver.scope}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{waiver.reason}</p>
                  <time className="mt-2 block text-xs text-muted-foreground">
                    {new Date(waiver.created_at).toLocaleString()}
                  </time>
                </div>
              ))}
              {data.waivers.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Only a failed immutable decision can be waived by an admin or owner.
                </p>
              )}
            </div>
          </Panel>

          <Panel title="Timeline">
            <ol className="space-y-3">
              {data.audit.map((event) => (
                <li key={event.id} className="border-l pl-3 text-sm">
                  <p className="font-medium">{event.action.replaceAll(".", " ")}</p>
                  <time className="text-xs text-muted-foreground">
                    {new Date(event.created_at).toLocaleString()}
                  </time>
                </li>
              ))}
              {data.audit.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Release activity will appear here as it is recorded.
                </p>
              )}
            </ol>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Metric({
  label,
  bordered,
  children,
}: {
  label: string;
  bordered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`py-4 sm:px-4 ${bordered ? "sm:border-l" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Evidence({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
        {JSON.stringify(value ?? {}, null, 2)}
      </pre>
    </div>
  );
}
