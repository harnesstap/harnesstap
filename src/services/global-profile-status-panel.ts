import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findInstalledRefForCatalogPin } from "../plugins/claude-plugin-ref.js";
import { loadInstalled, parsePluginRef } from "../plugins/claude-installed.js";
import { listCursorPluginInstalls } from "../plugins/providers/cursor.js";
import type { PluginInstall } from "../plugins/types.js";
import { getPlatform } from "../platforms/registry.js";
import { listGlobalApplySnapshotInstalls } from "../models/global-apply-snapshot.js";
import { getProjectByLocalPath, getProjectByOrigin } from "../models/project.js";
import { getGitOrigin, normalizeGitUrl } from "./git.js";
import { listHostNativeMcpNames } from "./host-native-mcp.js";
import {
  mcpServerMetadataEquivalent,
  parseMcpServersDocument,
} from "./mcp-config-bridge.js";
import type { PluginConstraintPin } from "./plugin-apply-validation.js";
import {
  detectProjectDriftFromLatest,
  type DriftFileChange,
  type ProjectDriftReport,
} from "./project-drift.js";
import type { McpServerMetadata } from "../types.js";

export type GlobalProfileStatusDepth = "fast" | "full";
export type PanelTrafficStatus = "green" | "yellow" | "red";
export type HarnessPluginRowState = "installed" | "missing" | "extra";
export type HarnessMcpRowState = "present" | "missing" | "mismatch" | "extra";

export interface HarnessPluginStatusRow {
  id: string;
  state: HarnessPluginRowState;
}

export interface HarnessMcpStatusRow {
  name: string;
  state: HarnessMcpRowState;
}

export interface HarnessLiveStatus {
  plugins: HarnessPluginStatusRow[];
  mcp: HarnessMcpStatusRow[];
}

export interface GlobalProfilePanelStatus {
  status: PanelTrafficStatus;
  reasons: string[];
}

export interface GlobalDriftSummary {
  status: "clean" | "drifted" | "pending";
  owned_changes: number;
  non_owned_changes: number;
}

export interface ProjectDriftSummary {
  status: "na" | "clean" | "drifted";
  report: ProjectDriftReport | null;
}

export interface GlobalProfileDriftSummary {
  global: GlobalDriftSummary;
  project?: ProjectDriftSummary;
}

const PANEL_HARNESS_IDS = ["claude-code", "cursor"] as const;

export function collectOwnedGlobalProfileFiles(snapshotId: string | null): Set<string> {
  if (!snapshotId) {
    return new Set();
  }
  const owned = new Set<string>();
  for (const install of listGlobalApplySnapshotInstalls(snapshotId)) {
    for (const filePath of install.files) {
      owned.add(filePath);
    }
  }
  return owned;
}

export function classifyGlobalDriftChanges(
  changes: DriftFileChange[],
  ownedFiles: ReadonlySet<string>,
): { owned: DriftFileChange[]; nonOwned: DriftFileChange[] } {
  const owned: DriftFileChange[] = [];
  const nonOwned: DriftFileChange[] = [];
  for (const change of changes) {
    if (ownedFiles.has(change.path)) {
      owned.push(change);
    } else {
      nonOwned.push(change);
    }
  }
  return { owned, nonOwned };
}

function mcpManagedPathForHarness(harnessId: string): string | undefined {
  switch (harnessId) {
    case "cursor":
      return ".cursor/mcp.json";
    case "claude-code":
      return ".mcp.json";
    default:
      return undefined;
  }
}

export function declaredMcpFromExpectedFiles(
  harnessIds: readonly string[],
  expectedFiles: Array<{ path: string; content: string }>,
): {
  namesByHarness: Record<string, string[]>;
  configsByHarness: Record<string, Record<string, McpServerMetadata>>;
} {
  const namesByHarness: Record<string, string[]> = {};
  const configsByHarness: Record<string, Record<string, McpServerMetadata>> = {};

  for (const harnessId of harnessIds) {
    const mcpPath = mcpManagedPathForHarness(harnessId);
    const configs: Record<string, McpServerMetadata> = {};
    if (mcpPath) {
      for (const file of expectedFiles) {
        if (file.path !== mcpPath) {
          continue;
        }
        try {
          const document = JSON.parse(file.content) as unknown;
          Object.assign(configs, parseMcpServersDocument(document));
        } catch {
          // skip invalid MCP config payloads
        }
      }
    }
    namesByHarness[harnessId] = Object.keys(configs);
    configsByHarness[harnessId] = configs;
  }

  return { namesByHarness, configsByHarness };
}

