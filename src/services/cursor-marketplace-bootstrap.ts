import type { PluginMarketplaceEntry } from "../config/settings.js";
import { parsePluginRef } from "../plugins/claude-installed.js";
import { defaultRunCommand, type CommandResult } from "../plugins/run-command.js";

export const CURSOR_BUILTIN_MARKETPLACE = "cursor-public";

export interface CursorMarketplaceToEnsure {
  name: string;
  url: string;
}

export interface CursorHostMarketplace {
  name: string;
  gitUrl: string;
}

export interface EnsureCursorMarketplacesOptions {
  projectRoot: string;
  homeRoot?: string;
  runAgentPlugin?: (args: string[]) => CommandResult;
  agentBinary?: string;
}

export interface EnsureCursorMarketplacesResult {
  added: string[];
  skipped: string[];
  listFailed?: string;
}

export function cursorMarketplaceGitUrlKey(url: string): string {
  let value = url.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  const scp = value.match(/^git@github\.com:(.+)$/i);
  if (scp?.[1]) {
    value = `https://github.com/${scp[1]}`;
  }
  const ssh = value.match(/^ssh:\/\/git@github\.com\/(.+)$/i);
  if (ssh?.[1]) {
    value = `https://github.com/${ssh[1]}`;
  }
  return value.toLowerCase();
}

export function isCursorBuiltinMarketplace(name: string): boolean {
  return name === CURSOR_BUILTIN_MARKETPLACE;
}

export function cursorMarketplaceIsRegistered(
  listed: readonly CursorHostMarketplace[],
  wanted: CursorMarketplaceToEnsure,
): boolean {
  if (listed.some((entry) => entry.name === wanted.name)) {
    return true;
  }
  const wantedKey = cursorMarketplaceGitUrlKey(wanted.url);
  if (!wantedKey) return false;
  return listed.some((entry) => {
    if (!entry.gitUrl) return false;
    return cursorMarketplaceGitUrlKey(entry.gitUrl) === wantedKey;
  });
}

export function selectCursorMarketplacesToEnsure(
  entries: readonly PluginMarketplaceEntry[],
  pinRefs: readonly string[],
): CursorMarketplaceToEnsure[] {
  const names = new Set(
    pinRefs
      .map((ref) => parsePluginRef(ref).marketplace)
      .filter((marketplace) => marketplace.length > 0),
  );
  return entries
    .filter(
      (entry) =>
        entry.platforms.includes("cursor") && names.has(entry.name),
    )
    .map((entry) => ({ name: entry.name, url: entry.url }));
}

function parseCursorMarketplaceList(
  stdout: string,
): CursorHostMarketplace[] | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) return null;
    const listed: CursorHostMarketplace[] = [];
    for (const row of parsed) {
      if (typeof row !== "object" || row === null) continue;
      const record = row as Record<string, unknown>;
      if (typeof record.name !== "string" || record.name.length === 0) continue;
      listed.push({
        name: record.name,
        gitUrl: typeof record.gitUrl === "string" ? record.gitUrl : "",
      });
    }
    return listed;
  } catch {
    return null;
  }
}

function resolveAgentRunner(
  options: EnsureCursorMarketplacesOptions,
): (args: string[]) => CommandResult {
  if (options.runAgentPlugin) {
    return options.runAgentPlugin;
  }
  const binary = options.agentBinary ?? process.env.CURSOR_AGENT ?? "agent";
  return (args) =>
    defaultRunCommand(binary, ["plugin", ...args], {
      cwd: options.projectRoot,
    });
}

export function ensureCursorMarketplaces(
  entries: readonly CursorMarketplaceToEnsure[],
  options: EnsureCursorMarketplacesOptions,
): EnsureCursorMarketplacesResult {
  const candidates = entries.filter(
    (entry) => !isCursorBuiltinMarketplace(entry.name),
  );
  const skipped = entries
    .filter((entry) => isCursorBuiltinMarketplace(entry.name))
    .map((entry) => entry.name);

  if (candidates.length === 0) {
    return { added: [], skipped };
  }

  const run = resolveAgentRunner(options);
  const list = run(["marketplace", "list", "--format", "json"]);
  const listed = list.exitCode === 0 ? parseCursorMarketplaceList(list.stdout) : null;
  if (!listed) {
    return {
      added: [],
      skipped: [...skipped, ...candidates.map((entry) => entry.name)],
      listFailed:
        list.stderr.trim() ||
        list.stdout.trim() ||
        "agent plugin marketplace list failed",
    };
  }

  const added: string[] = [];
  for (const entry of candidates) {
    if (cursorMarketplaceIsRegistered(listed, entry)) {
      skipped.push(entry.name);
      continue;
    }
    const add = run(["marketplace", "add", entry.url]);
    if (add.exitCode === 0) {
      added.push(entry.name);
      listed.push({ name: entry.name, gitUrl: entry.url });
    }
  }

  return { added, skipped };
}
