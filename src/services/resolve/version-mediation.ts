import semver from "semver";
import { parseVersionConstraint } from "../plugin-constraints.js";
import type { DependencySourceKind } from "../../types.js";
import { UnsatisfiableConstraintError } from "./types.js";
import type { ConstraintRecord, SelectionReason } from "./types.js";

const ANY = "*";

/**
 * Normalize a declared constraint to a semver range string. Exact versions
 * become equality ranges so a single `semver.satisfies` call can evaluate the
 * whole intersection.
 */
export function normalizeConstraint(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === ANY || trimmed === "latest") {
    return ANY;
  }
  const parsed = parseVersionConstraint(trimmed);
  return parsed.kind === "exact" ? `=${parsed.version}` : parsed.range;
}

/**
 * AND every meaningful constraint into one range. semver treats a
 * space-separated range as a conjunction, so an empty intersection simply has
 * no satisfying version — no explicit range algebra needed.
 */
export function intersectConstraints(constraints: string[]): string {
  const meaningful = constraints
    .map(normalizeConstraint)
    .filter((constraint) => constraint !== ANY);
  return meaningful.length === 0 ? ANY : meaningful.join(" ");
}

export function selectVersion(input: {
  name: string;
  available: string[];
  constraints: ConstraintRecord[];
  rootOverride?: string;
  rootName: string;
  sourceKind?: DependencySourceKind;
}): { version: string; reason: SelectionReason } {
  const sorted = [...input.available]
    .filter((version) => semver.valid(version) !== null)
    .sort(semver.rcompare);
  const nonSemver = input.available.filter(
    (version) => semver.valid(version) === null && version !== "unknown",
  );
  const availableForErrors = sorted.length > 0 ? sorted : nonSemver;

  if (input.rootOverride) {
    if (!input.available.includes(input.rootOverride)) {
      throw new UnsatisfiableConstraintError({
        pluginName: input.name,
        requirers: [
          {
            constraint: `=${input.rootOverride}`,
            requirer: `${input.rootName} (override)`,
            path: [input.rootName],
          },
        ],
        available: availableForErrors,
        rootName: input.rootName,
        rootOverride: input.rootOverride,
        ...(input.sourceKind ? { sourceKind: input.sourceKind } : {}),
      });
    }
    return { version: input.rootOverride, reason: "root-override" };
  }

  // A constraint declared directly by the root ends mediation, matching npm
  // `overrides` semantics.
  const rootDeclared = input.constraints.filter(
    (record) => record.path.length === 1 && normalizeConstraint(record.constraint) !== ANY,
  );
  const effective = rootDeclared.length > 0 ? rootDeclared : input.constraints;
  const range = intersectConstraints(effective.map((record) => record.constraint));

  const satisfying = sorted.filter((version) =>
    semver.satisfies(version, range, { includePrerelease: true }),
  );
  const winner = satisfying[0];
  if (winner === undefined) {
    // Marketplace installs may be git SHAs (not semver). Unbounded constraints
    // and marketplace soft-selection can still use those concrete installs.
    const fallback =
      (range === ANY ? nonSemver[0] : undefined)
      ?? (input.sourceKind === "marketplace"
        ? (sorted[0] ?? nonSemver[0])
        : undefined);
    if (fallback) {
      return {
        version: fallback,
        reason: rootDeclared.length > 0 ? "root-constraint" : "mediation",
      };
    }
    throw new UnsatisfiableConstraintError({
      pluginName: input.name,
      requirers: input.constraints,
      available: availableForErrors,
      rootName: input.rootName,
      ...(input.sourceKind ? { sourceKind: input.sourceKind } : {}),
    });
  }

  return {
    version: winner,
    reason: rootDeclared.length > 0 ? "root-constraint" : "mediation",
  };
}