function readGlobalMcpServers(
  homeRoot: string,
  harnessId: string,
): Record<string, McpServerMetadata> {
  const platform = getPlatform(harnessId);
  if (!platform) {
    return {};
  }

  const configuredPath =
    harnessId === "cursor"
      ? platform.globalPaths.settings
      : platform.globalPaths.mcp ?? platform.projectPaths.mcp;

  if (!configuredPath) {
    return {};
  }

  const relativePath = configuredPath.startsWith("~/")
    ? configuredPath.slice(2)
    : configuredPath;
  const fullPath = join(homeRoot, relativePath);
  if (!existsSync(fullPath)) {
    return {};
  }

  try {
    const document = JSON.parse(readFileSync(fullPath, "utf-8")) as unknown;
    return parseMcpServersDocument(document);
  } catch {
    return {};
  }
}

export function buildHarnessPluginRows(
  declaredPins: PluginConstraintPin[],
  homeRoot: string,
): HarnessPluginStatusRow[] {
  const installed = loadInstalled(homeRoot).filter((row) => row.scope === "user");
  const matchedInstalledRefs = new Set<string>();

  const rows: HarnessPluginStatusRow[] = [];
  for (const pin of declaredPins) {
    const installedRef = findInstalledRefForCatalogPin(pin.ref, homeRoot, "user");
    if (installedRef) {
      matchedInstalledRefs.add(installedRef);
      rows.push({ id: pin.ref, state: "installed" });
    } else {
      rows.push({ id: pin.ref, state: "missing" });
    }
  }

  for (const install of installed) {
    if (!matchedInstalledRefs.has(install.ref)) {
      rows.push({ id: install.ref, state: "extra" });
    }
  }

  return rows;
}

function findEnabledCursorInstallForPin(
  pinRef: string,
  installs: readonly PluginInstall[],
): PluginInstall | undefined {
  const enabled = installs.filter((row) => row.enabled);
  const exact = enabled.find((row) => row.ref === pinRef);
  if (exact) return exact;

  const { name } = parsePluginRef(pinRef);
  return enabled.find((row) => row.name === name);
}

/** Cursor status rows: only enabled installs count as installed/extra. */
export function buildCursorHarnessPluginRows(
  declaredPins: PluginConstraintPin[],
  homeRoot: string,
): HarnessPluginStatusRow[] {
  const installs = listCursorPluginInstalls(homeRoot);
  const cursorNames = new Set(installs.map((row) => row.name));
  const matchedEnabledRefs = new Set<string>();

  const rows: HarnessPluginStatusRow[] = [];
  for (const pin of declaredPins) {
    const { name } = parsePluginRef(pin.ref);
    // Skip pins with no Cursor cache/local/marketplace footprint so Claude-only
    // pins are not double-counted as Cursor "missing".
    if (!cursorNames.has(name) && !installs.some((row) => row.ref === pin.ref)) {
      continue;
    }

    const match = findEnabledCursorInstallForPin(pin.ref, installs);
    if (match) {
      matchedEnabledRefs.add(match.ref);
      rows.push({ id: pin.ref, state: "installed" });
    } else {
      rows.push({ id: pin.ref, state: "missing" });
    }
  }

  for (const install of installs) {
    if (!install.enabled) continue;
    if (!matchedEnabledRefs.has(install.ref)) {
      rows.push({ id: install.ref, state: "extra" });
    }
  }

  return rows;
}

export function buildHarnessMcpRows(
  declaredNames: string[],
  liveNames: ReadonlySet<string>,
  comparison?: {
    expected: Record<string, McpServerMetadata>;
    live: Record<string, McpServerMetadata>;
  },
): HarnessMcpStatusRow[] {
  const declared = new Set(declaredNames);
  const rows: HarnessMcpStatusRow[] = declaredNames.map((name) => {
    if (!liveNames.has(name)) {
      return { name, state: "missing" };
    }
    const expected = comparison?.expected[name];
    const live = comparison?.live[name];
    if (
      expected
      && live
      && !mcpServerMetadataEquivalent(expected, live)
    ) {
      return { name, state: "mismatch" };
    }
    return { name, state: "present" };
  });

  for (const name of liveNames) {
    if (!declared.has(name)) {
      rows.push({ name, state: "extra" });
    }
  }

  return rows;
}

export function resolveProjectDriftSummary(projectPath?: string): ProjectDriftSummary | undefined {
  if (!projectPath) {
    return undefined;
  }

  const resolvedRoot = resolve(projectPath);
  const gitOriginRaw = getGitOrigin(resolvedRoot);
  const gitOrigin = gitOriginRaw ? normalizeGitUrl(gitOriginRaw) : null;
  const project =
    getProjectByLocalPath(resolvedRoot)
    ?? (gitOrigin ? getProjectByOrigin(gitOrigin) : undefined)
    ?? null;

  if (!project) {
    return {
      status: "na",
      report: null,
    };
  }

  const report = detectProjectDriftFromLatest(resolvedRoot, project.id);
  return {
    status: report?.has_drift ? "drifted" : "clean",
    report,
  };
}

