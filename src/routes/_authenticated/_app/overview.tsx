import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CheckCircle2, Circle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useWorkspace } from "@/lib/workspace";
import {
  PageHeader,
  Loading,
  ErrorBox,
  StatusBadge,
  Mono,
  EmptyState,
} from "@/components/app/ui-bits";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";

export const Route = createFileRoute("/_authenticated/_app/overview")({
  head: () => ({ meta: [{ title: "Overview — CanaryGrid" }] }),
  component: Overview,
});

async function count(
  table:
    | "capabilities"
    | "integrations"
    | "tenant_archetypes"
    | "journeys"
    | "github_installations"
    | "credential_records"
    | "releases",
  ws: string,
) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ws);
  if (error) throw error;
  return count ?? 0;
}

async function countReleases(
  ws: string,
  statuses: Database["public"]["Enums"]["release_status"][],
) {
  const { count: total, error } = await supabase
    .from("releases")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", ws)
    .in("status", statuses);
  if (error) throw error;
  return total ?? 0;
}

function Overview() {
  const { workspace } = useWorkspace();
  useWorkspaceRealtime(workspace.id, ["releases", "runs", "credential_records"], ["overview"]);
  const q = useQuery({
    queryKey: ["overview", workspace.id],
    queryFn: async () => {
      const [
        capabilities,
        integrations,
        archetypes,
        journeys,
        github,
        credentials,
        releaseCount,
        passedCount,
        attentionCount,
        releases,
      ] = await Promise.all([
        count("capabilities", workspace.id),
        count("integrations", workspace.id),
        count("tenant_archetypes", workspace.id),
        count("journeys", workspace.id),
        count("github_installations", workspace.id),
        count("credential_records", workspace.id),
        count("releases", workspace.id),
        countReleases(workspace.id, ["passed"]),
        countReleases(workspace.id, ["failed", "error"]),
        supabase
          .from("releases")
          .select(
            "id, title, pull_request_number, commit_sha, repository_full_name, status, created_at",
          )
          .eq("workspace_id", workspace.id)
          .order("created_at", { ascending: false })
          .limit(6),
      ]);
      if (releases.error) throw releases.error;
      return {
        capabilities,
        integrations,
        archetypes,
        journeys,
        github,
        credentials,
        releaseCount,
        passedCount,
        attentionCount,
        releases: releases.data ?? [],
      };
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data)
    return <ErrorBox message="Couldn't load the overview." onRetry={() => q.refetch()} />;
  const d = q.data;

  const steps = [
    { done: d.integrations > 0, label: "Add an external provider", to: "/settings" as const },
    {
      done: d.capabilities > 0,
      label: "Define capabilities and map repository paths",
      to: "/coverage" as const,
    },
    { done: d.archetypes > 0, label: "Model your tenant archetypes", to: "/archetypes" as const },
    { done: d.journeys > 0, label: "Build a safe API journey", to: "/journeys" as const },
    {
      done: d.credentials > 0,
      label: "Store canary account credentials",
      to: "/credentials" as const,
    },
    { done: d.github > 0, label: "Connect a GitHub repository", to: "/settings" as const },
  ];
  const next = steps.find((s) => !s.done);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description={
          next ? `Next: ${next.label.toLowerCase()}.` : "Your release gate is configured."
        }
      />
      <section className="grid grid-cols-2 border-y sm:grid-cols-4">
        {[
          ["Archetypes", d.archetypes, "/ 20"],
          ["Release attempts", d.releaseCount, ""],
          ["Passed", d.passedCount, ""],
          ["Needs attention", d.attentionCount, ""],
        ].map(([l, v, s]) => (
          <div
            key={l as string}
            className="border-b py-4 pr-4 sm:border-b-0 sm:border-r sm:pl-4 first:pl-0 last:border-r-0"
          >
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
              {v}
              <span className="ml-1 text-sm font-normal text-muted-foreground">{s}</span>
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="overflow-hidden rounded-lg border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Gate readiness</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Required control-plane configuration
              </p>
            </div>
            <span className="text-xs font-medium text-primary">
              {steps.filter((step) => step.done).length}/{steps.length} ready
            </span>
          </header>
          <ol className="divide-y">
            {steps.map((s) => (
              <li key={s.label}>
                <Link
                  to={s.to}
                  className="group flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/45"
                >
                  {s.done ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={s.done ? "text-muted-foreground line-through" : ""}>
                    {s.label}
                  </span>
                  <ArrowUpRight className="ml-auto size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ol>
        </section>
        <section className="overflow-hidden rounded-lg border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Recent release gates</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Latest deterministic decisions</p>
            </div>
            <Link to="/releases" className="text-xs font-medium text-primary hover:underline">
              View all
            </Link>
          </header>
          {d.releases.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No release gates yet"
                body={
                  d.github > 0
                    ? "Open or synchronize a pull request that changes a mapped capability path."
                    : "Connect a GitHub repository to evaluate pull requests against tenant archetypes."
                }
                action={
                  d.github === 0 ? (
                    <Link
                      to="/settings"
                      search={{ installation_id: undefined, state: undefined }}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Connect GitHub
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <ul className="divide-y">
              {d.releases.map((release) => (
                <li
                  key={release.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/25"
                >
                  <span className="min-w-0">
                    <Link
                      to="/releases/$releaseId"
                      params={{ releaseId: release.id }}
                      className="block truncate hover:underline"
                    >
                      {release.title ?? release.repository_full_name}
                    </Link>
                    <Mono className="text-muted-foreground">
                      {release.pull_request_number ? `#${release.pull_request_number} · ` : ""}
                      {release.commit_sha.slice(0, 8)}
                    </Mono>
                  </span>
                  <StatusBadge status={release.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
