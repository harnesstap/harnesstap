import {
  pullLibraryPluginVersions,
  switchLibraryPluginVersion,
  type PluginVersionPullResult,
} from "./api/resource-mutate";
import { AgentApiError } from "./api/http";
import {
  harnessResourceDisplayName,
  type HarnessResourceRow,
  type HarnessTypeGroup,
} from "./harness-inventory";

export const HARNESS_PULL_ALL_LABEL = "Pull all";
export const HARNESS_PULL_ALL_TOOLTIP = "Pull all plugins";
export const HARNESS_PULL_ALL_EMPTY_TOOLTIP = "No plugins to pull.";
export const HARNESS_PLUGIN_PULL_TITLE = "Plugin updates";
export const HARNESS_PLUGIN_PULL_CONCURRENCY = 4;

export interface HarnessPluginPullTarget {
  readonly selector: string;
  readonly name: string;
}

export type HarnessPluginPullStatus = "updated" | "current" | "failed";

export interface HarnessPluginPullRow {
  readonly name: string;
  readonly selector: string;
  readonly status: HarnessPluginPullStatus;
  readonly fromVersion?: string | null;
  readonly toVersion?: string | null;
  readonly message?: string;
}

export type HarnessPluginPullTone = "ok" | "warn" | "bad";

export interface HarnessPluginPullPill {
  readonly label: string;
  readonly tone: HarnessPluginPullTone;
}

export interface HarnessPluginPullReport {
  readonly results: readonly HarnessPluginPullRow[];
  readonly summary: {
    readonly updated: number;
    readonly current: number;
    readonly failed: number;
  };
  readonly pills: readonly HarnessPluginPullPill[];
}

export interface HarnessPluginPullGroups {
  readonly updated: readonly HarnessPluginPullRow[];
  readonly current: readonly HarnessPluginPullRow[];
  readonly failed: readonly HarnessPluginPullRow[];
}

export function pluginRowsFromTypeGroup(
  group: Pick<HarnessTypeGroup, "sections">,
): HarnessResourceRow[] {
  return group.sections.flatMap((section) => [...section.resources]);
}

export function harnessPluginPullSelector(
  row: Pick<HarnessResourceRow, "id" | "origin_ref">,
): string | null {
  const id = row.id.trim();
  if (id.length > 0) {
    return id;
  }
  const originRef = row.origin_ref?.trim() ?? "";
  return originRef.length > 0 ? originRef : null;
}

export function harnessPluginPullTargets(
  rows: readonly HarnessResourceRow[],
  duplicateNames?: ReadonlySet<string>,
): HarnessPluginPullTarget[] {
  const targets: HarnessPluginPullTarget[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const selector = harnessPluginPullSelector(row);
    if (!selector || seen.has(selector)) {
      continue;
    }
    seen.add(selector);
    targets.push({
      selector,
      name: harnessResourceDisplayName(row, duplicateNames),
    });
  }
  return targets;
}

export function latestPulledVersion(
  info: Pick<PluginVersionPullResult, "advertised_version" | "available_versions">,
): string | null {
  const advertised = info.advertised_version?.trim() ?? "";
  if (advertised.length > 0) {
    return advertised;
  }
  const marked = info.available_versions.find((row) => row.advertised);
  if (marked?.version) {
    return marked.version;
  }
  return info.available_versions[0]?.version ?? null;
}

export function versionChangeLine(
  fromVersion: string | null | undefined,
  toVersion: string | null | undefined,
): string | null {
  const from = fromVersion?.trim() ?? "";
  const to = toVersion?.trim() ?? "";
  if (!to) {
    return from ? `stayed on ${from}` : null;
  }
  if (!from) {
    return `now ${to}`;
  }
  if (from === to) {
    return from;
  }
  return `${from} → ${to}`;
}

function pullErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AgentApiError || error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) {
      return message;
    }
  }
  return fallback;
}

export function countHarnessPluginPull(
  results: readonly HarnessPluginPullRow[],
): HarnessPluginPullReport["summary"] {
  let updated = 0;
  let current = 0;
  let failed = 0;
  for (const row of results) {
    switch (row.status) {
      case "updated":
        updated += 1;
        break;
      case "current":
        current += 1;
        break;
      case "failed":
        failed += 1;
        break;
      default: {
        const exhaustive: never = row.status;
        return exhaustive;
      }
    }
  }
  return { updated, current, failed };
}

