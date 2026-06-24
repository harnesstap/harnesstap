import { basename } from "node:path";
import { ui } from "../ui/index.js";

export const GUIDE_SCENARIOS_URL =
  "https://github.com/harnessdeck/harnessdeck/blob/main/docs/scenarios/scenarios.md";

export const GIT_ORIGIN_HINTS = [
  "Add a remote: git remote add origin <url>",
  "Snapshots, drift, history, and revert require a git repository with origin configured.",
];

export function resolveInvocationName(): "harnessdeck" | "hd" {
  return basename(process.argv[1] ?? "") === "hd" ? "hd" : "harnessdeck";
}

export function formatCommand(path: string): string {
  return `${resolveInvocationName()} ${path}`.trim();
}

export function collectRepeatedOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function reportNoGitOrigin(retryCommand?: string): void {
  process.exitCode = 1;
  const hints = [...GIT_ORIGIN_HINTS];
  if (retryCommand) {
    hints.push(`Then retry: ${retryCommand}`);
  }
  ui.danger("No git remote origin configured.", { hints });
}

export function isVerboseMode(argv: string[] = process.argv): boolean {
  return argv.includes("-v") || argv.includes("--verbose");
}

export function isGroupedCommandFallbackError(error: unknown): error is {
  code: string;
  exitCode: number;
  message: string;
} {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    exitCode?: unknown;
    message?: unknown;
  };

  return candidate.code === "commander.excessArguments"
    && candidate.exitCode === 1
    && typeof candidate.message === "string"
    && /too many arguments for '(layer|resource|plugin|auth|migrate|harness|environment|profile)'/i.test(candidate.message);
}
