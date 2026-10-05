export type JourneyMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export type ExtractionRule = {
  name: string;
  source: "body" | "header";
  path: string;
};

export type JourneyAssertion = {
  assertion_type:
    | "http_status"
    | "json_path_equals"
    | "json_path_exists"
    | "json_path_type"
    | "header_exists"
    | "max_latency_ms";
  target?: string;
  operator?: string;
  expected_value?: unknown;
};

export type JourneyStepDraft = {
  name: string;
  method: JourneyMethod;
  path_template: string;
  request_headers: Record<string, string>;
  request_body: unknown;
  extraction_rules: ExtractionRule[];
  continue_on_failure: boolean;
  is_cleanup: boolean;
  assertions: JourneyAssertion[];
};

const templatePattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g;
const variableNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function templateReferences(value: unknown): string[] {
  const references = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === "string") {
      for (const match of item.matchAll(templatePattern)) references.add(match[1]!);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (item && typeof item === "object") Object.values(item).forEach(visit);
  };
  visit(value);
  return [...references].sort();
}

export function validateJourneyReferences(
  steps: readonly JourneyStepDraft[],
  initialReferences: readonly string[] = [],
): string[] {
  const available = new Set(initialReferences);
  const errors: string[] = [];
  const ordered = [...steps].sort((a, b) => Number(a.is_cleanup) - Number(b.is_cleanup));

  for (const step of ordered) {
    const references = templateReferences({
      path: step.path_template,
      headers: step.request_headers,
      body: step.request_body,
    });
    for (const reference of references) {
      const root = reference.split(".")[0] ?? reference;
      if (!available.has(reference) && !available.has(root)) {
        errors.push(
          `${step.name || "Unnamed step"} references “${reference}” before it is available.`,
        );
      }
    }
    const seenInStep = new Set<string>();
    for (const extraction of step.extraction_rules) {
      if (!variableNamePattern.test(extraction.name)) {
        errors.push(`Extraction name “${extraction.name}” is invalid.`);
      } else if (seenInStep.has(extraction.name) || available.has(extraction.name)) {
        errors.push(`Extraction name “${extraction.name}” is duplicated.`);
      } else {
        seenInStep.add(extraction.name);
        available.add(extraction.name);
      }
      if (extraction.source === "body" && !extraction.path.startsWith("$.")) {
        errors.push(`Body extraction “${extraction.name}” must use a $. JSON path.`);
      }
      if (extraction.source === "header" && !extraction.path.trim()) {
        errors.push(`Header extraction “${extraction.name}” needs a header name.`);
      }
    }
  }
  return errors;
}

export function renderTemplate(value: unknown, variables: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}$/);
    if (exact) {
      const resolved = readPath(variables, exact[1]!);
      if (resolved === undefined) throw new Error(`Missing template value: ${exact[1]}`);
      return resolved;
    }
    return value.replace(templatePattern, (_, reference: string) => {
      const resolved = readPath(variables, reference);
      if (resolved === undefined) throw new Error(`Missing template value: ${reference}`);
      return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderTemplate(item, variables)]),
    );
  }
  return value;
}

export function readJsonPath(value: unknown, path: string): unknown {
  if (path === "$") return value;
  if (!path.startsWith("$.")) throw new Error(`Unsupported JSON path: ${path}`);
  return readPath(value, path.slice(2));
}

export function extractValues(
  rules: readonly ExtractionRule[],
  response: { body: unknown; headers: Record<string, string> },
): Record<string, unknown> {
  return Object.fromEntries(
    rules.map((rule) => {
      const value =
        rule.source === "header"
          ? response.headers[rule.path.toLowerCase()]
          : readJsonPath(response.body, rule.path);
      if (value === undefined) throw new Error(`Extraction ${rule.name} did not match a value`);
      return [rule.name, value];
    }),
  );
}

export function evaluateAssertion(
  assertion: JourneyAssertion,
  response: {
    status: number;
    body: unknown;
    headers: Record<string, string>;
    durationMs: number;
  },
): { passed: boolean; actual: unknown; message: string } {
  let actual: unknown;
  let passed = false;
  switch (assertion.assertion_type) {
    case "http_status":
      actual = response.status;
      passed = actual === Number(assertion.expected_value);
      break;
    case "json_path_equals":
      actual = readJsonPath(response.body, assertion.target ?? "");
      passed = deepEqual(actual, assertion.expected_value);
      break;
    case "json_path_exists":
      actual = readJsonPath(response.body, assertion.target ?? "");
      passed = actual !== undefined;
      break;
    case "json_path_type":
      actual = readJsonPath(response.body, assertion.target ?? "");
      passed = valueType(actual) === assertion.expected_value;
      break;
    case "header_exists":
      actual = response.headers[(assertion.target ?? "").toLowerCase()];
      passed = actual !== undefined;
      break;
    case "max_latency_ms":
      actual = response.durationMs;
      passed = response.durationMs <= Number(assertion.expected_value);
      break;
  }
  return {
    passed,
    actual,
    message: passed
      ? "Assertion passed"
      : `${assertion.assertion_type} expected ${JSON.stringify(assertion.expected_value)} but received ${JSON.stringify(actual)}`,
  };
}

export function redactEvidence<T>(value: T, configuredSecrets: readonly string[] = []): T {
  const secretValues = configuredSecrets.filter((secret) => secret.length >= 4);
  const redact = (item: unknown, key?: string): unknown => {
    if (key && /authorization|cookie|api[-_]?key|token|secret|password/i.test(key)) {
      return "[REDACTED]";
    }
    if (typeof item === "string") {
      let result = item.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
      for (const secret of secretValues) result = result.split(secret).join("[REDACTED]");
      return result;
    }
    if (Array.isArray(item)) return item.map((child) => redact(child));
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item).map(([childKey, child]) => [childKey, redact(child, childKey)]),
      );
    }
    return item;
  };
  return redact(value) as T;
}

export function boundedEvidence<T>(
  value: T,
  maxBytes = 32_768,
): T | { truncated: true; preview: string } {
  const serialized = JSON.stringify(value);
  const bytes = new TextEncoder().encode(serialized);
  if (bytes.byteLength <= maxBytes) return value;
  const previewBytes = bytes.slice(0, Math.max(0, maxBytes - 64));
  return {
    truncated: true,
    preview: new TextDecoder().decode(previewBytes),
  };
}

function readPath(value: unknown, path: string): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let current: unknown = value;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
