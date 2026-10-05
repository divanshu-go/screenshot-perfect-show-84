import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, GitPullRequest, Grid3x3, Users, Route as RouteIcon, Play, Layers, KeyRound, ScrollText, Settings, Menu, LogOut, ChevronsUpDown, Plus,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { WorkspaceContext, WS_STORAGE_KEY, type WorkspaceSummary } from "@/lib/workspace";
import { Loading, ErrorBox } from "@/components/app/ui-bits";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authenticated/_app")({
  component: AppShell,
});

const nav = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/releases", label: "Releases", icon: GitPullRequest },
  { to: "/coverage", label: "Coverage", icon: Grid3x3 },
  { to: "/archetypes", label: "Archetypes", icon: Users },
  { to: "/journeys", label: "Journeys", icon: RouteIcon },
  { to: "/runs", label: "Runs", icon: Play },
  { to: "/clusters", label: "Failure Clusters", icon: Layers },
  { to: "/credentials", label: "Credentials", icon: KeyRound },
  { to: "/audit", label: "Audit Log", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {nav.map((n) => (
        <Link
          key={n.to}
          to={n.to}
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded px-2.5 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground font-medium" }}
        >
          <n.icon className="h-4 w-4 opacity-70" />
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

function AppShell() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(WS_STORAGE_KEY));

  const memberships = useQuery({
    queryKey: ["memberships", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workspace_members")
        .select("role, workspaces(id, name, slug)")
        .eq("user_id", user.id);
      if (error) throw error;
      return (data ?? [])
        .filter((m) => m.workspaces)
        .map((m) => ({ ...(m.workspaces as { id: string; name: string; slug: string }), role: m.role })) as WorkspaceSummary[];
    },
  });

  const workspaces = memberships.data ?? [];
  const workspace = useMemo(() => workspaces.find((w) => w.id === selected) ?? workspaces[0], [workspaces, selected]);

  useEffect(() => {
    if (memberships.isSuccess && workspaces.length === 0) navigate({ to: "/onboarding", replace: true });
  }, [memberships.isSuccess, workspaces.length, navigate]);

  if (memberships.isLoading) return <div className="p-8"><Loading label="Loading workspace" /></div>;
  if (memberships.error) return <div className="p-8"><ErrorBox message="Couldn't load your workspaces." onRetry={() => memberships.refetch()} /></div>;
  if (!workspace) return null;

  const setWorkspaceId = (id: string) => {
    localStorage.setItem(WS_STORAGE_KEY, id);
    setSelected(id);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "memberships" });
  };

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const switcher = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center justify-between rounded border bg-background px-2.5 py-2 text-left text-sm">
          <span className="min-w-0">
            <span className="block truncate font-medium">{workspace.name}</span>
            <span className="block font-mono text-[11px] text-muted-foreground">{workspace.role}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60" align="start">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onClick={() => setWorkspaceId(w.id)}>
            <span className="truncate">{w.name}</span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">{w.role}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate({ to: "/onboarding" })}><Plus className="h-4 w-4" /> New workspace</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const account = (
    <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs">
      <span className="truncate text-muted-foreground">{user.email}</span>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={signOut} aria-label="Sign out"><LogOut className="h-3.5 w-3.5" /></Button>
    </div>
  );

  return (
    <WorkspaceContext.Provider value={{ workspace, workspaces, userId: user.id, email: user.email ?? null, setWorkspaceId }}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-4 border-r bg-sidebar p-3 md:flex">
          <Brand />
          {switcher}
          <div className="flex-1 overflow-y-auto"><NavLinks /></div>
          {account}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b px-4 py-2.5 md:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild><Button size="icon" variant="ghost" aria-label="Open menu"><Menu className="h-5 w-5" /></Button></SheetTrigger>
              <SheetContent side="left" className="flex w-64 flex-col gap-4 bg-sidebar p-3">
                <Brand />
                {switcher}
                <div className="flex-1 overflow-y-auto"><NavLinks onNavigate={() => setMobileOpen(false)} /></div>
                {account}
              </SheetContent>
            </Sheet>
            <span className="truncate text-sm font-medium">{workspace.name}</span>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-8 sm:py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}

function Brand() {
  return (
    <span className="flex items-center gap-2 px-1 pt-1 text-sm font-semibold">
      <span className="grid h-6 w-6 place-items-center rounded bg-primary font-mono text-xs text-primary-foreground">cg</span>
      CanaryGrid
    </span>
  );
}
