export const MAX_REQUEST_BYTES = 256 * 1024;
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_REDIRECTS = 3;

type Resolver = (
  hostname: string,
  recordType: "A" | "AAAA",
) => Promise<string[]>;
type Fetcher = (
  input: URL,
  init: RequestInit,
  pinnedAddress?: string,
) => Promise<Response>;

const blockedHostnames = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "kubernetes.default.svc",
]);

export async function validateOutboundUrl(
  value: string | URL,
  allowedHosts: ReadonlySet<string>,
  resolver: Resolver = resolveDns,
): Promise<URL> {
  return (await resolveAndValidateUrl(value, allowedHosts, resolver)).url;
}

async function resolveAndValidateUrl(
  value: string | URL,
  allowedHosts: ReadonlySet<string>,
  resolver: Resolver,
): Promise<{ url: URL; addresses: string[] }> {
  const url = value instanceof URL ? value : new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");

  if (url.protocol !== "https:") {
    throw new Error("Only HTTPS destinations are allowed");
  }
  if (url.username || url.password) {
    throw new Error("Destination credentials are not allowed");
  }
  if (url.port && url.port !== "443") {
    throw new Error("Only HTTPS port 443 is allowed");
  }
  if (!allowedHosts.has(hostname)) {
    throw new Error("Destination hostname is not allowlisted");
  }
  if (
    blockedHostnames.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Destination hostname is blocked");
  }

  if (isIpAddress(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error("Private network destinations are blocked");
    }
    return { url, addresses: [hostname] };
  }

  const [ipv4, ipv6] = await Promise.all([
    resolver(hostname, "A").catch(() => []),
    resolver(hostname, "AAAA").catch(() => []),
  ]);
  const addresses = [...ipv4, ...ipv6];
  if (!addresses.length) {
    throw new Error("Destination hostname did not resolve");
  }
  if (addresses.some(isPrivateIp)) {
    throw new Error("Destination resolved to a private network");
  }
  return { url, addresses };
}

export async function safeFetch(
  initialUrl: URL,
  init: RequestInit,
  options: {
    allowedHosts: ReadonlySet<string>;
    timeoutMs: number;
    resolver?: Resolver;
    fetcher?: Fetcher;
  },
): Promise<{
  url: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
}> {
  const resolver = options.resolver ?? resolveDns;
  const startedAt = performance.now();
  let url = initialUrl;

  const requestBody = typeof init.body === "string"
    ? new TextEncoder().encode(init.body)
    : new Uint8Array();
  if (requestBody.byteLength > MAX_REQUEST_BYTES) {
    throw new Error("Request body is too large");
  }

  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    const validated = await resolveAndValidateUrl(
      url,
      options.allowedHosts,
      resolver,
    );
    const address = validated
      .addresses[redirectCount % validated.addresses.length]!;
    const response = options.fetcher
      ? await options.fetcher(
        validated.url,
        {
          ...init,
          redirect: "manual",
          signal: AbortSignal.timeout(options.timeoutMs),
        },
        address,
      )
      : await pinnedHttpsFetch(validated.url, init, address, options.timeoutMs);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Redirect response did not include a location");
      }
      if (redirectCount === MAX_REDIRECTS) {
        throw new Error("Too many redirects");
      }
      url = new URL(location, url);
      continue;
    }

    const bytes = await readBoundedBody(response);
    const text = new TextDecoder().decode(bytes);
    const contentType = response.headers.get("content-type") ?? "";
    let body: unknown = text;
    if (contentType.includes("json") && text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error("Provider returned malformed JSON");
      }
    }
    return {
      url: url.toString(),
      status: response.status,
      headers: Object.fromEntries(
        [...response.headers.entries()].map((
          [key, value],
        ) => [key.toLowerCase(), value]),
      ),
      body,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
  throw new Error("Too many redirects");
}

export function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.includes(":")) {
    if (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff")
    ) {
      return true;
    }
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]!) : false;
  }

  const octets = normalized.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Provider response is too large");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function resolveDns(
  hostname: string,
  recordType: "A" | "AAAA",
): Promise<string[]> {
  return await Deno.resolveDns(hostname, recordType);
}

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

