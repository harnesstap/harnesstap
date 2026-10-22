import semver from "semver";

/**
 * What a git dependency's constraint pins (#500).
 *
 * - `none`: empty, `latest` or `*`. The dependency tracks the default branch HEAD.
 * - `semver`: a version or range, resolved against the repository's tags.
 * - `commit`: a full or abbreviated commit SHA (7 to 40 hex characters),
 *   bare or written `#<sha>`.
 * - `ref`: a tag or branch name, bare or written `#<name>` or `ref:<name>`.
 */
export type GitDependencyPin =
  | { kind: "none" }
  | { kind: "semver"; range: string }
  | { kind: "commit"; sha: string }
  | { kind: "ref"; ref: string };

const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;

export function isFullCommitSha(value: string): boolean {
  return FULL_COMMIT_SHA.test(value);
}

/** Follows `git check-ref-format` for a branch or tag name. */
export function isValidGitRefName(name: string): boolean {
  if (name.length === 0 || name === "@") return false;
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/")) return false;
  if (name.endsWith(".") || name.endsWith(".lock")) return false;
  if (name.includes("..") || name.includes("//") || name.includes("@{")) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: git refuses control characters in ref names.
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false;
  return name.split("/").every((part) => part.length > 0 && !part.startsWith("."));
}

export class InvalidGitDependencyConstraintError extends Error {
  constructor(raw: string) {
    super(
      `Invalid git dependency constraint: ${raw}. Use a commit SHA, a tag or branch name (for example #main or ref:v1.2.0), or a semver range matched against tags.`,
    );
    this.name = "InvalidGitDependencyConstraintError";
  }
}

function explicitRef(value: string, raw: string): GitDependencyPin {
  if (COMMIT_SHA.test(value)) return { kind: "commit", sha: value.toLowerCase() };
  if (!isValidGitRefName(value)) throw new InvalidGitDependencyConstraintError(raw);
  return { kind: "ref", ref: value };
}

export function parseGitDependencyConstraint(raw: string | undefined | null): GitDependencyPin {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "" || trimmed === "latest" || trimmed === "*") return { kind: "none" };
  if (trimmed.startsWith("#")) return explicitRef(trimmed.slice(1).trim(), trimmed);
  if (trimmed.startsWith("ref:")) {
    const ref = trimmed.slice("ref:".length).trim();
    if (!isValidGitRefName(ref)) throw new InvalidGitDependencyConstraintError(trimmed);
    return { kind: "ref", ref };
  }
  if (COMMIT_SHA.test(trimmed)) return { kind: "commit", sha: trimmed.toLowerCase() };
  if (semver.valid(trimmed) || semver.validRange(trimmed)) {
    return { kind: "semver", range: trimmed };
  }
  if (isValidGitRefName(trimmed)) return { kind: "ref", ref: trimmed };
  throw new InvalidGitDependencyConstraintError(trimmed);
}

/** True when the constraint names a commit, tag or branch rather than a version. */
export function isGitRefConstraint(raw: string | undefined | null): boolean {
  try {
    const pin = parseGitDependencyConstraint(raw);
    return pin.kind === "commit" || pin.kind === "ref";
  } catch {
    return false;
  }
}

/** The ref a checkout should fetch, or undefined to track the default branch HEAD. */
export function gitPinFetchRef(pin: GitDependencyPin): string | undefined {
  switch (pin.kind) {
    case "none":
      return undefined;
    case "commit":
      return pin.sha;
    case "ref":
      return pin.ref;
    case "semver":
      return pin.range;
    default: {
      const _exhaustive: never = pin;
      return _exhaustive;
    }
  }
}
