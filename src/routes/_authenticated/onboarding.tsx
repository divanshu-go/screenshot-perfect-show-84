import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WS_STORAGE_KEY, friendlyError } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Create workspace — CanaryGrid" }] }),
  component: Onboarding,
});

const schema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(80),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "Lowercase letters, numbers and dashes"),
});

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function Onboarding() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touchedSlug, setTouchedSlug] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ name, slug });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid input");
    setBusy(true);
    const { data, error } = await supabase.rpc("create_workspace", { _name: parsed.data.name, _slug: parsed.data.slug });
    setBusy(false);
    if (error) return setError(/duplicate/i.test(error.message) ? "That URL is taken. Try another." : friendlyError(error));
    localStorage.setItem(WS_STORAGE_KEY, data as string);
    await qc.invalidateQueries({ queryKey: ["memberships"] });
    navigate({ to: "/overview" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Create your workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">A workspace holds your archetypes, journeys and release history. You'll be its owner.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Company or team name</Label>
          <Input id="name" value={name} onChange={(e) => { setName(e.target.value); if (!touchedSlug) setSlug(slugify(e.target.value)); }} placeholder="Acme Platform" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="slug">Workspace ID</Label>
          <Input id="slug" className="font-mono" value={slug} onChange={(e) => { setTouchedSlug(true); setSlug(e.target.value); }} />
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : "Create workspace"}</Button>
        <p className="text-xs text-muted-foreground">Invited to an existing workspace? Ask the owner to send you an invite link.</p>
      </form>
    </div>
  );
}
