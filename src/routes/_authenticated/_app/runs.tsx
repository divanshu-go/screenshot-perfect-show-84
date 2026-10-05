import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Clock3, Play } from "lucide-react";
import { useState } from "react";
import {
  EmptyState,
  ErrorBox,
  Loading,
  Mono,
  PageHeader,
  StatusBadge,
} from "@/components/app/ui-bits";
import { StatStrip } from "@/components/app/app-surfaces";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useWorkspace } from "@/lib/workspace";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_app/runs")({
  head: () => ({ meta: [{ title: "Runs — CanaryGrid" }] }),
  component: PRuns,
});

export function PRuns() {
  const { workspace } = useWorkspace();
  const [status, setStatus] = useState<"all" | Database["public"]["Enums"]["run_status"]>("all");
  const [page, setPage] = useState(0);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const pageSize = 20;
  useWorkspaceRealtime(workspace.id, ["runs", "run_step_results"], ["runs"]);

  const query = useQuery({
    queryKey: ["runs", workspace.id, status, page],
    queryFn: async () => {
      let request = supabase
        .from("runs")
        .select("*, releases(id, pull_request_number, commit_sha, title), run_step_results(*)", {
          count: "exact",
        })
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (status !== "all") request = request.eq("status", status);
      const result = await request;
      if (result.error) throw result.error;
      return { rows: result.data ?? [], count: result.count ?? 0 };
    },
  });

  if (query.isLoading) return <Loading label="Loading runs" />;
  if (query.error || !query.data) {
    return <ErrorBox message="Couldn't load run history." onRetry={() => query.refetch()} />;
  }
  const rows = query.data.rows;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Runs"
        description="Persisted API journey execution with bounded, sanitized evidence."
        actions={
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as "all" | Database["public"]["Enums"]["run_status"]);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-40" aria-label="Filter runs by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["all", "queued", "running", "passed", "failed", "error", "cancelled"].map(
                (item) => (
                  <SelectItem key={item} value={item}>
                    {item === "all" ? "All statuses" : item}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        }
      />
      <StatStrip
        items={[
          { label: "Matching runs", value: query.data.count },
          { label: "On this page", value: rows.length },
          { label: "Passed", value: rows.filter((run) => run.status === "passed").length },
          {
            label: "Needs attention",
            value: rows.filter((run) => ["failed", "error"].includes(run.status)).length,
          },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Play className="h-5 w-5" />}
          title={status === "all" ? "No runs yet" : "No runs match this status"}
          body={
            status === "all"
              ? "Create a valid journey, then start a manual run or connect GitHub to run it for a release."
              : "Choose another status or wait for current release evaluations to update."
          }
          action={
            status === "all" ? (
              <Link to="/journeys" className="text-sm font-medium text-primary hover:underline">
                Open journeys
              </Link>
            ) : undefined
          }
        />
      ) : (
        <section className="space-y-2" aria-label="Run execution records">
          {rows.map((run) => {
            const open = openRun === run.id;
            return (
              <article key={run.id} className="overflow-hidden rounded-lg border bg-card">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`${run.id}-details`}
                  onClick={() => setOpenRun(open ? null : run.id)}
                  className="flex min-h-16 w-full items-center gap-3 px-4 text-left hover:bg-muted/30"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{run.journey_name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {run.archetype_name}
                      {run.releases?.pull_request_number
                        ? ` · PR #${run.releases.pull_request_number}`
                        : " · Manual run"}
                    </span>
                  </span>
                  <span className="hidden items-center gap-1 font-mono text-xs text-muted-foreground sm:flex">
                    <Clock3 className="h-3.5 w-3.5" />
                    {run.duration_ms === null ? "—" : `${run.duration_ms}ms`}
                  </span>
                  <StatusBadge status={run.status} />
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      open && "rotate-180",
                    )}
                  />
                </button>
                {open && (
                  <div id={`${run.id}-details`} className="border-t px-4 py-4">
                    <div className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Started</p>
                        <p className="mt-1">
                          {run.started_at ? new Date(run.started_at).toLocaleString() : "Queued"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Trigger</p>
                        <p className="mt-1 capitalize">{run.trigger_type.replace("_", " ")}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Correlation ID</p>
                        <Mono className="mt-1 block break-all">{run.correlation_id}</Mono>
                      </div>
                    </div>
                    {run.release_id && (
                      <Link
                        to="/releases/$releaseId"
                        params={{ releaseId: run.release_id }}
                        className="mb-4 inline-block text-sm font-medium text-primary hover:underline"
                      >
                        Open release evidence
                      </Link>
                    )}
                    <div className="space-y-2">
                      {run.run_step_results
                        .slice()
                        .sort((left, right) => left.position - right.position)
                        .map((step) => (
                          <details key={step.id} className="rounded-md border px-3 py-2">
                            <summary className="cursor-pointer list-none text-sm">
                              <span className="mr-2 font-medium">{step.step_name}</span>
                              <StatusBadge status={step.status} />
                            </summary>
                            {step.error_message && (
                              <p className="mt-2 text-sm text-destructive">{step.error_message}</p>
                            )}
                            <pre className="mt-2 max-h-72 overflow-auto rounded bg-muted p-3 text-xs">
                              {JSON.stringify(
                                {
                                  request: step.request_summary,
                                  response: step.response_summary,
                                },
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      {query.data.count > pageSize && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page + 1} of {Math.ceil(query.data.count / pageSize)}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * pageSize >= query.data.count}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
