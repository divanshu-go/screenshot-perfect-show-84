import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { BrandLogo } from "@/components/app/brand-logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError, PENDING_INVITE_KEY, WS_STORAGE_KEY } from "@/lib/workspace";

export const Route = createFileRoute("/invite")({
  validateSearch: z.object({
    token: z.string().min(32).max(256),
  }),
  head: () => ({ meta: [{ title: "Accept invitation — CanaryGrid" }] }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"checking" | "accepting" | "error">("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function accept() {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      if (!data.user) {
        localStorage.setItem(PENDING_INVITE_KEY, token);
        navigate({ to: "/auth", replace: true });
        return;
      }
      setStatus("accepting");
      const result = await supabase.rpc("accept_workspace_invitation", { _token: token });
      if (!active) return;
      if (result.error) {
        setError(friendlyError(result.error));
        setStatus("error");
        return;
      }
      localStorage.removeItem(PENDING_INVITE_KEY);
      localStorage.setItem(WS_STORAGE_KEY, result.data);
      navigate({ to: "/overview", replace: true });
    }
    accept();
    return () => {
      active = false;
    };
  }, [navigate, token]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <BrandLogo />
        <h1 className="mt-8 text-xl font-semibold">
          {status === "error" ? "Invitation unavailable" : "Joining workspace"}
        </h1>
        <p
          className="mt-2 text-sm text-muted-foreground"
          role={status === "error" ? "alert" : undefined}
        >
          {status === "checking" && "Checking your account…"}
          {status === "accepting" && "Accepting your invitation…"}
          {status === "error" && error}
        </p>
        {status === "error" && (
          <Button className="mt-5" variant="outline" onClick={() => navigate({ to: "/overview" })}>
            Return to CanaryGrid
          </Button>
        )}
      </div>
    </main>
  );
}
