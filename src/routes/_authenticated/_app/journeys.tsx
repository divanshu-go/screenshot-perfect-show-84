import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pencil, Play, Plus, Route as RouteIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  PageHeader,
  Loading,
  ErrorBox,
  EmptyState,
  Mono,
  StatusBadge,
} from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  JourneyEditor,
  type JourneyEditorValue,
  type JourneyEditorStep,
} from "@/components/app/journey-editor";
import { friendlyError, permissions, useWorkspace } from "@/lib/workspace";
import type { JourneyStepDraft } from "@/lib/journey-domain";

export const Route = createFileRoute("/_authenticated/_app/journeys")({
  head: () => ({ meta: [{ title: "Journeys — CanaryGrid" }] }),
  component: PJourneys,
});

const emptyJourney: JourneyEditorValue = {
  name: "",
  description: "",
  integrationId: "",
  timeoutMs: 10_000,
  active: true,
  capabilityIds: [],
  steps: [
    {
      name: "Create resource",
      method: "POST",
      pathTemplate: "/resources",
      requestHeaders: "{}",
      requestBody: "{}",
      extractionRules: [],
      continueOnFailure: false,
      isCleanup: false,
      assertions: [
        {
          assertion_type: "http_status",
          target: "",
          operator: "eq",
          expected_value: 201,
          expectedText: "201",
        },
      ],
    },
  ],
};

