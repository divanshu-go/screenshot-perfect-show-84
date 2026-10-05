const githubApi = "https://api.github.com";

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  owner: { login: string };
}

export function githubAppSlug(): string {
  return requiredEnv("GITHUB_APP_SLUG");
}

export async function verifyGitHubWebhook(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const received = signatureHeader.slice("sha256=".length).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(received)) return false;
  const expected = await hmacHex(requiredEnv("GITHUB_WEBHOOK_SECRET"), rawBody);
  return constantTimeEqual(expected, received);
}

export async function createInstallationState(input: {
  workspaceId: string;
  userId: string;
}): Promise<string> {
  const payload = base64Url(
    new TextEncoder().encode(
      JSON.stringify({
        workspace_id: input.workspaceId,
        user_id: input.userId,
        expires_at: Date.now() + 10 * 60_000,
        nonce: crypto.randomUUID(),
      }),
    ),
  );
  const signature = await hmacHex(
    requiredEnv("GITHUB_WEBHOOK_SECRET"),
    payload,
  );
  return `${payload}.${signature}`;
}

export async function verifyInstallationState(
  state: string,
): Promise<{ workspace_id: string; user_id: string }> {
  const [payload, received, extra] = state.split(".");
  if (!payload || !received || extra) {
    throw new Error("Invalid installation state");
  }
  const expected = await hmacHex(requiredEnv("GITHUB_WEBHOOK_SECRET"), payload);
  if (!constantTimeEqual(expected, received)) {
    throw new Error("Invalid installation state");
  }
  let decoded: {
    workspace_id?: unknown;
    user_id?: unknown;
    expires_at?: unknown;
  };
  try {
    decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
  } catch {
    throw new Error("Invalid installation state");
  }
  if (
    typeof decoded.workspace_id !== "string" ||
    typeof decoded.user_id !== "string" ||
    typeof decoded.expires_at !== "number" ||
    decoded.expires_at < Date.now()
  ) {
    throw new Error("Installation state expired or invalid");
  }
  return { workspace_id: decoded.workspace_id, user_id: decoded.user_id };
}

