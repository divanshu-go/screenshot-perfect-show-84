export type PlanningCapability = {
  id: string;
  name: string;
  criticality: "low" | "medium" | "high" | "critical";
  globs: string[];
};

export type PlanningArchetype = {
  id: string;
  name: string;
  riskWeight: number;
  capabilityIds: string[];
};

const criticalityWeight: Record<PlanningCapability["criticality"], number> = {
  low: 1,
  medium: 2,
  high: 4,
  critical: 8,
};

export function matchesGlob(path: string, pattern: string): boolean {
  if (path.startsWith("/") || path.split("/").includes("..")) return false;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`).test(path.replaceAll("\\", "/"));
}

export function impactedCapabilities(
  paths: readonly string[],
  capabilities: readonly PlanningCapability[],
): PlanningCapability[] {
  return capabilities
    .filter((capability) =>
      capability.globs.some((pattern) =>
        paths.some((path) => matchesGlob(path, pattern))
      )
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function selectReleaseArchetypes(
  required: readonly PlanningCapability[],
  archetypes: readonly PlanningArchetype[],
) {
  const byId = new Map(
    required.map((capability) => [capability.id, capability]),
  );
  const uncovered = new Set(byId.keys());
  const remaining = [...archetypes];
  const selected: Array<{
    archetype: PlanningArchetype;
    newlyCoveredIds: string[];
    weightedBenefit: number;
  }> = [];

  while (uncovered.size) {
    const candidates = remaining
      .map((archetype) => {
        const newlyCoveredIds = archetype.capabilityIds
          .filter((id) => uncovered.has(id))
          .sort();
        const weightedBenefit = newlyCoveredIds.reduce(
          (sum, id) => sum + criticalityWeight[byId.get(id)!.criticality],
          0,
        );
        return { archetype, newlyCoveredIds, weightedBenefit };
      })
      .filter((candidate) => candidate.newlyCoveredIds.length > 0)
      .sort(
        (left, right) =>
          right.weightedBenefit - left.weightedBenefit ||
          right.archetype.riskWeight - left.archetype.riskWeight ||
          left.archetype.id.localeCompare(right.archetype.id),
      );
    const winner = candidates[0];
    if (!winner) break;
    selected.push(winner);
    winner.newlyCoveredIds.forEach((id) => uncovered.delete(id));
    remaining.splice(
      remaining.findIndex((item) => item.id === winner.archetype.id),
      1,
    );
  }

  return {
    selected,
    uncovered: [...uncovered].sort(),
  };
}

export function decideRelease(input: {
  runStatuses: readonly string[];
  uncoveredCapabilities: readonly PlanningCapability[];
  missingJourneyCapabilityIds: readonly string[];
}): {
  status: "passed" | "failed" | "error";
  reasons: string[];
} {
  const reasons: string[] = [];
  if (input.runStatuses.some((status) => status === "error")) {
    reasons.push("One or more required runs ended with an execution error.");
  }
  if (
    input.runStatuses.some((status) =>
      ["failed", "cancelled", "queued", "running"].includes(status)
    )
  ) {
    reasons.push("One or more required runs did not pass.");
  }
  const criticalUncovered = input.uncoveredCapabilities.filter(
    (capability) => capability.criticality === "critical",
  );
  if (criticalUncovered.length) {
    reasons.push(
      `Critical capabilities lack archetype coverage: ${
        criticalUncovered.map((item) => item.name).join(", ")
      }.`,
    );
  }
  if (input.missingJourneyCapabilityIds.length) {
    reasons.push("Required capability coverage has no active journey.");
  }
  if (reasons.length === 0) {
    return {
      status: "passed",
      reasons: input.uncoveredCapabilities.length
        ? ["All required runs passed; non-critical coverage gaps remain."]
        : ["All required tenant compatibility checks passed."],
    };
  }
  return {
    status: "failed",
    reasons,
  };
}
