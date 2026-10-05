import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Download, ScrollText, Search } from "lucide-react";
import { useState } from "react";
import {
  EmptyState,
  ErrorBox,
  Loading,
  Mono,
  PageHeader,
  StatusBadge,
} from "@/components/app/ui-bits";
import { DataTable, tableCellClass, tableHeaderClass } from "@/components/app/app-surfaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/_app/audit")({
  head: () => ({ meta: [{ title: "Audit Log — CanaryGrid" }] }),
  component: PAudit,
});

export function PAudit() {
  const { workspace } = useWorkspace();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const query = useQuery({
    queryKey: ["audit", workspace.id, page],
    queryFn: async () => {
      const logs = await supabase
        .from("audit_logs")
        .select("*", { count: "exact" })
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (logs.error) throw logs.error;
      const actorIds = [
        ...new Set(
          (logs.data ?? []).flatMap((log) => (log.actor_user_id ? [log.actor_user_id] : [])),
        ),
      ];
      const profiles = actorIds.length
        ? await supabase.from("profiles").select("id, display_name").in("id", actorIds)
        : { data: [], error: null };
      if (profiles.error) throw profiles.error;
      return {
        rows: logs.data ?? [],
        count: logs.count ?? 0,
        actors: new Map((profiles.data ?? []).map((profile) => [profile.id, profile.display_name])),
      };
    },
  });

  if (query.isLoading) return <Loading label="Loading audit log" />;
  if (query.error || !query.data) {
    return <ErrorBox message="Couldn't load the audit log." onRetry={() => query.refetch()} />;
  }
  const filtered = query.data.rows.filter((event) =>
    `${event.action} ${event.entity_type} ${event.entity_id ?? ""} ${JSON.stringify(
      event.metadata,
    )}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  function exportCsv() {
    const current = query.data;
    if (!current) return;
    const header = ["time", "action", "entity_type", "entity_id", "actor", "metadata"];
    const lines = [
      header,
      ...filtered.map((event) => [
        event.created_at,
        event.action,
        event.entity_type,
        event.entity_id ?? "",
        event.actor_user_id
          ? (current.actors.get(event.actor_user_id) ?? event.actor_user_id)
          : "system",
        JSON.stringify(event.metadata),
      ]),
    ].map((row) => row.map(csvCell).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `canarygrid-audit-${workspace.slug}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Append-only workspace events for configuration, execution, decisions, and waivers."
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4" /> Export visible rows
          </Button>
        }
      />
      <label className="relative block max-w-xl">
        <span className="sr-only">Search audit events</span>
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search action, entity, or metadata"
        />
      </label>
      {query.data.count === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-5 w-5" />}
          title="No audit events yet"
          body="Configuration changes, runs, release decisions, and waivers will be recorded here."
        />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th className={tableHeaderClass}>Event</th>
              <th className={tableHeaderClass}>Entity</th>
              <th className={tableHeaderClass}>Actor</th>
              <th className={tableHeaderClass}>Metadata</th>
              <th className={tableHeaderClass}>Time</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((event) => (
              <tr key={event.id}>
                <td className={tableCellClass}>
                  <StatusBadge status={event.action.replaceAll(".", " ")} />
                  <Mono className="mt-1 block">{event.id.slice(0, 8)}</Mono>
                </td>
                <td className={tableCellClass}>
                  {event.entity_type === "release" && event.entity_id ? (
                    <Link
                      to="/releases/$releaseId"
                      params={{ releaseId: event.entity_id }}
                      className="font-medium text-primary hover:underline"
                    >
                      release
                    </Link>
                  ) : (
                    <span className="font-medium">{event.entity_type}</span>
                  )}
                  {event.entity_id && (
                    <Mono className="mt-1 block text-muted-foreground">
                      {event.entity_id.slice(0, 8)}
                    </Mono>
                  )}
                </td>
                <td className={tableCellClass}>
                  {event.actor_user_id
                    ? (query.data.actors.get(event.actor_user_id) ?? "Workspace member")
                    : "CanaryGrid"}
                </td>
                <td className={`${tableCellClass} max-w-sm`}>
                  <pre className="overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground">
                    {JSON.stringify(event.metadata)}
                  </pre>
                </td>
                <td className={tableCellClass}>{new Date(event.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {filtered.length === 0 && query.data.count > 0 && (
        <p className="text-sm text-muted-foreground">No audit events match this search.</p>
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

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
