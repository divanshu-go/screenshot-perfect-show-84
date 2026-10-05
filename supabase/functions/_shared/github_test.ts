import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  createInstallationState,
  verifyGitHubWebhook,
  verifyInstallationState,
} from "./github.ts";

const secret = "local-webhook-test-secret";

Deno.test("GitHub webhook signatures require an exact SHA-256 HMAC", async () => {
  const previous = Deno.env.get("GITHUB_WEBHOOK_SECRET");
  Deno.env.set("GITHUB_WEBHOOK_SECRET", secret);
  try {
    const body = '{"action":"opened"}';
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const bytes = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
    );
    const signature = [...bytes]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    assertEquals(await verifyGitHubWebhook(body, `sha256=${signature}`), true);
    assertEquals(
      await verifyGitHubWebhook(`${body} `, `sha256=${signature}`),
      false,
    );
    assertEquals(await verifyGitHubWebhook(body, signature), false);
  } finally {
    if (previous) Deno.env.set("GITHUB_WEBHOOK_SECRET", previous);
    else Deno.env.delete("GITHUB_WEBHOOK_SECRET");
  }
});

Deno.test("installation state is signed and bound to a user and workspace", async () => {
  const previous = Deno.env.get("GITHUB_WEBHOOK_SECRET");
  Deno.env.set("GITHUB_WEBHOOK_SECRET", secret);
  try {
    const state = await createInstallationState({
      workspaceId: "workspace-1",
      userId: "user-1",
    });
    assertEquals(await verifyInstallationState(state), {
      workspace_id: "workspace-1",
      user_id: "user-1",
    });
    await assertRejects(
      () => verifyInstallationState(`${state.slice(0, -1)}0`),
      Error,
      "Invalid installation state",
    );
  } finally {
    if (previous) Deno.env.set("GITHUB_WEBHOOK_SECRET", previous);
    else Deno.env.delete("GITHUB_WEBHOOK_SECRET");
  }
});
