import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Users, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, permissions, friendlyError } from "@/lib/workspace";
import {
  PageHeader,
  Loading,
  ErrorBox,
  EmptyState,
  StatusBadge,
  Mono,
} from "@/components/app/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/_app/archetypes")({
  head: () => ({ meta: [{ title: "Archetypes — CanaryGrid" }] }),
  component: Archetypes,
});

const schema = z.object({
  name: z.string().trim().min(2, "Name needs at least 2 characters").max(120),
  description: z.string().trim().max(1000).optional(),
  region: z.string().trim().min(1, "Region is required").max(40),
  auth_mode: z.string().trim().min(1, "Auth mode is required").max(40),
  permission_profile: z.string().trim().min(1, "Permission profile is required").max(60),
  risk_weight: z.number().int().min(1, "Risk weight is 1–100").max(100, "Risk weight is 1–100"),
  active: z.boolean(),
  flags: z.string().max(500),
});

type Form = z.infer<typeof schema> & {
  id?: string;
  capabilityIds: string[];
  integrationIds: string[];
};
const blank: Form = {
  name: "",
  description: "",
  region: "us",
  auth_mode: "oauth",
  permission_profile: "standard",
  risk_weight: 50,
  active: true,
  flags: "",
  capabilityIds: [],
  integrationIds: [],
};

