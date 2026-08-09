export interface CutVersionRow {
  name: string;
  currentVersion: string;
  newVersion: string;
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
      errors[row.name] = "Invalid semver version";
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
