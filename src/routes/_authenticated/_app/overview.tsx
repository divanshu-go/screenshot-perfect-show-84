import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { PageHeader, Loading, ErrorBox, StatusBadge, Mono } from "@/components/app/ui-bits";

export const Route = createFileRoute("/_authenticated/_app/overview")({
  head: () => ({ meta: [{ title: "Overview — CanaryGrid" }] }),
  component: Overview,
});

async function count(table: "capabilities" | "integrations" | "tenant_archetypes" | "journeys" | "github_installations" | "credential_records", ws: string) {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("workspace_id", ws);
  if (error) throw error;
  return count ?? 0;
}

function Overview() {
  const { workspace } = useWorkspace();
  const q = useQuery({
    queryKey: ["overview", workspace.id],
    queryFn: async () => {
      const [capabilities, integrations, archetypes, journeys, github, credentials] = await Promise.all([
        count("capabilities", workspace.id), count("integrations", workspace.id), count("tenant_archetypes", workspace.id),
        count("journeys", workspace.id), count("github_installations", workspace.id), count("credential_records", workspace.id),
      ]);
      const { data: releases, error } = await supabase.from("releases")
        .select("id, title, repository_full_name, pull_request_number, commit_sha, status, created_at")
        .eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(5);
      if (error) throw error;
      return { capabilities, integrations, archetypes, journeys, github, credentials, releases: releases ?? [] };
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox message="Couldn't load the overview." onRetry={() => q.refetch()} />;
  const d = q.data;

  const steps = [
    { done: d.integrations > 0, label: "Add an external provider", to: "/settings" as const },
    { done: d.capabilities > 0, label: "Define capabilities and map repository paths", to: "/coverage" as const },
    { done: d.archetypes > 0, label: "Model your tenant archetypes", to: "/archetypes" as const },
    { done: d.journeys > 0, label: "Build a safe API journey", to: "/journeys" as const },
    { done: d.credentials > 0, label: "Store canary account credentials", to: "/credentials" as const },
    { done: d.github > 0, label: "Connect a GitHub repository", to: "/settings" as const },
  ];
  const next = steps.find((s) => !s.done);

  return (
    <div className="space-y-8">
      <PageHeader title="Overview" description={next ? `Next: ${next.label.toLowerCase()}.` : "Your release gate is configured."} />

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-4">
        {[["Archetypes", d.archetypes, "/ 20"], ["Capabilities", d.capabilities, ""], ["Journeys", d.journeys, ""], ["Providers", d.integrations, ""]].map(([l, v, s]) => (
          <div key={l as string} className="bg-card p-4">
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{v}<span className="ml-1 text-sm font-normal text-muted-foreground">{s}</span></p>
          </div>
        ))}
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-medium">Setup</h2>
          <ol className="divide-y rounded-md border">
            {steps.map((s) => (
              <li key={s.label}>
                <Link to={s.to} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent">
                  {s.done ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                  <span className={s.done ? "text-muted-foreground line-through" : ""}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h2 className="mb-3 text-sm font-medium">Recent releases</h2>
          {d.releases.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">No releases yet. They appear automatically once a GitHub repository is connected.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {d.releases.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{r.title ?? r.repository_full_name}</span>
                    <Mono className="text-muted-foreground">{r.pull_request_number ? `#${r.pull_request_number} · ` : ""}{r.commit_sha.slice(0, 7)}</Mono>
                  </span>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
