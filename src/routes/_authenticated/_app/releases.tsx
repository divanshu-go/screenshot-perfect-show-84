import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { GitPullRequest, Search } from "lucide-react";
import {
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
  Mono,
  StatusBadge,
} from "@/components/app/ui-bits";
import {
  DataTable,
  StatStrip,
  tableCellClass,
  tableHeaderClass,
} from "@/components/app/app-surfaces";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useWorkspace } from "@/lib/workspace";
import { useWorkspaceRealtime } from "@/hooks/use-workspace-realtime";

export const Route = createFileRoute("/_authenticated/_app/releases")({
  head: () => ({ meta: [{ title: "Releases — CanaryGrid" }] }),
  component: ReleasesRoute,
});

function ReleasesRoute() {
  const isIndex = useRouterState({ select: (state) => state.location.pathname === "/releases" });
  return isIndex ? <PReleases /> : <Outlet />;
}

export function PReleases() {
  const { workspace } = useWorkspace();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | Database["public"]["Enums"]["release_status"]>(
    "all",
  );
  const [page, setPage] = useState(0);
  const pageSize = 20;
  useWorkspaceRealtime(workspace.id, ["releases", "release_decisions"], ["releases"]);
  const releases = useQuery({
    queryKey: ["releases", workspace.id, status, page],
    queryFn: async () => {
      let request = supabase
        .from("releases")
        .select("*, release_changed_files(id)", { count: "exact" })
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (status !== "all") request = request.eq("status", status);
      const result = await request;
      if (result.error) throw result.error;
      return { rows: result.data ?? [], count: result.count ?? 0 };
    },
  });
  const filtered = (releases.data?.rows ?? []).filter((release) =>
    `${release.title ?? ""} ${release.pull_request_number ?? ""} ${release.commit_sha} ${
      release.repository_full_name
    }`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const rows = releases.data?.rows ?? [];
  const total = releases.data?.count ?? 0;

  if (releases.isLoading) return <Loading label="Loading releases" />;
  if (releases.error) {
    return <ErrorBox message="Couldn't load releases." onRetry={() => releases.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Releases"
        description="Deterministic compatibility attempts evaluated against representative tenant archetypes."
      />
      <StatStrip
        items={[
          { label: "Attempts", value: total },
          {
            label: "On this page",
            value: rows.length,
          },
          {
            label: "Needs attention",
            value: rows.filter((item) => ["failed", "error"].includes(item.status)).length,
          },
          {
            label: "Waived",
            value: rows.filter((item) => item.status === "waived").length,
          },
        ]}
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search releases</span>
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search PR, title, or revision"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as "all" | Database["public"]["Enums"]["release_status"]);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["all", "planning", "running", "passed", "failed", "waived", "error"].map((item) => (
              <SelectItem key={item} value={item}>
                {item === "all" ? "All statuses" : item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {total === 0 && status === "all" ? (
        <EmptyState
          icon={<GitPullRequest className="h-5 w-5" />}
          title="No release gates yet"
          body="Connect GitHub and open or synchronize a pull request that changes a mapped capability path."
          action={
            <Link
              to="/settings"
              search={{ installation_id: undefined, state: undefined }}
              className="text-sm font-medium text-primary hover:underline"
            >
              Open GitHub settings
            </Link>
          }
        />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th className={tableHeaderClass}>Release</th>
              <th className={tableHeaderClass}>Revision</th>
              <th className={tableHeaderClass}>Created</th>
              <th className={tableHeaderClass}>Decision</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((release) => (
              <tr key={release.id} className="hover:bg-muted/30">
                <td className={tableCellClass}>
                  <Link
                    to="/releases/$releaseId"
                    params={{ releaseId: release.id }}
                    className="font-medium hover:underline"
                  >
                    {release.pull_request_number ? `PR #${release.pull_request_number} · ` : ""}
                    {release.title ?? release.repository_full_name}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {release.release_changed_files.length} changed files
                  </p>
                </td>
                <td className={tableCellClass}>
                  <Mono>{release.commit_sha.slice(0, 12)}</Mono>
                </td>
                <td className={tableCellClass}>{new Date(release.created_at).toLocaleString()}</td>
                <td className={tableCellClass}>
                  <StatusBadge status={release.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No release attempts match these filters.</p>
      )}
      {total > pageSize && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page + 1} of {Math.ceil(total / pageSize)}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * pageSize >= total}
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
