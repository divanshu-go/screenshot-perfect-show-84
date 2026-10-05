import { describe, expect, it } from "vitest";
import {
  boundedEvidence,
  evaluateAssertion,
  extractValues,
  readJsonPath,
  redactEvidence,
  renderTemplate,
  templateReferences,
  validateJourneyReferences,
  type JourneyStepDraft,
} from "@/lib/journey-domain";

const step = (overrides: Partial<JourneyStepDraft> = {}): JourneyStepDraft => ({
  name: "Create candidate",
  method: "POST",
  path_template: "/candidates",
  request_headers: {},
  request_body: null,
  extraction_rules: [],
  continue_on_failure: false,
  is_cleanup: false,
  assertions: [],
  ...overrides,
});

describe("journey templates", () => {
  it("finds unique references in nested request values", () => {
    expect(
      templateReferences({
        path: "/candidate/{{candidate_id}}",
        headers: { authorization: "Bearer {{credential.token}}" },
        body: [{ id: "{{candidate_id}}" }],
      }),
    ).toEqual(["candidate_id", "credential.token"]);
  });

  it("renders exact values without coercion and embedded values as strings", () => {
    expect(
      renderTemplate(
        { body: "{{payload}}", path: "/items/{{item.id}}" },
        { payload: { active: true }, item: { id: 42 } },
      ),
    ).toEqual({ body: { active: true }, path: "/items/42" });
  });

  it("throws for missing runtime values", () => {
    expect(() => renderTemplate("{{missing}}", {})).toThrow("Missing template value");
  });

  it("rejects forward, malformed, and duplicate extraction references", () => {
    const errors = validateJourneyReferences([
      step({
        request_body: { id: "{{candidate_id}}" },
        extraction_rules: [
          { name: "bad-name", source: "body", path: "id" },
          { name: "candidate_id", source: "body", path: "$.id" },
          { name: "candidate_id", source: "body", path: "$.other" },
        ],
      }),
    ]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("before it is available"),
        expect.stringContaining("is invalid"),
        expect.stringContaining("duplicated"),
        expect.stringContaining("must use a $. JSON path"),
      ]),
    );
  });

  it("allows later steps and cleanup to use prior extraction values", () => {
    expect(
      validateJourneyReferences([
        step({
          extraction_rules: [{ name: "candidate_id", source: "body", path: "$.id" }],
        }),
        step({
          name: "Read candidate",
          method: "GET",
          path_template: "/candidates/{{candidate_id}}",
        }),
        step({
          name: "Delete candidate",
          method: "DELETE",
          path_template: "/candidates/{{candidate_id}}",
          is_cleanup: true,
        }),
      ]),
    ).toEqual([]);
  });
});

describe("extraction and assertions", () => {
  const response = {
    status: 201,
    body: { candidate: { id: "cand_42", tags: ["priority"] } },
    headers: { "x-request-id": "req_1" },
    durationMs: 180,
  };

  it("reads supported JSON paths and extracts body and header values", () => {
    expect(readJsonPath(response.body, "$.candidate.tags[0]")).toBe("priority");
    expect(
      extractValues(
        [
          { name: "candidate_id", source: "body", path: "$.candidate.id" },
          { name: "request_id", source: "header", path: "x-request-id" },
        ],
        response,
      ),
    ).toEqual({ candidate_id: "cand_42", request_id: "req_1" });
  });

  it.each([
    [{ assertion_type: "http_status", expected_value: 201 }, true],
    [
      {
        assertion_type: "json_path_equals",
        target: "$.candidate.id",
        expected_value: "cand_42",
      },
      true,
    ],
    [{ assertion_type: "json_path_exists", target: "$.candidate.id" }, true],
    [
      { assertion_type: "json_path_type", target: "$.candidate.tags", expected_value: "array" },
      true,
    ],
    [{ assertion_type: "header_exists", target: "X-Request-ID" }, true],
    [{ assertion_type: "max_latency_ms", expected_value: 100 }, false],
  ] as const)("evaluates assertion %j", (assertion, passed) => {
    expect(evaluateAssertion(assertion, response).passed).toBe(passed);
  });
});

describe("evidence safety", () => {
  it("redacts sensitive keys, bearer values, and configured secret values", () => {
    expect(
      redactEvidence(
        {
          authorization: "Bearer visible",
          nested: { note: "value secret-123 value", password: "visible" },
        },
        ["secret-123"],
      ),
    ).toEqual({
      authorization: "[REDACTED]",
      nested: { note: "value [REDACTED] value", password: "[REDACTED]" },
    });
  });

  it("preserves small evidence and truncates oversized evidence deterministically", () => {
    expect(boundedEvidence({ ok: true }, 100)).toEqual({ ok: true });
    const bounded = boundedEvidence({ body: "x".repeat(200) }, 100);
    expect(bounded).toMatchObject({ truncated: true });
  });
});