function Archetypes() {
  const { workspace } = useWorkspace();
  const { canAdmin } = permissions(workspace.role);
  const canManage = canAdmin;
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  const q = useQuery({
    queryKey: ["archetypes", workspace.id],
    queryFn: async () => {
      const [a, c, i] = await Promise.all([
        supabase
          .from("tenant_archetypes")
          .select(
            "*, archetype_capabilities(capability_id), archetype_integrations(integration_id)",
          )
          .eq("workspace_id", workspace.id)
          .order("risk_weight", { ascending: false }),
        supabase
          .from("capabilities")
          .select("id, name")
          .eq("workspace_id", workspace.id)
          .order("name"),
        supabase
          .from("integrations")
          .select("id, name")
          .eq("workspace_id", workspace.id)
          .order("name"),
      ]);
      if (a.error) throw a.error;
      if (c.error) throw c.error;
      if (i.error) throw i.error;
      return { archetypes: a.data, capabilities: c.data, integrations: i.data };
    },
  });

  const save = useMutation({
    mutationFn: async (f: Form) => {
      const parsed = schema.parse(f);
      const flags = parsed.flags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const row = {
        _workspace_id: workspace.id,
        _archetype_id: f.id ?? (null as unknown as string),
        _name: parsed.name,
        _description: parsed.description ?? "",
        _region: parsed.region,
        _auth_mode: parsed.auth_mode,
        _permission_profile: parsed.permission_profile,
        _risk_weight: parsed.risk_weight,
        _active: parsed.active,
        _metadata: { feature_flags: flags },
        _capability_ids: f.capabilityIds,
        _integration_ids: f.integrationIds,
      };
      const { error } = await supabase.rpc("save_archetype", row);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Archetype saved");
      setForm(null);
      qc.invalidateQueries({ queryKey: ["archetypes", workspace.id] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof z.ZodError ? (e.issues[0]?.message ?? "Invalid input") : friendlyError(e),
      ),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("archive_archetype", { _archetype_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Archetype archived");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["archetypes", workspace.id] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data)
    return <ErrorBox message={friendlyError(q.error)} onRetry={() => q.refetch()} />;
  const { archetypes, capabilities, integrations } = q.data;
  const capName = Object.fromEntries(capabilities.map((c) => [c.id, c.name]));
  const atLimit = archetypes.length >= 20;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenant archetypes"
        description="Each archetype is a representative customer configuration. Higher risk weight means it is selected first for affected releases."
        actions={
          canManage && (
            <Button size="sm" disabled={atLimit} onClick={() => setForm(blank)}>
              <Plus className="h-4 w-4" /> New archetype
            </Button>
          )
        }
      />
      {atLimit && (
        <p className="text-sm text-muted-foreground">
          You've reached the 20-archetype limit for this workspace.
        </p>
      )}

      {archetypes.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No archetypes yet"
          body="Start with your riskiest customer shape — for example an EU tenant on SAML with restricted permissions and Salesforce."
          action={
            canManage ? (
              <Button size="sm" onClick={() => setForm(blank)}>
                Create first archetype
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Shape</th>
                <th className="hidden px-4 py-2 font-medium lg:table-cell">Capabilities</th>
                <th className="px-4 py-2 text-right font-medium">Risk</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {archetypes.map((a) => {
                const flags = (a.metadata as { feature_flags?: string[] })?.feature_flags ?? [];
                return (
                  <tr key={a.id} className={a.active ? "" : "opacity-55"}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{a.name}</div>
                      {!a.active && <StatusBadge status="inactive" className="mt-1" />}
                    </td>
                    <td className="px-4 py-3">
                      <Mono className="text-muted-foreground">
                        {a.region} · {a.auth_mode} · {a.permission_profile}
                        {flags.length ? ` · ${flags.join(", ")}` : ""}
                      </Mono>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                      {a.archetype_capabilities
                        .map((c) => capName[c.capability_id])
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{a.risk_weight}</td>
                    <td className="px-2 py-3 text-right">
                      {canManage && (
                        <div className="flex justify-end">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label="Edit"
                            onClick={() =>
                              setForm({
                                id: a.id,
                                name: a.name,
                                description: a.description ?? "",
                                region: a.region,
                                auth_mode: a.auth_mode,
                                permission_profile: a.permission_profile,
                                risk_weight: a.risk_weight,
                                active: a.active,
                                flags: flags.join(", "),
                                capabilityIds: a.archetype_capabilities.map((c) => c.capability_id),
                                integrationIds: a.archetype_integrations.map(
                                  (i) => i.integration_id,
                                ),
                              })
                            }
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            aria-label="Archive"
                            onClick={() => setDeleting({ id: a.id, name: a.name })}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit archetype" : "New archetype"}</DialogTitle>
          </DialogHeader>
          {form && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(form);
              }}
            >
              <Field label="Name">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="EU · SAML · Salesforce · restricted"
                />
              </Field>
              <Field label="Description">
                <Textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Region">
                  <Input
                    className="font-mono"
                    value={form.region}
                    onChange={(e) => setForm({ ...form, region: e.target.value })}
                  />
                </Field>
                <Field label="Auth mode">
                  <Input
                    className="font-mono"
                    value={form.auth_mode}
                    onChange={(e) => setForm({ ...form, auth_mode: e.target.value })}
                  />
                </Field>
                <Field label="Permissions">
                  <Input
                    className="font-mono"
                    value={form.permission_profile}
                    onChange={(e) => setForm({ ...form, permission_profile: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Feature flags (comma separated)">
                <Input
                  className="font-mono"
                  value={form.flags}
                  onChange={(e) => setForm({ ...form, flags: e.target.value })}
                  placeholder="bulk_sync_v2, new_export"
                />
              </Field>
              <Field label="Risk weight (1–100)">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={form.risk_weight}
                  onChange={(e) => setForm({ ...form, risk_weight: Number(e.target.value) })}
                />
              </Field>
              <CheckList
                label="Capabilities"
                items={capabilities}
                selected={form.capabilityIds}
                onChange={(capabilityIds) => setForm({ ...form, capabilityIds })}
                empty="Define capabilities on the Coverage page first."
              />
              <CheckList
                label="Providers"
                items={integrations}
                selected={form.integrationIds}
                onChange={(integrationIds) => setForm({ ...form, integrationIds })}
                empty="Add providers in Settings first."
              />
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.active}
                  onCheckedChange={(active) => setForm({ ...form, active })}
                />{" "}
                Active
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It will no longer be selected for new releases. Existing run history remains intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleting && del.mutate(deleting.id)}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export function CheckList({
  label,
  items,
  selected,
  onChange,
  empty,
}: {
  label: string;
  items: { id: string; name: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  empty: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded border p-2 sm:grid-cols-2">
          {items.map((it) => (
            <label key={it.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(it.id)}
                onCheckedChange={(c) =>
                  onChange(c ? [...selected, it.id] : selected.filter((x) => x !== it.id))
                }
              />
              <span className="truncate">{it.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
