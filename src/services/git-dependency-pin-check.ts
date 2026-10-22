import {
  InvalidGitDependencyConstraintError,
  parseGitDependencyConstraint,
} from "../utils/git-dependency-constraint.js";

export interface GitDependencyPinIssue {
  severity: "error" | "warning";
  message: string;
}

/**
 * Doctor and validate read a git dependency's constraint as a commit, tag,
 * branch or semver range over tags, not as a plugin version (#500).
 */
export function gitDependencyPinIssue(
  ref: string,
  constraint: string,
): GitDependencyPinIssue | null {
  try {
    const pin = parseGitDependencyConstraint(constraint);
    if (pin.kind === "none") {
      return {
        severity: "warning",
        message: `Git dependency ${ref} is not pinned and tracks the default branch HEAD. Pin a commit, tag or branch, for example #<sha> or ref:<tag>.`,
      };
    }
    return null;
  } catch (error) {
    return {
      severity: "error",
      message:
        error instanceof InvalidGitDependencyConstraintError
          ? `${error.message} (${ref})`
          : `Invalid git dependency constraint for ${ref}`,
    };
  }
}
