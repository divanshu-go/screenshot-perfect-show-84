import {
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "jsr:@std/assert@1";
import { decryptCredential, encryptCredential } from "./crypto.ts";

const key = "Y2FuYXJ5Z3JpZC1sb2NhbC1rZXktMzItYnl0ZXMhISE=";

Deno.test("credential encryption round trips without exposing plaintext", async () => {
  Deno.env.set("CREDENTIAL_ENCRYPTION_KEY", key);
  const secret = { access_token: "secret-token", account_id: "acct_42" };
  const encrypted = await encryptCredential(secret);
  assertEquals(encrypted.startsWith("v1."), true);
  assertEquals(encrypted.includes("secret-token"), false);
  assertEquals(await decryptCredential(encrypted), secret);
});

Deno.test("credential encryption uses a unique nonce", async () => {
  Deno.env.set("CREDENTIAL_ENCRYPTION_KEY", key);
  const first = await encryptCredential({ token: "same-value" });
  const second = await encryptCredential({ token: "same-value" });
  assertNotEquals(first, second);
});

Deno.test("credential decryption fails closed with another key", async () => {
  Deno.env.set("CREDENTIAL_ENCRYPTION_KEY", key);
  const encrypted = await encryptCredential({ token: "secret" });
  Deno.env.set("CREDENTIAL_ENCRYPTION_KEY", "YW5vdGhlci1jYW5hcnlncmlkLWxvY2FsLWtleSEhISE=");
  await assertRejects(() => decryptCredential(encrypted));
});
