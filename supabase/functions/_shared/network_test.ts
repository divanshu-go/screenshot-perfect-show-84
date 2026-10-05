import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  isPrivateIp,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  safeFetch,
  validateOutboundUrl,
} from "./network.ts";

const publicResolver = async (_hostname: string, type: "A" | "AAAA") =>
  type === "A" ? ["8.8.8.8"] : [];

Deno.test("private and metadata network ranges are blocked", () => {
  for (
    const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "224.0.0.1",
      "::",
      "::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
    ]
  ) {
    assertEquals(isPrivateIp(address), true, address);
  }
  assertEquals(isPrivateIp("8.8.8.8"), false);
  assertEquals(isPrivateIp("2606:4700:4700::1111"), false);
});

Deno.test("outbound URLs require HTTPS, the allowlist, and public DNS", async () => {
  const allowed = new Set(["api.example.com"]);
  await assertRejects(
    () =>
      validateOutboundUrl("http://api.example.com", allowed, publicResolver),
    Error,
    "HTTPS",
  );
  await assertRejects(
    () =>
      validateOutboundUrl(
        "https://user:pass@api.example.com",
        allowed,
        publicResolver,
      ),
    Error,
    "credentials",
  );
  await assertRejects(
    () =>
      validateOutboundUrl(
        "https://api.example.com:8443",
        allowed,
        publicResolver,
      ),
    Error,
    "port 443",
  );
  await assertRejects(
    () =>
      validateOutboundUrl("https://other.example.com", allowed, publicResolver),
    Error,
    "allowlisted",
  );
  await assertRejects(
    () =>
      validateOutboundUrl(
        "https://api.example.com",
        allowed,
        async (_hostname, type) => (type === "A" ? ["169.254.169.254"] : []),
      ),
    Error,
    "private network",
  );
  const result = await validateOutboundUrl(
    "https://api.example.com/resource",
    allowed,
    publicResolver,
  );
  assertEquals(result.hostname, "api.example.com");
});

Deno.test("redirect destinations are revalidated", async () => {
  let requests = 0;
  await assertRejects(
    () =>
      safeFetch(
        new URL("https://api.example.com/start"),
        { method: "GET" },
        {
          allowedHosts: new Set(["api.example.com"]),
          timeoutMs: 1000,
          resolver: publicResolver,
          fetcher: async () => {
            requests += 1;
            return new Response(null, {
              status: 302,
              headers: { location: "https://169.254.169.254/latest/meta-data" },
            });
          },
        },
      ),
    Error,
    "allowlisted",
  );
  assertEquals(requests, 1);
});

Deno.test("provider responses are bounded", async () => {
  await assertRejects(
    () =>
      safeFetch(
        new URL("https://api.example.com/large"),
        { method: "GET" },
        {
          allowedHosts: new Set(["api.example.com"]),
          timeoutMs: 1000,
          resolver: publicResolver,
          fetcher: async () =>
            new Response(new Uint8Array(MAX_RESPONSE_BYTES + 1), {
              status: 200,
              headers: { "content-type": "application/octet-stream" },
            }),
        },
      ),
    Error,
    "too large",
  );
});

Deno.test("validated DNS address is pinned to the transport", async () => {
  let pinnedAddress: string | undefined;
  const response = await safeFetch(
    new URL("https://api.example.com/status"),
    { method: "GET" },
    {
      allowedHosts: new Set(["api.example.com"]),
      timeoutMs: 1000,
      resolver: publicResolver,
      fetcher: async (_url, _init, address) => {
        pinnedAddress = address;
        return new Response('{"ok":true}', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );
  assertEquals(pinnedAddress, "8.8.8.8");
  assertEquals(response.body, { ok: true });
});

Deno.test("request size, malformed JSON, and redirect count fail closed", async () => {
  await assertRejects(
    () =>
      safeFetch(
        new URL("https://api.example.com/large"),
        { method: "POST", body: "x".repeat(MAX_REQUEST_BYTES + 1) },
        {
          allowedHosts: new Set(["api.example.com"]),
          timeoutMs: 1000,
          resolver: publicResolver,
          fetcher: async () => new Response(null, { status: 204 }),
        },
      ),
    Error,
    "too large",
  );

  await assertRejects(
    () =>
      safeFetch(
        new URL("https://api.example.com/json"),
        { method: "GET" },
        {
          allowedHosts: new Set(["api.example.com"]),
          timeoutMs: 1000,
          resolver: publicResolver,
          fetcher: async () =>
            new Response("{invalid", {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        },
      ),
    Error,
    "malformed JSON",
  );

  let redirects = 0;
  await assertRejects(
    () =>
      safeFetch(
        new URL("https://api.example.com/loop"),
        { method: "GET" },
        {
          allowedHosts: new Set(["api.example.com"]),
          timeoutMs: 1000,
          resolver: publicResolver,
          fetcher: async () => {
            redirects += 1;
            return new Response(null, {
              status: 302,
              headers: { location: "/loop" },
            });
          },
        },
      ),
    Error,
    "Too many redirects",
  );
  assert(redirects <= 4);
});