export function harnessPluginPullPills(
  summary: HarnessPluginPullReport["summary"],
): HarnessPluginPullPill[] {
  if (summary.updated === 0 && summary.failed === 0 && summary.current > 0) {
    return [{ label: "up to date", tone: "ok" }];
  }
  const pills: HarnessPluginPullPill[] = [];
  if (summary.updated > 0) {
    pills.push({
      label: `${summary.updated} updated`,
      tone: "ok",
    });
  }
  if (summary.current > 0) {
    pills.push({
      label: `${summary.current} current`,
      tone: "ok",
    });
  }
  if (summary.failed > 0) {
    pills.push({
      label: `${summary.failed} failed`,
      tone: "bad",
    });
  }
  return pills;
}

export function makeHarnessPluginPullReport(
  results: readonly HarnessPluginPullRow[],
): HarnessPluginPullReport {
  const summary = countHarnessPluginPull(results);
  return {
    results,
    summary,
    pills: harnessPluginPullPills(summary),
  };
}

export function groupHarnessPluginPullReport(
  report: HarnessPluginPullReport,
): HarnessPluginPullGroups {
  return {
    updated: report.results.filter((row) => row.status === "updated"),
    current: report.results.filter((row) => row.status === "current"),
    failed: report.results.filter((row) => row.status === "failed"),
  };
}

export interface HarnessPluginPullDeps {
  pull: typeof pullLibraryPluginVersions;
  switchVersion: typeof switchLibraryPluginVersion;
  concurrency?: number;
}

const defaultDeps: HarnessPluginPullDeps = {
  pull: pullLibraryPluginVersions,
  switchVersion: switchLibraryPluginVersion,
};

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index] as T, index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function pullOneHarnessPlugin(
  baseUrl: string,
  token: string | null,
  target: HarnessPluginPullTarget,
  deps: HarnessPluginPullDeps,
): Promise<HarnessPluginPullRow> {
  try {
    const pulled = await deps.pull(baseUrl, token, target.selector);
    const current = pulled.current_version;
    const latest = latestPulledVersion(pulled);
    if (!latest) {
      if (current) {
        return {
          name: target.name,
          selector: target.selector,
          status: "current",
          fromVersion: current,
          toVersion: current,
        };
      }
      return {
        name: target.name,
        selector: target.selector,
        status: "failed",
        message: `No versions found for ${target.name}`,
      };
    }
    if (latest === current) {
      return {
        name: target.name,
        selector: target.selector,
        status: "current",
        fromVersion: current,
        toVersion: latest,
      };
    }
    const switched = await deps.switchVersion(
      baseUrl,
      token,
      target.selector,
      latest,
    );
    return {
      name: target.name,
      selector: target.selector,
      status: "updated",
      fromVersion: current,
      toVersion: switched.version,
    };
  } catch (error: unknown) {
    return {
      name: target.name,
      selector: target.selector,
      status: "failed",
      message: pullErrorMessage(error, `Could not pull ${target.name}`),
    };
  }
}

export async function pullLatestHarnessPlugins(
  baseUrl: string,
  token: string | null,
  targets: readonly HarnessPluginPullTarget[],
  onProgress?: (completed: number, total: number) => void,
  deps: HarnessPluginPullDeps = defaultDeps,
): Promise<HarnessPluginPullReport> {
  const total = targets.length;
  let completed = 0;
  onProgress?.(0, total);
  const results = await mapPool(
    targets,
    deps.concurrency ?? HARNESS_PLUGIN_PULL_CONCURRENCY,
    async (target) => {
      const row = await pullOneHarnessPlugin(baseUrl, token, target, deps);
      completed += 1;
      onProgress?.(completed, total);
      return row;
    },
  );
  return makeHarnessPluginPullReport(results);
}

export function harnessPluginPullProgressCopy(
  completed: number,
  total: number,
): string {
  if (total === 0) {
    return "Pulling…";
  }
  const shown = Math.min(completed + 1, total);
  return `Pulling ${shown} of ${total}…`;
}
