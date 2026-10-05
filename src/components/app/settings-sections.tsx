import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Github, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { friendlyError, permissions, type WorkspaceSummary } from "@/lib/workspace";
import { Panel } from "@/components/app/app-surfaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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

type Role = Database["public"]["Enums"]["workspace_role"];
type Criticality = Database["public"]["Enums"]["criticality"];
type Member = Database["public"]["Functions"]["list_workspace_members"]["Returns"][number];
type Invitation = Database["public"]["Tables"]["workspace_invitations"]["Row"];
type AllowedHost = Database["public"]["Tables"]["workspace_allowed_hosts"]["Row"];
type Integration = Database["public"]["Tables"]["integrations"]["Row"];
type Capability = Database["public"]["Tables"]["capabilities"]["Row"] & {
  capability_path_rules: Pick<
    Database["public"]["Tables"]["capability_path_rules"]["Row"],
    "id" | "glob_pattern"
  >[];
};
type GitHubInstallation = Database["public"]["Tables"]["github_installations"]["Row"] & {
  github_installation_repositories: Pick<
    Database["public"]["Tables"]["github_installation_repositories"]["Row"],
    "id" | "repository_full_name" | "default_branch" | "active"
  >[];
};

export type SettingsData = {
  members: Member[];
  invitations: Invitation[];
  allowedHosts: AllowedHost[];
  integrations: Integration[];
  capabilities: Capability[];
  githubInstallations: GitHubInstallation[];
};

function useRefresh(workspaceId: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["settings", workspaceId] });
}

