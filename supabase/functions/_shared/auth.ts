import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export type WorkspaceRole = "owner" | "admin" | "engineer" | "viewer";

const roleRank: Record<WorkspaceRole, number> = {
  viewer: 1,
  engineer: 2,
  admin: 3,
  owner: 4,
};

export type FunctionContext = {
  user: User;
  admin: SupabaseClient;
  role: WorkspaceRole;
};

export async function requireWorkspaceRole(
  request: Request,
  workspaceId: string,
  minimumRole: WorkspaceRole,
): Promise<FunctionContext> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("Authentication required");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error("Server configuration is unavailable");
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new Error("Authentication required");

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const membership = await admin
    .from("workspace_members")
    .select("role, accepted_at")
    .eq("workspace_id", workspaceId)
    .eq("user_id", data.user.id)
    .not("accepted_at", "is", null)
    .maybeSingle();

  if (
    membership.error ||
    !membership.data ||
    roleRank[membership.data.role as WorkspaceRole] < roleRank[minimumRole]
  ) {
    throw new Error("Not authorized");
  }

  return {
    user: data.user,
    admin,
    role: membership.data.role as WorkspaceRole,
  };
}
