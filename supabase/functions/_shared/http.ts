const localOrigins = new Set([
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://localhost:8080",
]);

function allowedOrigins() {
  const configured = (Deno.env.get("PUBLIC_APP_URLS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set([...localOrigins, ...configured]);
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins().has(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function json(request: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function options(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function stableError(error: unknown): { status: number; code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "Authentication required") return { status: 401, code: "AUTH_REQUIRED", message };
  if (message === "Not authorized") return { status: 403, code: "FORBIDDEN", message };
  if (/not found/i.test(message)) return { status: 404, code: "NOT_FOUND", message };
  if (/invalid|must|required|allowed/i.test(message))
    return { status: 400, code: "INVALID_REQUEST", message };
  console.error(JSON.stringify({ level: "error", code: "INTERNAL_ERROR" }));
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "The request could not be completed. Try again.",
  };
}