export async function createGitHubAppJwt(): Promise<string> {
  const appId = requiredEnv("GITHUB_APP_ID");
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  const payload = base64Url(
    new TextEncoder().encode(
      JSON.stringify({ iat: now - 30, exp: now + 9 * 60, iss: appId }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(requiredEnv("GITHUB_PRIVATE_KEY"));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

export async function createInstallationToken(
  installationId: number,
): Promise<string> {
  const appJwt = await createGitHubAppJwt();
  const response = await githubRequest<{ token: string }>(
    `/app/installations/${installationId}/access_tokens`,
    { method: "POST", token: appJwt },
  );
  return response.token;
}

export async function getInstallation(installationId: number): Promise<{
  id: number;
  account: { id: number; login: string };
  suspended_at: string | null;
}> {
  return await githubRequest(`/app/installations/${installationId}`, {
    token: await createGitHubAppJwt(),
  });
}

export async function listInstallationRepositories(
  installationId: number,
): Promise<GitHubRepository[]> {
  const token = await createInstallationToken(installationId);
  const result = await githubRequest<{
    repositories: GitHubRepository[];
  }>("/installation/repositories?per_page=100", { token });
  return result.repositories;
}

export async function listPullRequestFiles(input: {
  installationId: number;
  repositoryFullName: string;
  pullNumber: number;
}): Promise<
  Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
  }>
> {
  const token = await createInstallationToken(input.installationId);
  const files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
  }> = [];
  for (let page = 1; page <= 30; page += 1) {
    const batch = await githubRequest<typeof files>(
      `/repos/${input.repositoryFullName}/pulls/${input.pullNumber}/files?per_page=100&page=${page}`,
      { token },
    );
    files.push(...batch);
    if (batch.length < 100) break;
  }
  if (files.length >= 3000) {
    throw new Error("GitHub changed-file limit exceeded");
  }
  return files;
}

export async function createCheckRun(input: {
  installationId: number;
  repositoryFullName: string;
  sha: string;
  detailsUrl: string;
}): Promise<number> {
  const token = await createInstallationToken(input.installationId);
  const result = await githubRequest<{ id: number }>(
    `/repos/${input.repositoryFullName}/check-runs`,
    {
      method: "POST",
      token,
      body: {
        name: "CanaryGrid tenant compatibility",
        head_sha: input.sha,
        status: "queued",
        details_url: input.detailsUrl,
        output: {
          title: "Planning tenant compatibility coverage",
          summary:
            "CanaryGrid is mapping changed files to customer capabilities.",
        },
      },
    },
  );
  return result.id;
}

export async function updateCheckRun(input: {
  installationId: number;
  repositoryFullName: string;
  checkRunId: number;
  status: "in_progress" | "completed";
  conclusion?: "success" | "failure" | "neutral" | "cancelled";
  title: string;
  summary: string;
  detailsUrl: string;
}) {
  const token = await createInstallationToken(input.installationId);
  await githubRequest(
    `/repos/${input.repositoryFullName}/check-runs/${input.checkRunId}`,
    {
      method: "PATCH",
      token,
      body: {
        status: input.status,
        conclusion: input.status === "completed" ? input.conclusion : undefined,
        completed_at: input.status === "completed"
          ? new Date().toISOString()
          : undefined,
        details_url: input.detailsUrl,
        output: { title: input.title, summary: input.summary.slice(0, 60_000) },
      },
    },
  );
}

async function githubRequest<T>(
  path: string,
  input: {
    method?: string;
    token: string;
    body?: unknown;
  },
): Promise<T> {
  const response = await fetch(`${githubApi}${path}`, {
    method: input.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      "user-agent": "CanaryGrid",
      "x-github-api-version": "2022-11-28",
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  if (!response.ok) {
    const rateRemaining = response.headers.get("x-ratelimit-remaining");
    if (response.status === 403 && rateRemaining === "0") {
      throw new Error("GitHub rate limit exceeded");
    }
    if (response.status === 401) {
      throw new Error("GitHub token expired or invalid");
    }
    if (response.status === 403) {
      throw new Error("GitHub denied the requested operation");
    }
    if (response.status === 404) {
      throw new Error("GitHub installation or repository not found");
    }
    throw new Error(`GitHub request failed with status ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function importPrivateKey(pemValue: string): Promise<CryptoKey> {
  const pem = pemValue.replaceAll("\\n", "\n");
  const isPkcs1 = pem.includes("BEGIN RSA PRIVATE KEY");
  const base64 = pem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/, "")
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  if (!base64) throw new Error("GitHub private key is invalid");
  const decoded = Uint8Array.from(
    atob(base64),
    (character) => character.charCodeAt(0),
  );
  const bytes = (isPkcs1 ? wrapPkcs1AsPkcs8(decoded) : decoded) as BufferSource;
  return await crypto.subtle.importKey(
    "pkcs8",
    bytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function wrapPkcs1AsPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const rsaAlgorithmIdentifier = new Uint8Array([
    0x30,
    0x0d,
    0x06,
    0x09,
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01,
    0x05,
    0x00,
  ]);
  const privateKey = derValue(0x04, pkcs1);
  return derValue(
    0x30,
    concatBytes(version, rsaAlgorithmIdentifier, privateKey),
  );
}

function derValue(tag: number, value: Uint8Array): Uint8Array {
  return concatBytes(new Uint8Array([tag]), derLength(value.length), value);
}

function derLength(length: number): Uint8Array {
  if (length < 128) return new Uint8Array([length]);
  const bytes: number[] = [];
  for (let value = length; value > 0; value >>>= 8) {
    bytes.unshift(value & 0xff);
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^
      (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}
