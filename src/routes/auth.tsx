import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/app/brand-logo";
import { PENDING_INVITE_KEY } from "@/lib/workspace";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — CanaryGrid" },
      { name: "description", content: "Sign in to your CanaryGrid workspace." },
      { property: "og:title", content: "Sign in — CanaryGrid" },
      { property: "og:description", content: "Sign in to your CanaryGrid workspace." },
    ],
  }),
  component: AuthPage,
});

const emailSchema = z.string().trim().email("Enter a valid work email").max(255);
const localSupabase = /127\.0\.0\.1|localhost/.test(import.meta.env["VITE_SUPABASE_URL"] ?? "");

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const continueAfterAuth = () => {
      const pendingInvite = localStorage.getItem(PENDING_INVITE_KEY);
      if (pendingInvite) {
        navigate({ to: "/invite", search: { token: pendingInvite }, replace: true });
      } else {
        navigate({ to: "/overview", replace: true });
      }
    };
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash.includes("error_code=otp_expired"))
      setError("That sign-in link has expired. Request a new one below.");
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) continueAfterAuth();
    });
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) continueAfterAuth();
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid input");
    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: { emailRedirectTo: `${window.location.origin}/auth` },
    });
    if (error) {
      setState("idle");
      setError(
        /rate/i.test(error.message)
          ? "Too many requests. Wait a minute and try again."
          : error.message,
      );
    } else setState("sent");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <BrandLogo />
        <h1 className="mt-8 text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We'll email you a one-time sign-in link.
        </p>

        {state === "sent" ? (
          <div className="mt-6 rounded-md border bg-card p-4 text-sm">
            {localSupabase ? (
              <>
                The sign-in link for <span className="font-medium">{email}</span> is in the local
                mail viewer. Open it there, then return here. Your account and session are stored
                only after that link opens in this browser.
                <a
                  className="mt-3 block font-medium text-primary hover:underline"
                  href="http://127.0.0.1:54324"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open local mail
                </a>
              </>
            ) : (
              <>
                Check <span className="font-medium">{email}</span> for a sign-in link. It expires
                in one hour.
              </>
            )}
            <Button variant="link" className="mt-2 h-auto p-0" onClick={() => setState("idle")}>
              Use another email
            </Button>
          </div>
        ) : (
          <form onSubmit={sendLink} className="mt-6 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <Button type="submit" className="w-full" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Email me a link"}
            </Button>
          </form>
        )}
        {error && (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
