import semver from "semver";

export type VersionConstraint =
  | { kind: "exact"; version: string }
  | { kind: "range"; range: string };

/**
 * `latest` is the stored default for a dependency added without a version,
 * and harnesstap 1.4.0 also recorded it as the version of a profile pulled
 * without `--version`. It means any version, the same as `*`.
 */
export const LATEST_CONSTRAINT = "latest";

export function parseVersionConstraint(raw: string): VersionConstraint {
  const trimmed = raw.trim();
  if (trimmed === LATEST_CONSTRAINT) {
    return { kind: "range", range: "*" };
  }
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
  // Host installs can record a git sha as the version (Claude Code does for
  // marketplace plugins that declare none). It satisfies no semver constraint.
  if (!semver.valid(installed)) return false;
  const parsed = parseVersionConstraint(constraint);
  if (parsed.kind === "exact") {
    return semver.eq(installed, parsed.version);
  }
  return semver.satisfies(installed, parsed.range, { includePrerelease: true });
}
