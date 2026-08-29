import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { getPlatform } from "../platforms/registry.js";
import { CliUsageError } from "./cli-errors.js";
import {
  assertSupportedHarnessTargets,
  parsePlatformFilter,
  uniqueHarnessTargets,
} from "./harness-targets.js";

/**
 * OpenAPM canonical target identifiers (plus working-draft extras and
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

/** Canonical APM slugs accepted in `targets:` / `--target`. */
export const CANONICAL_APM_TARGETS = [
  "copilot",
  "claude",
  "grok-build",
  "cursor",
  "opencode",
  "codex",
  "gemini",
  "antigravity",
  "windsurf",
  "kiro",
  "agent-skills",
] as const;

export type CanonicalApmTarget = (typeof CANONICAL_APM_TARGETS)[number];

/**
 * `--all` expansion. `agent-skills` stays a skipped meta-target.
 * `antigravity` and `kiro` are included so `--all` covers the HT-mapped
 * canonical set beyond the original eight.
 */
export const APM_ALL_TARGETS = [
  "copilot",
  "claude",
  "grok-build",
  "cursor",
  "opencode",
  "codex",
  "gemini",
  "antigravity",
  "windsurf",
  "kiro",
] as const;

export type TargetResolutionSource = "cli" | "manifest" | "preference" | "autodetect" | "empty";

export interface ApmTargetMapping {
  harnessTargets: string[];
  skippedTargets: string[];
  warnings: string[];
  canonicalTargets: string[];
}

export interface ApmTargetSignal {
  target: CanonicalApmTarget;
  matched: string;
}

export interface TargetPreviewRow {
  target: string;
  status: "active" | "inactive";
  source: string;
  deployDir: string;
  harness?: string;
}

export interface ResolveCompileTargetsInput {
  projectRoot: string;
  cliTarget?: string;
  cliAll?: boolean;
  cliHarness?: string;
  /** Already-mapped HT harness slugs from `apm.yml` `targets` / `compilation.target`. */
  manifestHarnessTargets?: string[];
  /** Project/global harness preference slugs. Used after declared targets. */
  preferenceHarnesses?: string[];
  /** HT `detectPlatforms` slugs. Used after APM filesystem signals. */
  fallbackHarnesses?: string[];
}

export interface ResolvedCompileTargets {
  harnessTargets: string[];
  canonicalTargets: string[];
  source: TargetResolutionSource;
  warnings: string[];
  skippedTargets: string[];
  detectedSignals: ApmTargetSignal[];
}

export class TargetFlagError extends CliUsageError {
  constructor(message: string) {
    super(message, [], 2);
    this.name = "TargetFlagError";
  }
}

const APM_TARGET_CATALOG: Record<
  string,
  { deployDir: string; signals: string[]; explicitOnly?: boolean; needs: string }
> = {
  copilot: {
    deployDir: ".github/",
    signals: [
      ".github/copilot-instructions.md",
      ".github/instructions",
      ".github/agents",
      ".github/prompts",
      ".github/hooks",
    ],
    needs: "needs .github/copilot-instructions.md",
  },
  claude: {
    deployDir: ".claude/",
    signals: [".claude", "CLAUDE.md"],
    needs: "needs .claude/ or CLAUDE.md",
  },
  "grok-build": {
    deployDir: ".grok/",
    signals: [".grok"],
    needs: "needs .grok/",
  },
  cursor: {
    deployDir: ".cursor/",
    signals: [".cursor", ".cursorrules"],
    needs: "needs .cursor/ or .cursorrules",
  },
  opencode: {
    deployDir: ".opencode/",
    signals: [".opencode"],
    needs: "needs .opencode/",
  },
  codex: {
    deployDir: ".codex/",
    signals: [".codex"],
    needs: "needs .codex/",
  },
  gemini: {
    deployDir: ".gemini/",
    signals: [".gemini", "GEMINI.md"],
    needs: "needs .gemini/ or GEMINI.md",
  },
  antigravity: {
    deployDir: ".agents/",
    signals: [],
    explicitOnly: true,
    needs: "explicit-only (not auto-detected)",
  },
  windsurf: {
    deployDir: ".windsurf/",
    signals: [".windsurf"],
    needs: "needs .windsurf/",
  },
  kiro: {
    deployDir: ".kiro/",
    signals: [".kiro"],
    needs: "needs .kiro/",
  },
  "agent-skills": {
    deployDir: ".agents/",
    signals: [],
    explicitOnly: true,
    needs: "meta-target; opt in via targets: or --target",
  },
};