async function pinnedHttpsFetch(
  url: URL,
  init: RequestInit,
  address: string,
  timeoutMs: number,
): Promise<Response> {
  let tcp: Deno.TcpConn | undefined;
  let tls: Deno.TlsConn | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      try {
        tls?.close();
        tcp?.close();
      } catch {
        // The connection may already be closed.
      }
      reject(new Error("Provider request timed out"));
    }, timeoutMs);
  });

  const request = async () => {
    tcp = await Deno.connect({ hostname: address, port: 443 });
    tls = await Deno.startTls(tcp, {
      hostname: url.hostname,
      alpnProtocols: ["http/1.1"],
    });
    const headers = new Headers(init.headers);
    headers.set("host", url.hostname);
    headers.set("connection", "close");
    headers.set("accept-encoding", "identity");
    const body = typeof init.body === "string" ? init.body : "";
    if (body) {
      headers.set(
        "content-length",
        String(new TextEncoder().encode(body).length),
      );
    }

    const target = `${url.pathname || "/"}${url.search}`;
    const lines = [`${init.method ?? "GET"} ${target} HTTP/1.1`];
    for (const [name, value] of headers.entries()) {
      lines.push(`${name}: ${value}`);
    }
    const encoded = new TextEncoder().encode(
      `${lines.join("\r\n")}\r\n\r\n${body}`,
    );
    await writeAll(tls, encoded);
    const raw = await readRawHttpResponse(tls);
    return parseHttpResponse(raw);
  };

  try {
    return await Promise.race([request(), timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    try {
      tls?.close();
      tcp?.close();
    } catch {
      // The connection may have been closed by the timeout or peer.
    }
  }
}

async function writeAll(
  connection: { write(bytes: Uint8Array): Promise<number> },
  bytes: Uint8Array,
) {
  let offset = 0;
  while (offset < bytes.length) {
    offset += await connection.write(bytes.subarray(offset));
  }
}

async function readRawHttpResponse(
  connection: { read(buffer: Uint8Array): Promise<number | null> },
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const buffer = new Uint8Array(32 * 1024);
  while (true) {
    const read = await connection.read(buffer);
    if (read === null) break;
    total += read;
    if (total > MAX_RESPONSE_BYTES + 128 * 1024) {
      throw new Error("Provider response is too large");
    }
    chunks.push(buffer.slice(0, read));
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function parseHttpResponse(raw: Uint8Array): Response {
  const separator = findSequence(raw, new Uint8Array([13, 10, 13, 10]));
  if (separator < 0 || separator > 64 * 1024) {
    throw new Error("Provider returned an invalid HTTP response");
  }
  const headerText = new TextDecoder().decode(raw.subarray(0, separator));
  const lines = headerText.split("\r\n");
  const statusMatch = lines.shift()?.match(/^HTTP\/1\.[01]\s+(\d{3})/);
  if (!statusMatch) throw new Error("Provider returned an invalid HTTP status");
  const status = Number(statusMatch[1]);
  const headers = new Headers();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) throw new Error("Provider returned invalid HTTP headers");
    headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  let body = raw.subarray(separator + 4);
  if (headers.get("transfer-encoding")?.toLowerCase().includes("chunked")) {
    body = decodeChunkedBody(body);
  } else {
    const contentLength = headers.get("content-length");
    if (contentLength !== null) {
      const expected = Number(contentLength);
      if (
        !Number.isSafeInteger(expected) || expected < 0 ||
        body.length < expected
      ) {
        throw new Error("Provider returned an incomplete HTTP response");
      }
      body = body.subarray(0, expected);
    }
  }
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new Error("Provider response is too large");
  }
  return new Response(body.slice().buffer, { status, headers });
}

function decodeChunkedBody(raw: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let total = 0;
  while (offset < raw.length) {
    const lineEnd = findSequence(raw, new Uint8Array([13, 10]), offset);
    if (lineEnd < 0) {
      throw new Error("Provider returned malformed chunked data");
    }
    const line = new TextDecoder().decode(raw.subarray(offset, lineEnd));
    const length = Number.parseInt(line.split(";", 1)[0]!, 16);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error("Provider returned malformed chunked data");
    }
    offset = lineEnd + 2;
    if (length === 0) break;
    if (offset + length + 2 > raw.length) {
      throw new Error("Provider returned incomplete chunked data");
    }
    total += length;
    if (total > MAX_RESPONSE_BYTES) {
      throw new Error("Provider response is too large");
    }
    chunks.push(raw.slice(offset, offset + length));
    offset += length;
    if (raw[offset] !== 13 || raw[offset + 1] !== 10) {
      throw new Error("Provider returned malformed chunked data");
    }
    offset += 2;
  }
  const result = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return result;
}

function findSequence(
  source: Uint8Array,
  sequence: Uint8Array,
  start = 0,
): number {
  outer:
  for (
    let index = start;
    index <= source.length - sequence.length;
    index += 1
  ) {
    for (let part = 0; part < sequence.length; part += 1) {
      if (source[index + part] !== sequence[part]) continue outer;
    }
    return index;
  }
  return -1;
}
