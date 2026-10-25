export interface CutVersionRow {
  name: string;
  currentVersion: string;
  newVersion: string;
  /** Errors show only after the user edits the field. */
  edited?: boolean;
}

/** Next patch after `version` (1.0.0 -> 1.0.1); prerelease and build are dropped. Empty when not x.y.z. */
export function nextPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) {
    return "";
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

/** Errors to show: only rows the user has edited. */
export function visibleCutErrors(
  rows: CutVersionRow[],
  errors: Record<string, string>,
): Record<string, string> {
  const visible: Record<string, string> = {};
  for (const row of rows) {
    const error = errors[row.name];
    if (row.edited && error) {
      visible[row.name] = error;
    }
  }
  return visible;
}

/** Loose semver check aligned with agent `semver.valid` (x.y.z with optional prerelease/build). */
const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function isValidSemver(version: string): boolean {
  return SEMVER_RE.test(version.trim());
}

export function validateCutRows(
  rows: CutVersionRow[],
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const row of rows) {
    const next = row.newVersion.trim();
    if (!next) {
      errors[row.name] = "Version is required";
      continue;
    }
    if (!isValidSemver(next)) {
      errors[row.name] = "Use a version like 1.2.3";
      continue;
    }
    if (next === row.currentVersion) {
      errors[row.name] = "Must differ from current version";
    }
  }

  return errors;
}

export function cutRowsAreValid(rows: CutVersionRow[]): boolean {
  return Object.keys(validateCutRows(rows)).length === 0;
}
