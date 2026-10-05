import { createContext, useContext } from "react";
import type { Database } from "@/integrations/supabase/types";

export type WorkspaceRole = Database["public"]["Enums"]["workspace_role"];

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
};

export type WorkspaceCtx = {
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
  userId: string;
  email: string | null;
  setWorkspaceId: (id: string) => void;
};

export const WorkspaceContext = createContext<WorkspaceCtx | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside the app shell");
  return ctx;
}

export const WS_STORAGE_KEY = "canarygrid.workspace";
export const PENDING_INVITE_KEY = "canarygrid.pendingInvite";

// UI hints only. Authorization is enforced by database policies.
export function permissions(role: WorkspaceRole) {
  return {
    isOwner: role === "owner",
    canAdmin: role === "owner" || role === "admin",
    canEdit: role === "owner" || role === "admin" || role === "engineer",
  };
}

export function friendlyError(err: unknown): string {
  const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
  if (/row-level security|permission denied/i.test(msg)) return "Your role doesn't allow this action.";
  if (/duplicate key/i.test(msg)) return "Something with that name already exists.";
  if (/at most 20 tenant archetypes/i.test(msg)) return "A workspace can have at most 20 archetypes.";
  if (/violates check constraint/i.test(msg)) return "One of the values isn't valid. Check the form and try again.";
  if (/Failed to fetch|NetworkError/i.test(msg)) return "Couldn't reach the server. Check your connection and retry.";
  return msg;
}