const HARNESS_TO_APM: Record<string, string> = Object.fromEntries(
  Object.entries(APM_TARGET_TO_HARNESS).map(([canonical, harness]) => [harness, canonical]),
);

function isVendorTarget(token: string): boolean {
  return /^x-[a-z][a-z0-9-]*-[a-z][a-z0-9-]*$/.test(token);
}

function normalizeApmTargetToken(token: string): string {
  const lowered = token.trim().toLowerCase();
  return APM_TARGET_ALIASES[lowered] ?? lowered;
}

function aliasWarning(token: string): string | undefined {
  const lowered = token.trim().toLowerCase();
  const aliased = APM_TARGET_ALIASES[lowered];
  if (aliased && aliased !== lowered) {
    return `APM target "${token}" is a deprecated alias for ${aliased}`;
  }
  return undefined;
}

function mapOneTarget(token: string): { harness?: string; canonical?: string; skipReason?: string } {
  const normalized = normalizeApmTargetToken(token);
  if (normalized === "agent-skills") {
    return { skipReason: `APM target "${token}" is not a HarnessTap harness; skipping` };
  }
  if (normalized === "all") {
    return {};
  }

  const mapped = APM_TARGET_TO_HARNESS[normalized];
  if (mapped) {
    return { harness: mapped, canonical: normalized };
  }

  if (getPlatform(normalized)) {
    return { harness: normalized, canonical: HARNESS_TO_APM[normalized] ?? normalized };
  }

  if (isVendorTarget(normalized)) {
    if (getPlatform(normalized)) {
      return { harness: normalized, canonical: normalized };
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
  const canonicalTargets: string[] = [];
  const seen = new Set<string>();

  const expanded = tokens.some((token) => normalizeApmTargetToken(token) === "all")
    ? [...APM_ALL_TARGETS]
    : tokens;

  if (tokens.some((token) => normalizeApmTargetToken(token) === "all")) {
    const extras = tokens.filter((token) => normalizeApmTargetToken(token) !== "all");
    expanded.push(...extras);
  }

  for (const token of expanded) {
    const alias = aliasWarning(token);
    if (alias) {
      warnings.push(alias);
    }
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
    if (mapped.canonical) {
      canonicalTargets.push(mapped.canonical);
    }
  }

  return { harnessTargets, skippedTargets, warnings, canonicalTargets };
}

function pathExists(projectRoot: string, relative: string): boolean {
  const absolute = join(projectRoot, relative);
  try {
    return existsSync(absolute);
  } catch {
    return false;
  }
}

function isDirectory(projectRoot: string, relative: string): boolean {
  const absolute = join(projectRoot, relative);
  try {
    return existsSync(absolute) && lstatSync(absolute).isDirectory();
  } catch {
    return false;
  }
}

function signalMatches(projectRoot: string, signal: string): boolean {
  if (signal.includes(".") && !signal.startsWith(".")) {
    return pathExists(projectRoot, signal);
  }
  if (signal.endsWith(".md") || signal === ".cursorrules") {
    return pathExists(projectRoot, signal);
  }
  return isDirectory(projectRoot, signal);
}

export function detectApmTargetSignals(projectRoot: string): ApmTargetSignal[] {
  const detected: ApmTargetSignal[] = [];
  for (const target of CANONICAL_APM_TARGETS) {
    const catalog = APM_TARGET_CATALOG[target];
    if (!catalog || catalog.explicitOnly) {
      continue;
    }
    const matched = catalog.signals.find((signal) => signalMatches(projectRoot, signal));
    if (matched) {
      detected.push({ target, matched: matched.endsWith(".md") || matched === ".cursorrules" ? matched : `${matched}/` });
    }
  }
  return detected;
}

export function harnessSlugForApmTarget(target: string): string | undefined {
  return mapOneTarget(target).harness;
}

export function apmTargetForHarness(harness: string): string {
  return HARNESS_TO_APM[harness] ?? harness;
}

export function deployDirForApmTarget(target: string): string {
  return APM_TARGET_CATALOG[normalizeApmTargetToken(target)]?.deployDir ?? "";
}

export function assertTargetSelectionFlags(input: {
  cliTarget?: string;
  cliAll?: boolean;
  cliHarness?: string;
}): void {
  if (input.cliAll && input.cliTarget) {
    throw new TargetFlagError("error: cannot use --all together with --target");
  }
  if (input.cliAll && input.cliHarness) {
    throw new TargetFlagError("error: cannot use --all together with --harness");
  }
  if (input.cliTarget && input.cliHarness) {
    throw new TargetFlagError("error: cannot use --target together with --harness");
  }
}

function fromMapping(
  mapping: ApmTargetMapping,
  source: TargetResolutionSource,
  detectedSignals: ApmTargetSignal[] = [],
): ResolvedCompileTargets {
  assertSupportedHarnessTargets(mapping.harnessTargets);
  return {
    harnessTargets: uniqueHarnessTargets(mapping.harnessTargets),
    canonicalTargets: mapping.canonicalTargets,
    source,
    warnings: mapping.warnings,
    skippedTargets: mapping.skippedTargets,
    detectedSignals,
  };
}

function fromHarnessSlugs(
  slugs: string[],
  source: TargetResolutionSource,
  warnings: string[] = [],
): ResolvedCompileTargets {
  const unique = uniqueHarnessTargets(slugs);
  assertSupportedHarnessTargets(unique);
  return {
    harnessTargets: unique,
    canonicalTargets: unique.map(apmTargetForHarness),
    source,
    warnings,
    skippedTargets: [],
    detectedSignals: [],
  };
}

export function resolveCompileTargets(input: ResolveCompileTargetsInput): ResolvedCompileTargets {
  assertTargetSelectionFlags(input);

  if (input.cliAll) {
    return fromMapping(mapApmTargets(["all"]), "cli");
  }

  if (input.cliTarget?.trim()) {
    const tokens = parsePlatformFilter(input.cliTarget) ?? [];
    const mapped = mapApmTargets(tokens);
    if (tokens.some((token) => normalizeApmTargetToken(token) === "all")) {
      mapped.warnings.unshift("--target all is deprecated; prefer --all");
    }
    return fromMapping(mapped, "cli");
  }

  if (input.cliHarness?.trim()) {
    const slugs = uniqueHarnessTargets(parsePlatformFilter(input.cliHarness) ?? []);
    return fromHarnessSlugs(slugs, "cli");
  }

  if (input.manifestHarnessTargets && input.manifestHarnessTargets.length > 0) {
    return fromHarnessSlugs(input.manifestHarnessTargets, "manifest");
  }

  if (input.preferenceHarnesses && input.preferenceHarnesses.length > 0) {
    return fromHarnessSlugs(input.preferenceHarnesses, "preference");
  }

  const detected = detectApmTargetSignals(input.projectRoot);
  if (detected.length > 0) {
    return fromMapping(
      mapApmTargets(detected.map((entry) => entry.target)),
      "autodetect",
      detected,
    );
  }

  if (input.fallbackHarnesses && input.fallbackHarnesses.length > 0) {
    return fromHarnessSlugs(input.fallbackHarnesses, "autodetect");
  }

  return {
    harnessTargets: [],
    canonicalTargets: [],
    source: "empty",
    warnings: [],
    skippedTargets: [],
    detectedSignals: [],
  };
}

function sourceLabel(
  resolved: ResolvedCompileTargets,
  target: string,
  detected: ApmTargetSignal[],
): string {
  if (resolved.source === "cli" && resolved.canonicalTargets.includes(target)) {
    return "--target / --all";
  }
  if (resolved.source === "manifest" && resolved.canonicalTargets.includes(target)) {
    return "apm.yml targets:";
  }
  if (resolved.source === "autodetect") {
    const hit = detected.find((entry) => entry.target === target);
    if (hit) {
      return hit.matched;
    }
  }
  if (resolved.source === "preference" && resolved.canonicalTargets.includes(target)) {
    return "harness preference";
  }
  return APM_TARGET_CATALOG[target]?.needs ?? "inactive";
}

export function previewApmTargets(
  resolved: ResolvedCompileTargets,
  options: { includeAgentSkills?: boolean } = {},
): TargetPreviewRow[] {
  const detected = resolved.detectedSignals;
  const active = new Set(resolved.canonicalTargets);
  const rows: TargetPreviewRow[] = [];
  for (const target of CANONICAL_APM_TARGETS) {
    if (target === "agent-skills" && !options.includeAgentSkills) {
      continue;
    }
    const catalog = APM_TARGET_CATALOG[target];
    const isActive = active.has(target);
    rows.push({
      target,
      status: isActive ? "active" : "inactive",
      source: isActive ? sourceLabel(resolved, target, detected) : (catalog?.needs ?? "inactive"),
      deployDir: catalog?.deployDir ?? "",
      ...(isActive && harnessSlugForApmTarget(target)
        ? { harness: harnessSlugForApmTarget(target) }
        : {}),
    });
  }
  return rows;
}
