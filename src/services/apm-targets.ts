import { getPlatform } from "../platforms/registry.js";

/**
 * OpenAPM v0.1 canonical target identifiers (plus working-draft extras and
 * legacy aliases). Mapped onto HarnessTap harness slugs where the names differ.
 */
const APM_TARGET_ALIASES: Record<string, string> = {
  vscode: "copilot",
  agents: "copilot",
};

const APM_TARGET_TO_HARNESS: Record<string, string> = {
  claude: "claude-code",
  copilot: "github-copilot",
  cursor: "cursor",
  codex: "codex",
  gemini: "gemini-cli",
  antigravity: "antigravity",
  opencode: "opencode",
  windsurf: "windsurf",
  "grok-build": "grok-build",
  kiro: "kiro",
};

const APM_ALL_TARGETS = [
  "copilot",
  "claude",
  "cursor",
  "codex",
  "gemini",
  "opencode",
  "windsurf",
  "grok-build",
] as const;

export interface ApmTargetMapping {
  harnessTargets: string[];
  skippedTargets: string[];
  warnings: string[];
}

function isVendorTarget(token: string): boolean {
  return /^x-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$/.test(token);
}

function normalizeApmTargetToken(token: string): string {
  const lowered = token.trim().toLowerCase();
  return APM_TARGET_ALIASES[lowered] ?? lowered;
}

function mapOneTarget(token: string): { harness?: string; skipReason?: string } {
  const normalized = normalizeApmTargetToken(token);
  if (normalized === "agent-skills") {
    return { skipReason: `APM target "${token}" is not a HarnessTap harness; skipping` };
  }
  if (normalized === "all") {
    return {};
  }

  const mapped = APM_TARGET_TO_HARNESS[normalized];
  if (mapped) {
    return { harness: mapped };
  }

  if (getPlatform(normalized)) {
    return { harness: normalized };
  }

  if (isVendorTarget(normalized)) {
    if (getPlatform(normalized)) {
      return { harness: normalized };
    }
    return {
      skipReason: `Unknown APM vendor target "${token}"; skipping`,
    };
  }

  return { skipReason: `Unknown APM target "${token}"; skipping` };
}

export function collectApmTargetTokens(document: Record<string, unknown>): string[] {
  const raw = document.targets ?? document.target;
  if (raw === undefined || raw === null) {
    return [];
  }
  if (typeof raw === "string") {
    return [raw];
  }
  if (Array.isArray(raw)) {
    return raw.map((entry) => String(entry));
  }
  return [];
}

export function mapApmTargets(tokens: string[]): ApmTargetMapping {
  const harnessTargets: string[] = [];
  const skippedTargets: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  const expanded = tokens.some((token) => normalizeApmTargetToken(token) === "all")
    ? [...APM_ALL_TARGETS]
    : tokens;

  if (tokens.some((token) => normalizeApmTargetToken(token) === "all")) {
    const extras = tokens.filter((token) => normalizeApmTargetToken(token) !== "all");
    expanded.push(...extras);
  }

  for (const token of expanded) {
    const mapped = mapOneTarget(token);
    if (mapped.skipReason) {
      skippedTargets.push(token);
      warnings.push(mapped.skipReason);
      continue;
    }
    if (!mapped.harness) {
      continue;
    }
    if (seen.has(mapped.harness)) {
      continue;
    }
    seen.add(mapped.harness);
    harnessTargets.push(mapped.harness);
  }

  return { harnessTargets, skippedTargets, warnings };
}