export function computeGlobalProfilePanelStatus(input: {
  depth: GlobalProfileStatusDepth;
  applied: boolean;
  activeProfile: string | null;
  stackInSync: boolean;
  ownedDriftCount: number;
  nonOwnedDriftCount: number;
  missingPluginCount: number;
  missingMcpCount: number;
  projectDrift?: ProjectDriftSummary;
  warning?: string;
  switchFailed?: boolean;
  restoreFailed?: boolean;
  hostManagedCollisionCount?: number;
}): GlobalProfilePanelStatus {
  const reasons: string[] = [];

  if (input.switchFailed) {
    reasons.push("switch_failed");
  }
  if (input.restoreFailed) {
    reasons.push("restore_failed");
  }
  if (input.warning) {
    reasons.push("status_warning");
  }
  if (input.activeProfile && !input.applied) {
    reasons.push("profile_not_applied");
  }
  if (!input.stackInSync && input.applied) {
    reasons.push("stack_out_of_sync");
  }
  if (input.ownedDriftCount > 0) {
    reasons.push("owned_path_drift");
  }
  if (input.missingPluginCount > 0) {
    reasons.push("missing_plugins");
  }
  if (input.missingMcpCount > 0) {
    reasons.push("missing_mcp");
  }

  const redReasons = new Set([
    "switch_failed",
    "restore_failed",
    "profile_not_applied",
    "stack_out_of_sync",
    "owned_path_drift",
    "missing_plugins",
    "missing_mcp",
  ]);

  if (reasons.some((reason) => redReasons.has(reason)) || (input.warning && input.activeProfile)) {
    return { status: "red", reasons };
  }

  if (input.nonOwnedDriftCount > 0) {
    reasons.push("non_owned_drift");
  }
  if (input.projectDrift?.status === "drifted") {
    reasons.push("project_drift");
  }
  if ((input.hostManagedCollisionCount ?? 0) > 0) {
    reasons.push("cursor_host_skill_collision");
  }
  if (input.depth === "fast") {
    reasons.push("fast_depth");
  }

  if (reasons.length > 0) {
    return { status: "yellow", reasons };
  }

  return { status: "green", reasons };
}

export function buildHarnessLiveStatusMap(input: {
  depth: GlobalProfileStatusDepth;
  homeRoot: string;
  declaredPins: PluginConstraintPin[];
  declaredMcpByHarness: Record<string, string[]>;
  expectedMcpConfigsByHarness?: Record<string, Record<string, McpServerMetadata>>;
}): Record<string, HarnessLiveStatus> {
  const harnesses: Record<string, HarnessLiveStatus> = {};

  for (const harnessId of PANEL_HARNESS_IDS) {
    if (input.depth === "fast") {
      harnesses[harnessId] = { plugins: [], mcp: [] };
      continue;
    }

    const declaredMcp = input.declaredMcpByHarness[harnessId] ?? [];
    const liveServers = readGlobalMcpServers(input.homeRoot, harnessId);
    const liveMcp = new Set([
      ...Object.keys(liveServers),
      ...listHostNativeMcpNames(input.homeRoot, harnessId),
    ]);
    const expectedServers = input.expectedMcpConfigsByHarness?.[harnessId];
    let plugins: HarnessPluginStatusRow[] = [];
    switch (harnessId) {
      case "claude-code":
        plugins = buildHarnessPluginRows(input.declaredPins, input.homeRoot);
        break;
      case "cursor":
        plugins = buildCursorHarnessPluginRows(
          input.declaredPins,
          input.homeRoot,
        );
        break;
      default: {
        const _exhaustive: never = harnessId;
        void _exhaustive;
        plugins = [];
        break;
      }
    }

    harnesses[harnessId] = {
      plugins,
      mcp: buildHarnessMcpRows(
        declaredMcp,
        liveMcp,
        expectedServers
          ? { expected: expectedServers, live: liveServers }
          : undefined,
      ),
    };
  }

  return harnesses;
}

export function countMissingHarnessRows(harnesses: Record<string, HarnessLiveStatus>): {
  missingPlugins: number;
  missingMcp: number;
} {
  let missingPlugins = 0;
  let missingMcp = 0;

  for (const status of Object.values(harnesses)) {
    missingPlugins += status.plugins.filter((row) => row.state === "missing").length;
    missingMcp += status.mcp.filter(
      (row) => row.state === "missing" || row.state === "mismatch",
    ).length;
  }

  return { missingPlugins, missingMcp };
}
