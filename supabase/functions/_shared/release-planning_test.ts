import { assertEquals } from "jsr:@std/assert@1";
import {
  decideRelease,
  impactedCapabilities,
  type PlanningArchetype,
  type PlanningCapability,
  selectReleaseArchetypes,
} from "./release-planning.ts";

const capabilities: PlanningCapability[] = [
  {
    id: "auth",
    name: "Authentication",
    criticality: "critical",
    globs: ["src/auth/**"],
  },
  {
    id: "sync",
    name: "Synchronization",
    criticality: "high",
    globs: ["src/sync/**"],
  },
];

const archetypes: PlanningArchetype[] = [
  {
    id: "b",
    name: "Restricted tenant",
    riskWeight: 90,
    capabilityIds: ["auth"],
  },
  {
    id: "a",
    name: "Broad tenant",
    riskWeight: 50,
    capabilityIds: ["auth", "sync"],
  },
];

Deno.test("changed files map to capabilities using repository globs", () => {
  assertEquals(
    impactedCapabilities(["src/auth/session.ts", "README.md"], capabilities)
      .map((
        item,
      ) => item.id),
    ["auth"],
  );
  assertEquals(impactedCapabilities(["README.md"], capabilities), []);
});

Deno.test("greedy selection is deterministic and risk weighted", () => {
  const plan = selectReleaseArchetypes(capabilities, archetypes);
  assertEquals(plan.selected.map((item) => item.archetype.id), ["a"]);
  assertEquals(plan.uncovered, []);

  const tied = selectReleaseArchetypes([capabilities[0]!], archetypes);
  assertEquals(tied.selected[0]?.archetype.id, "b");
});

Deno.test("selection reports uncovered capability coverage", () => {
  const plan = selectReleaseArchetypes(capabilities, []);
  assertEquals(plan.selected, []);
  assertEquals(plan.uncovered, ["auth", "sync"]);
});

Deno.test("release decision fails closed and allows no-impact changes", () => {
  assertEquals(
    decideRelease({
      runStatuses: [],
      uncoveredCapabilities: [],
      missingJourneyCapabilityIds: [],
    }).status,
    "passed",
  );
  assertEquals(
    decideRelease({
      runStatuses: ["passed", "error"],
      uncoveredCapabilities: [],
      missingJourneyCapabilityIds: [],
    }).status,
    "failed",
  );
  assertEquals(
    decideRelease({
      runStatuses: ["passed"],
      uncoveredCapabilities: [capabilities[0]!],
      missingJourneyCapabilityIds: [],
    }).status,
    "failed",
  );
});