export function PJourneys() {
  const { workspace } = useWorkspace();
  const { canEdit, canAdmin } = permissions(workspace.role);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<JourneyEditorValue | null>(null);
  const [runningJourneyId, setRunningJourneyId] = useState<string | null>(null);
  const [archetypeId, setArchetypeId] = useState("");

  const query = useQuery({
    queryKey: ["journeys", workspace.id],
    queryFn: async () => {
      const [journeys, capabilities, integrations, archetypes] = await Promise.all([
        supabase
          .from("journeys")
          .select(
            "*, integrations(id, name), journey_capabilities(capability_id), journey_steps(*, journey_assertions(*))",
          )
          .eq("workspace_id", workspace.id)
          .order("name"),
        supabase
          .from("capabilities")
          .select("id, name")
          .eq("workspace_id", workspace.id)
          .eq("active", true)
          .order("name"),
        supabase
          .from("integrations")
          .select("id, name")
          .eq("workspace_id", workspace.id)
          .eq("active", true)
          .order("name"),
        supabase
          .from("tenant_archetypes")
          .select("id, name")
          .eq("workspace_id", workspace.id)
          .eq("active", true)
          .is("archived_at", null)
          .order("name"),
      ]);
      if (journeys.error) throw journeys.error;
      if (capabilities.error) throw capabilities.error;
      if (integrations.error) throw integrations.error;
      if (archetypes.error) throw archetypes.error;
      return {
        journeys: journeys.data,
        capabilities: capabilities.data,
        integrations: integrations.data,
        archetypes: archetypes.data,
      };
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      if (!runningJourneyId || !archetypeId) throw new Error("Choose a tenant archetype");
      const { data, error } = await supabase.functions.invoke("journey-run", {
        body: {
          workspace_id: workspace.id,
          journey_id: runningJourneyId,
          archetype_id: archetypeId,
          idempotency_key: `manual:${runningJourneyId}:${archetypeId}:${crypto.randomUUID()}`,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Run finished: ${data?.data?.status ?? "recorded"}`);
      setRunningJourneyId(null);
      queryClient.invalidateQueries({ queryKey: ["runs", workspace.id] });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const save = useMutation({
    mutationFn: async ({
      value,
      steps,
    }: {
      value: JourneyEditorValue;
      steps: JourneyStepDraft[];
    }) => {
      const primary = steps.filter((step) => !step.is_cleanup);
      const cleanup = steps.filter((step) => step.is_cleanup);
      const persistedSteps = [...primary, ...cleanup].map((step, index) => ({
        ...step,
        position: step.is_cleanup ? cleanup.indexOf(step) : primary.indexOf(step),
        assertions: step.assertions,
      }));
      const { error } = await supabase.rpc("save_journey", {
        _workspace_id: workspace.id,
        _journey_id: value.id ?? (null as unknown as string),
        _name: value.name,
        _description: value.description,
        _integration_id: value.integrationId,
        _timeout_ms: value.timeoutMs,
        _active: value.active,
        _capability_ids: value.capabilityIds,
        _steps: persistedSteps as unknown as Json,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Journey saved");
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["journeys", workspace.id] });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("journeys").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Journey deleted");
      queryClient.invalidateQueries({ queryKey: ["journeys", workspace.id] });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  if (query.isLoading) return <Loading label="Loading journeys" />;
  if (query.error || !query.data)
    return <ErrorBox message="Couldn't load journeys." onRetry={() => query.refetch()} />;

  const capabilityById = new Map(query.data.capabilities.map((item) => [item.id, item]));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Journeys"
        description="Declarative API workflows that prove customer-critical behavior before a release ships."
        actions={
          canEdit ? (
            <Button
              size="sm"
              disabled={!query.data.capabilities.length || !query.data.integrations.length}
              onClick={() => setEditing({ ...emptyJourney, steps: [...emptyJourney.steps] })}
            >
              <Plus className="h-4 w-4" /> New journey
            </Button>
          ) : undefined
        }
      />

      {query.data.journeys.length === 0 ? (
        <EmptyState
          icon={<RouteIcon className="h-6 w-6" />}
          title="No journeys yet"
          body={
            query.data.integrations.length && query.data.capabilities.length
              ? "Create the first API workflow that must pass for an affected customer capability."
              : "Add a capability and provider in Settings before creating a journey."
          }
          action={
            canEdit && query.data.integrations.length && query.data.capabilities.length ? (
              <Button size="sm" onClick={() => setEditing({ ...emptyJourney })}>
                Create first journey
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="divide-y rounded-md border">
          {query.data.journeys.map((journey) => {
            const orderedSteps = [...journey.journey_steps].sort(
              (left, right) =>
                Number(left.is_cleanup) - Number(right.is_cleanup) ||
                left.position - right.position,
            );
            return (
              <div key={journey.id} className="flex items-start gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{journey.name}</p>
                    <StatusBadge status={journey.active ? "active" : "inactive"} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {journey.integrations?.name ?? "Provider removed"} ·{" "}
                    {orderedSteps.filter((step) => !step.is_cleanup).length} steps ·{" "}
                    {orderedSteps.reduce(
                      (total, step) => total + step.journey_assertions.length,
                      0,
                    )}{" "}
                    assertions
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {journey.journey_capabilities.map((item) => (
                      <span key={item.capability_id} className="rounded bg-muted px-2 py-1 text-xs">
                        {capabilityById.get(item.capability_id)?.name}
                      </span>
                    ))}
                  </div>
                  {orderedSteps[0] && (
                    <Mono className="mt-3 block text-xs text-muted-foreground">
                      {orderedSteps[0].method} {orderedSteps[0].path_template}
                    </Mono>
                  )}
                </div>
                {canEdit && journey.active && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Run ${journey.name}`}
                    onClick={() => {
                      setArchetypeId(query.data.archetypes[0]?.id ?? "");
                      setRunningJourneyId(journey.id);
                    }}
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                )}
                {canEdit && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${journey.name}`}
                    onClick={() => setEditing(toEditorValue(journey))}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
                {canAdmin && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete ${journey.name}`}
                    onClick={() => remove.mutate(journey.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!runningJourneyId} onOpenChange={(open) => !open && setRunningJourneyId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run journey</DialogTitle>
          </DialogHeader>
          {query.data.archetypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Create an active tenant archetype before running this journey.
            </p>
          ) : (
            <Select value={archetypeId} onValueChange={setArchetypeId}>
              <SelectTrigger aria-label="Tenant archetype">
                <SelectValue placeholder="Choose an archetype" />
              </SelectTrigger>
              <SelectContent>
                {query.data.archetypes.map((archetype) => (
                  <SelectItem key={archetype.id} value={archetype.id}>
                    {archetype.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRunningJourneyId(null)}>
              Cancel
            </Button>
            <Button disabled={!archetypeId || run.isPending} onClick={() => run.mutate()}>
              {run.isPending ? "Running…" : "Start run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editing && (
        <JourneyEditor
          key={editing.id ?? "new"}
          open
          initialValue={editing}
          capabilities={query.data.capabilities}
          integrations={query.data.integrations}
          saving={save.isPending}
          onOpenChange={(open) => !open && setEditing(null)}
          onSave={(value, steps) => save.mutate({ value, steps })}
        />
      )}
    </div>
  );
}

function toEditorValue(journey: {
  id: string;
  name: string;
  description: string | null;
  integration_id: string | null;
  timeout_ms: number;
  active: boolean;
  journey_capabilities: { capability_id: string }[];
  journey_steps: Array<{
    id: string;
    name: string;
    method: string;
    path_template: string;
    request_headers: Json;
    request_body: Json | null;
    extraction_rules: Json;
    continue_on_failure: boolean;
    is_cleanup: boolean;
    position: number;
    journey_assertions: Array<{
      assertion_type: string;
      target: string | null;
      operator: string;
      expected_value: Json | null;
    }>;
  }>;
}): JourneyEditorValue {
  const steps: JourneyEditorStep[] = [...journey.journey_steps]
    .sort(
      (left, right) =>
        Number(left.is_cleanup) - Number(right.is_cleanup) || left.position - right.position,
    )
    .map((step) => ({
      id: step.id,
      name: step.name,
      method: step.method as JourneyEditorStep["method"],
      pathTemplate: step.path_template,
      requestHeaders: JSON.stringify(step.request_headers ?? {}, null, 2),
      requestBody: step.request_body === null ? "" : JSON.stringify(step.request_body, null, 2),
      extractionRules: Array.isArray(step.extraction_rules)
        ? (step.extraction_rules as unknown as JourneyEditorStep["extractionRules"])
        : [],
      continueOnFailure: step.continue_on_failure,
      isCleanup: step.is_cleanup,
      assertions: step.journey_assertions.map((assertion) => ({
        assertion_type:
          assertion.assertion_type as JourneyEditorStep["assertions"][number]["assertion_type"],
        target: assertion.target ?? "",
        operator: assertion.operator,
        expected_value: assertion.expected_value,
        expectedText:
          assertion.expected_value === null ? "" : JSON.stringify(assertion.expected_value),
      })),
    }));
  return {
    id: journey.id,
    name: journey.name,
    description: journey.description ?? "",
    integrationId: journey.integration_id ?? "",
    timeoutMs: journey.timeout_ms,
    active: journey.active,
    capabilityIds: journey.journey_capabilities.map((item) => item.capability_id),
    steps,
  };
}
