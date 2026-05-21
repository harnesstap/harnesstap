import semver from "semver";

export type VersionConstraint =
  | { kind: "exact"; version: string }
  | { kind: "range"; range: string };

export function parseVersionConstraint(raw: string): VersionConstraint {
  const trimmed = raw.trim();
  if (semver.valid(trimmed)) {
    return { kind: "exact", version: trimmed };
  }
  if (semver.validRange(trimmed)) {
    return { kind: "range", range: trimmed };
  }
  throw new Error(`Invalid version constraint: ${raw}`);
}

export function satisfiesConstraint(constraint: string, installed: string): boolean {
  if (installed === "unknown") return false;
  const parsed = parseVersionConstraint(constraint);
  if (parsed.kind === "exact") {
    return semver.eq(installed, parsed.version);
  }
  return semver.satisfies(installed, parsed.range, { includePrerelease: true });
}