export function WorkspaceSettings({
  workspace,
  userId,
}: {
  workspace: WorkspaceSummary;
  userId: string;
}) {
  const { isOwner, canAdmin } = permissions(workspace.role);
  const refresh = useRefresh(workspace.id);
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [retentionDays, setRetentionDays] = useState(30);
  const [profileName, setProfileName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteName, setDeleteName] = useState("");

  useEffect(() => {
    setName(workspace.name);
    setSlug(workspace.slug);
    Promise.all([
      supabase.from("workspaces").select("retention_days").eq("id", workspace.id).single(),
      supabase.from("profiles").select("display_name").eq("id", userId).single(),
    ]).then(([workspaceResult, profileResult]) => {
      if (workspaceResult.data) setRetentionDays(workspaceResult.data.retention_days);
      if (profileResult.data) setProfileName(profileResult.data.display_name ?? "");
    });
  }, [userId, workspace.id, workspace.name, workspace.slug]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      const parsed = z.string().trim().min(2).max(80).parse(profileName);
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: parsed })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => toast.success("Profile updated"),
    onError: (error) => toast.error(friendlyError(error)),
  });

  const saveWorkspace = useMutation({
    mutationFn: async () => {
      const parsed = z
        .object({
          name: z.string().trim().min(2).max(80),
          slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/),
          retentionDays: z.number().int().min(7).max(365),
        })
        .parse({ name, slug, retentionDays });
      const { error } = await supabase
        .from("workspaces")
        .update({
          name: parsed.name,
          slug: parsed.slug,
          retention_days: parsed.retentionDays,
        })
        .eq("id", workspace.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Workspace updated");
      await refresh();
      window.location.reload();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const deleteWorkspace = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("workspaces").delete().eq("id", workspace.id);
      if (error) throw error;
    },
    onSuccess: () => {
      localStorage.removeItem("canarygrid.workspace");
      window.location.assign("/onboarding");
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  return (
    <div className="space-y-4">
      <Panel title="Your profile" description="Used to identify your actions in the audit log.">
        <div className="flex max-w-lg flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Display name" className="flex-1">
            <Input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
          </Field>
          <Button
            variant="outline"
            onClick={() => saveProfile.mutate()}
            disabled={saveProfile.isPending}
          >
            Save profile
          </Button>
        </div>
      </Panel>

      <Panel
        title="Workspace"
        description="Names, URLs, and evidence retention for this workspace."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Workspace name">
            <Input
              disabled={!canAdmin}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Workspace ID">
            <Input
              disabled={!canAdmin}
              className="font-mono"
              value={slug}
              onChange={(event) => setSlug(event.target.value.toLowerCase())}
            />
          </Field>
          <Field label="Evidence retention">
            <Select
              disabled={!canAdmin}
              value={String(retentionDays)}
              onValueChange={(value) => setRetentionDays(Number(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[7, 30, 90, 180, 365].map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {days} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {canAdmin && (
          <Button
            className="mt-4"
            onClick={() => saveWorkspace.mutate()}
            disabled={saveWorkspace.isPending}
          >
            {saveWorkspace.isPending ? "Saving…" : "Save workspace"}
          </Button>
        )}
      </Panel>

      {isOwner && (
        <Panel
          title="Delete workspace"
          description="Permanently removes configuration and evidence. This cannot be undone."
        >
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
            Delete workspace
          </Button>
        </Panel>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {workspace.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Type <strong>{workspace.name}</strong> to confirm. Every release, run, and audit
              record in this workspace will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label="Workspace name confirmation"
            value={deleteName}
            onChange={(event) => setDeleteName(event.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteName !== workspace.name || deleteWorkspace.isPending}
              onClick={() => deleteWorkspace.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function TeamSettings({
  workspace,
  userId,
  data,
}: {
  workspace: WorkspaceSummary;
  userId: string;
  data: SettingsData;
}) {
  const { canAdmin } = permissions(workspace.role);
  const refresh = useRefresh(workspace.id);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("engineer");
  const [invitationUrl, setInvitationUrl] = useState("");

  const invite = useMutation({
    mutationFn: async () => {
      const validEmail = z.string().trim().email().parse(email);
      const { data: result, error } = await supabase
        .rpc("create_workspace_invitation", {
          _workspace_id: workspace.id,
          _email: validEmail,
          _role: role,
        })
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: (result) => {
      const url = `${window.location.origin}/invite?token=${result.invitation_token}`;
      setInvitationUrl(url);
      navigator.clipboard
        .writeText(url)
        .then(() => toast.success("Invitation link copied"))
        .catch(() => toast.success("Invitation created"));
      setEmail("");
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const changeRole = useMutation({
    mutationFn: async ({ membershipId, nextRole }: { membershipId: string; nextRole: Role }) => {
      const { error } = await supabase
        .from("workspace_members")
        .update({ role: nextRole })
        .eq("id", membershipId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Role updated");
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const removeMember = useMutation({
    mutationFn: async (membershipId: string) => {
      const { error } = await supabase.from("workspace_members").delete().eq("id", membershipId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member removed");
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const revokeInvite = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await supabase
        .from("workspace_invitations")
        .delete()
        .eq("id", invitationId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invitation revoked");
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  return (
    <div className="space-y-4">
      {canAdmin && (
        <Panel
          title="Invite a teammate"
          description="Invitation links expire after seven days and can only be used by the invited email."
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_150px_auto] sm:items-end">
            <Field label="Work email">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="engineer@company.com"
              />
            </Field>
            <Field label="Role">
              <Select value={role} onValueChange={(value) => setRole(value as typeof role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="engineer">Engineer</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Button onClick={() => invite.mutate()} disabled={invite.isPending || !email}>
              Invite
            </Button>
          </div>
          {invitationUrl && (
            <div className="mt-3 flex items-center gap-2 rounded-md border bg-muted/30 p-2">
              <Input
                aria-label="Invitation link"
                className="h-8 font-mono text-xs"
                readOnly
                value={invitationUrl}
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label="Copy invitation link"
                onClick={() => {
                  navigator.clipboard
                    .writeText(invitationUrl)
                    .then(() => toast.success("Invitation link copied"))
                    .catch(() => toast.error("Copy the invitation link manually."));
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}
        </Panel>
      )}

      <Panel title="Members">
        <div className="divide-y rounded-md border">
          {data.members.map((member) => {
            const editable = canAdmin && member.role !== "owner" && member.user_id !== userId;
            return (
              <div
                key={member.membership_id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.display_name || member.email}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>
                <Select
                  disabled={!editable}
                  value={member.role}
                  onValueChange={(nextRole) =>
                    changeRole.mutate({
                      membershipId: member.membership_id,
                      nextRole: nextRole as Role,
                    })
                  }
                >
                  <SelectTrigger className="w-32 capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="engineer">Engineer</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    {member.role === "owner" && <SelectItem value="owner">Owner</SelectItem>}
                  </SelectContent>
                </Select>
                {editable && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${member.email}`}
                    onClick={() => removeMember.mutate(member.membership_id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      {canAdmin && data.invitations.some((invitation) => !invitation.accepted_at) && (
        <Panel title="Pending invitations">
          <div className="divide-y rounded-md border">
            {data.invitations
              .filter((invitation) => !invitation.accepted_at)
              .map((invitation) => (
                <div key={invitation.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{invitation.email}</span>
                  <span className="capitalize text-muted-foreground">{invitation.role}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revokeInvite.mutate(invitation.id)}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

type CapabilityForm = {
  id?: string;
  name: string;
  description: string;
  criticality: Criticality;
  active: boolean;
  pathRules: string;
};

export function CapabilitySettings({
  workspace,
  capabilities,
}: {
  workspace: WorkspaceSummary;
  capabilities: Capability[];
}) {
  const { canAdmin } = permissions(workspace.role);
  const refresh = useRefresh(workspace.id);
  const [form, setForm] = useState<CapabilityForm | null>(null);

  const save = useMutation({
    mutationFn: async (value: CapabilityForm) => {
      const parsed = z
        .object({
          name: z.string().trim().min(2).max(120),
          description: z.string().trim().max(1000),
          pathRules: z.string().max(10000),
        })
        .parse(value);
      const pathRules = [
        ...new Set(
          parsed.pathRules
            .split("\n")
            .map((rule) => rule.trim())
            .filter(Boolean),
        ),
      ];
      const { error } = await supabase.rpc("save_capability", {
        _workspace_id: workspace.id,
        _capability_id: value.id ?? (null as unknown as string),
        _name: parsed.name,
        _description: parsed.description,
        _criticality: value.criticality,
        _active: value.active,
        _path_rules: pathRules,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Capability saved");
      setForm(null);
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  return (
    <Panel
      title="Capabilities and path rules"
      description="Changed files map to capabilities, which determine the journeys a release must pass."
    >
      {canAdmin && (
        <Button
          size="sm"
          onClick={() =>
            setForm({
              name: "",
              description: "",
              criticality: "medium",
              active: true,
              pathRules: "",
            })
          }
        >
          <Plus className="h-4 w-4" /> Add capability
        </Button>
      )}
      <div className="mt-4 divide-y rounded-md border">
        {capabilities.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Add the first customer-facing capability and the repository paths that affect it.
          </p>
        ) : (
          capabilities.map((capability) => (
            <button
              key={capability.id}
              type="button"
              disabled={!canAdmin}
              onClick={() =>
                setForm({
                  id: capability.id,
                  name: capability.name,
                  description: capability.description ?? "",
                  criticality: capability.criticality,
                  active: capability.active,
                  pathRules: capability.capability_path_rules
                    .map((rule) => rule.glob_pattern)
                    .join("\n"),
                })
              }
              className="flex w-full items-start gap-4 px-4 py-3 text-left disabled:cursor-default"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{capability.name}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">
                  {capability.capability_path_rules.map((rule) => rule.glob_pattern).join(", ") ||
                    "No paths configured"}
                </span>
              </span>
              <span className="text-xs capitalize text-muted-foreground">
                {capability.criticality}
              </span>
            </button>
          ))
        )}
      </div>

      <Dialog open={!!form} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit capability" : "New capability"}</DialogTitle>
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
                />
              </Field>
              <Field label="Description">
                <Textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </Field>
              <Field label="Criticality">
                <Select
                  value={form.criticality}
                  onValueChange={(value) => setForm({ ...form, criticality: value as Criticality })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["low", "medium", "high", "critical"] as const).map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Repository paths, one glob per line">
                <Textarea
                  className="min-h-28 font-mono text-xs"
                  value={form.pathRules}
                  onChange={(event) => setForm({ ...form, pathRules: event.target.value })}
                  placeholder={"src/scheduling/**\npackages/calendar/**"}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.active}
                  onCheckedChange={(active) => setForm({ ...form, active })}
                />
                Active
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save capability"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

type IntegrationForm = {
  id?: string;
  name: string;
  providerKey: string;
  environment: string;
  baseUrl: string;
  active: boolean;
};

export function IntegrationSettings({
  workspace,
  data,
}: {
  workspace: WorkspaceSummary;
  data: SettingsData;
}) {
  const { canAdmin } = permissions(workspace.role);
  const refresh = useRefresh(workspace.id);
  const [hostname, setHostname] = useState("");
  const [form, setForm] = useState<IntegrationForm | null>(null);

  const addHost = useMutation({
    mutationFn: async () => {
      const value = z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9.-]+$/)
        .parse(hostname);
      const { error } = await supabase
        .from("workspace_allowed_hosts")
        .insert({ workspace_id: workspace.id, hostname: value });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Hostname allowed");
      setHostname("");
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const removeHost = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workspace_allowed_hosts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refresh(),
    onError: (error) => toast.error(friendlyError(error)),
  });

  const save = useMutation({
    mutationFn: async (value: IntegrationForm) => {
      const parsed = z
        .object({
          name: z.string().trim().min(2).max(120),
          providerKey: z
            .string()
            .trim()
            .regex(/^[a-z0-9_-]{2,40}$/),
          environment: z.string().trim().min(2).max(40),
          baseUrl: z.string().url().startsWith("https://"),
        })
        .parse(value);
      const { error } = await supabase.rpc("save_integration", {
        _workspace_id: workspace.id,
        _integration_id: value.id ?? (null as unknown as string),
        _name: parsed.name,
        _provider_key: parsed.providerKey,
        _environment: parsed.environment,
        _base_url: parsed.baseUrl,
        _active: value.active,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Provider saved");
      setForm(null);
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  return (
    <div className="space-y-4">
      <Panel
        title="Outbound host allowlist"
        description="The runner rejects every destination not explicitly listed here."
      >
        {canAdmin && (
          <div className="flex max-w-lg gap-2">
            <Input
              className="font-mono"
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              placeholder="api.example.com"
            />
            <Button
              variant="outline"
              onClick={() => addHost.mutate()}
              disabled={!hostname || addHost.isPending}
            >
              Add
            </Button>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {data.allowedHosts.map((host) => (
            <span
              key={host.id}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs"
            >
              {host.hostname}
              {canAdmin && (
                <button
                  type="button"
                  onClick={() => removeHost.mutate(host.id)}
                  aria-label={`Remove ${host.hostname}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {data.allowedHosts.length === 0 && (
            <p className="text-sm text-muted-foreground">No outbound hosts are allowed.</p>
          )}
        </div>
      </Panel>

      <Panel
        title="Providers"
        description="Define the HTTPS APIs journeys can exercise. Credentials are managed separately."
      >
        {canAdmin && (
          <Button
            size="sm"
            onClick={() =>
              setForm({
                name: "",
                providerKey: "",
                environment: "sandbox",
                baseUrl: "",
                active: true,
              })
            }
          >
            <Plus className="h-4 w-4" /> Add provider
          </Button>
        )}
        <div className="mt-4 divide-y rounded-md border">
          {data.integrations.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Add an allowed hostname, then configure the first API provider.
            </p>
          ) : (
            data.integrations.map((integration) => (
              <button
                key={integration.id}
                type="button"
                disabled={!canAdmin}
                onClick={() =>
                  setForm({
                    id: integration.id,
                    name: integration.name,
                    providerKey: integration.provider_key,
                    environment: integration.environment,
                    baseUrl: integration.base_url,
                    active: integration.active,
                  })
                }
                className="flex w-full items-center gap-4 px-4 py-3 text-left disabled:cursor-default"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{integration.name}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {integration.base_url}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{integration.environment}</span>
              </button>
            ))
          )}
        </div>
      </Panel>

      <Dialog open={!!form} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit provider" : "New provider"}</DialogTitle>
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
                  placeholder="Salesforce sandbox"
                />
              </Field>
              <Field label="Provider key">
                <Input
                  className="font-mono"
                  value={form.providerKey}
                  onChange={(event) =>
                    setForm({ ...form, providerKey: event.target.value.toLowerCase() })
                  }
                  placeholder="salesforce"
                />
              </Field>
              <Field label="Environment">
                <Input
                  value={form.environment}
                  onChange={(event) => setForm({ ...form, environment: event.target.value })}
                />
              </Field>
              <Field label="Base URL">
                <Input
                  type="url"
                  className="font-mono"
                  value={form.baseUrl}
                  onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                  placeholder="https://api.example.com"
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.active}
                  onCheckedChange={(active) => setForm({ ...form, active })}
                />
                Active
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save provider"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function GitHubSettings({
  workspace,
  installations,
  callback,
}: {
  workspace: WorkspaceSummary;
  installations: GitHubInstallation[];
  callback: { installation_id: string | undefined; state: string | undefined };
}) {
  const { isOwner } = permissions(workspace.role);
  const refresh = useRefresh(workspace.id);
  const callbackStarted = useRef(false);

  const connect = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("github-installation", {
        body: { action: "install_url", workspace_id: workspace.id },
      });
      if (error) throw error;
      if (!data?.data?.url) throw new Error("GitHub installation URL was not returned");
      window.location.assign(data.data.url);
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const bind = useMutation({
    mutationFn: async ({ installationId, state }: { installationId: number; state: string }) => {
      const { data, error } = await supabase.functions.invoke("github-installation", {
        body: {
          action: "bind",
          installation_id: installationId,
          state,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      toast.success("GitHub repository connected");
      window.history.replaceState({}, "", "/settings");
      await refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const disconnect = useMutation({
    mutationFn: async (installationId: number) => {
      const { error } = await supabase.functions.invoke("github-installation", {
        body: {
          action: "disconnect",
          workspace_id: workspace.id,
          installation_id: installationId,
        },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("GitHub connection removed");
      await refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  useEffect(() => {
    if (callbackStarted.current || !callback.installation_id || !callback.state) {
      return;
    }
    const installationId = Number(callback.installation_id);
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      toast.error("GitHub returned an invalid installation.");
      return;
    }
    callbackStarted.current = true;
    bind.mutate({ installationId, state: callback.state });
  }, [bind, callback.installation_id, callback.state]);

  const active = installations.filter((installation) => installation.status !== "removed");
  return (
    <Panel
      title="GitHub App"
      description="Receive pull requests and publish tenant compatibility checks with least-privilege access."
    >
      {active.length === 0 ? (
        <div className="max-w-xl space-y-4">
          <p className="text-sm leading-6 text-muted-foreground">
            Connect CanaryGrid's GitHub App to map changed files to capabilities and run the release
            gate. CanaryGrid requests read access to code and pull requests plus write access to
            checks. It cannot modify repository code.
          </p>
          {isOwner ? (
            <Button onClick={() => connect.mutate()} disabled={connect.isPending || bind.isPending}>
              <Github className="h-4 w-4" />
              {bind.isPending ? "Finishing connection…" : "Connect GitHub"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              A workspace owner must connect the GitHub App.
            </p>
          )}
        </div>
      ) : (
        <div className="divide-y rounded-md border">
          {active.map((installation) => (
            <div
              key={installation.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start"
            >
              <Github className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {installation.github_account_login ?? "GitHub installation"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {installation.status === "suspended"
                    ? "Suspended in GitHub. Resume the installation before running release gates."
                    : "Active installation"}
                </p>
                <div className="mt-3 space-y-1.5">
                  {installation.github_installation_repositories
                    .filter((repository) => repository.active)
                    .map((repository) => (
                      <div
                        key={repository.id}
                        className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2"
                      >
                        <span className="truncate font-mono text-xs">
                          {repository.repository_full_name}
                        </span>
                        <span className="ml-3 text-xs text-muted-foreground">
                          {repository.default_branch}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
              {isOwner && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate(installation.installation_id)}
                >
                  Disconnect
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
