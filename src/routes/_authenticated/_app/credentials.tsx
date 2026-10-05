import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { KeyRound, LockKeyhole, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader, StatusBadge, Loading, ErrorBox, EmptyState } from "@/components/app/ui-bits";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError, permissions, useWorkspace } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/_app/credentials")({
  head: () => ({ meta: [{ title: "Credentials — CanaryGrid" }] }),
  component: PCredentials,
});

export function PCredentials() {
  const { workspace } = useWorkspace();
  const { canAdmin } = permissions(workspace.role);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<{
    id?: string;
    name: string;
    integrationId: string;
    archetypeId: string;
    expiresAt: string;
    secretJson: string;
  } | null>(null);

  const query = useQuery({
    queryKey: ["credentials", workspace.id],
    queryFn: async () => {
      const [credentials, integrations, archetypes] = await Promise.all([
        supabase
          .from("credential_records")
          .select(
            "id, workspace_id, integration_id, archetype_id, name, encryption_version, health_status, last_checked_at, expires_at, created_by, created_at, updated_at",
          )
          .eq("workspace_id", workspace.id)
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
          .is("archived_at", null)
          .order("name"),
      ]);
      if (credentials.error) throw credentials.error;
      if (integrations.error) throw integrations.error;
      if (archetypes.error) throw archetypes.error;
      return {
        credentials: credentials.data,
        integrations: integrations.data,
        archetypes: archetypes.data,
      };
    },
  });

  const save = useMutation({
    mutationFn: async (value: NonNullable<typeof form>) => {
      const parsed = z
        .object({
          name: z.string().trim().min(2).max(120),
          integrationId: z.string().uuid(),
          expiresAt: z.string(),
          secretJson: z.string().min(2).max(100_000),
        })
        .parse(value);
      let secret: Record<string, string>;
      try {
        const candidate = JSON.parse(parsed.secretJson) as unknown;
        secret = z.record(z.string(), z.string().min(1)).parse(candidate);
      } catch {
        throw new Error("Secret fields must be a JSON object containing string values.");
      }
      const { data, error } = await supabase.functions.invoke("credential-write", {
        body: {
          workspace_id: workspace.id,
          credential_id: value.id,
          integration_id: parsed.integrationId,
          archetype_id: value.archetypeId || null,
          name: parsed.name,
          expires_at: parsed.expiresAt ? new Date(parsed.expiresAt).toISOString() : null,
          secret,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error.message);
    },
    onSuccess: () => {
      toast.success(form?.id ? "Credential replaced" : "Credential stored");
      setForm(null);
      queryClient.invalidateQueries({ queryKey: ["credentials", workspace.id] });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const health = useMutation({
    mutationFn: async (credentialId: string) => {
      const { data, error } = await supabase.functions.invoke("credential-health", {
        body: { workspace_id: workspace.id, credential_id: credentialId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error.message);
      return data;
    },
    onSuccess: () => {
      toast.success("Encrypted credential is healthy");
      queryClient.invalidateQueries({ queryKey: ["credentials", workspace.id] });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  if (query.isLoading) return <Loading label="Loading credentials" />;
  if (query.error || !query.data)
    return (
      <ErrorBox message="Couldn't load credential metadata." onRetry={() => query.refetch()} />
    );

  const integrationNames = Object.fromEntries(
    query.data.integrations.map((integration) => [integration.id, integration.name]),
  );
  const archetypeNames = Object.fromEntries(
    query.data.archetypes.map((archetype) => [archetype.id, archetype.name]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credentials"
        description="Connection metadata and credential health. Secret values are never displayed."
        actions={
          canAdmin && query.data.integrations.length ? (
            <Button
              size="sm"
              onClick={() =>
                setForm({
                  name: "",
                  integrationId: query.data.integrations[0]?.id ?? "",
                  archetypeId: "",
                  expiresAt: "",
                  secretJson: '{\n  "token": ""\n}',
                })
              }
            >
              <Plus className="h-4 w-4" /> Add credential
            </Button>
          ) : undefined
        }
      />

      {query.data.credentials.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="h-6 w-6" />}
          title="No credentials stored"
          body={
            query.data.integrations.length
              ? "Store the least-privilege canary account secret for a configured provider."
              : "Configure a provider in Settings before storing credentials."
          }
          action={
            canAdmin && query.data.integrations.length ? (
              <Button
                size="sm"
                onClick={() =>
                  setForm({
                    name: "",
                    integrationId: query.data.integrations[0]?.id ?? "",
                    archetypeId: "",
                    expiresAt: "",
                    secretJson: '{\n  "token": ""\n}',
                  })
                }
              >
                Add first credential
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="divide-y rounded-md border">
          {query.data.credentials.map((credential) => (
            <div
              key={credential.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
            >
              <LockKeyhole className="h-5 w-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{credential.name}</p>
                  <StatusBadge status={credential.health_status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {integrationNames[credential.integration_id] ?? "Provider removed"}
                  {credential.archetype_id
                    ? ` · ${archetypeNames[credential.archetype_id] ?? "Archived archetype"}`
                    : " · Shared"}
                  {credential.last_checked_at
                    ? ` · checked ${new Date(credential.last_checked_at).toLocaleString()}`
                    : ""}
                </p>
              </div>
              {canAdmin && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={health.isPending}
                    onClick={() => health.mutate(credential.id)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Check
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setForm({
                        id: credential.id,
                        name: credential.name,
                        integrationId: credential.integration_id,
                        archetypeId: credential.archetype_id ?? "",
                        expiresAt: credential.expires_at ? credential.expires_at.slice(0, 10) : "",
                        secretJson: '{\n  "token": ""\n}',
                      })
                    }
                  >
                    Replace
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-md border bg-muted/20 p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <LockKeyhole className="h-4 w-4 text-success" /> Secret boundary
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Secrets are encrypted in the Edge Function, never returned by the API, and can only be
          replaced—not revealed.
        </p>
      </div>

      <Dialog open={!!form} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Replace credential" : "Add credential"}</DialogTitle>
          </DialogHeader>
          {form && (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate(form);
              }}
            >
              <Field label="Name">
                <Input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Ashby canary account"
                />
              </Field>
              <Field label="Provider">
                <Select
                  value={form.integrationId}
                  onValueChange={(integrationId) => setForm({ ...form, integrationId })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {query.data.integrations.map((integration) => (
                      <SelectItem key={integration.id} value={integration.id}>
                        {integration.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Archetype scope">
                <Select
                  value={form.archetypeId || "shared"}
                  onValueChange={(archetypeId) =>
                    setForm({ ...form, archetypeId: archetypeId === "shared" ? "" : archetypeId })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shared">Shared across archetypes</SelectItem>
                    {query.data.archetypes.map((archetype) => (
                      <SelectItem key={archetype.id} value={archetype.id}>
                        {archetype.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Expires on (optional)">
                <Input
                  type="date"
                  value={form.expiresAt}
                  onChange={(event) => setForm({ ...form, expiresAt: event.target.value })}
                />
              </Field>
              <Field label="Secret fields (JSON)">
                <Textarea
                  className="min-h-36 font-mono text-xs"
                  value={form.secretJson}
                  onChange={(event) => setForm({ ...form, secretJson: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                This value is sent directly to the local or hosted Edge Function and is never
                written to browser storage.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending
                    ? "Encrypting…"
                    : form.id
                      ? "Replace credential"
                      : "Store credential"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
