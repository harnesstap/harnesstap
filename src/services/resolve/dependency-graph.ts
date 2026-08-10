import semver from "semver";
import { getDb } from "../../db/connection.js";
import {
  getPluginById,
  getPluginByName,
  getPluginByPublishedIdentity,
  listPluginVersions,
} from "../../models/plugin-model.js";
import type { DependencySourceKind, Plugin } from "../../types.js";
import { listDependencies } from "../plugin-dependency.js";
import { getPluginOverrides } from "../plugin-overrides.js";
import { parsePluginSelector } from "../plugin-selector.js";
import { selectVersion } from "./version-mediation.js";
import type { ConstraintRecord, SelectedPlugin, SelectionReason } from "./types.js";

/** Safety valve: the fixpoint converges in far fewer passes in practice. */
const MAX_PASSES = 64;

function label(name: string, version: string): string {
  return `${name}@${version}`;
}

function missingDependency(
  name: string,
  version: string,
  sourceKind: string,
): Error {
  const fix =
    sourceKind === "marketplace"
      ? `ht plugin apply <root> --sync-plugins`
      : sourceKind === "catalog"
        ? `ht plugin pull ${name}`
        : `ht plugin create ${name}`;
  return new Error(
    `Dependency ${name}@${version} is not available locally (source: ${sourceKind})\n  fix: ${fix}`,
  );
}

function listAvailableVersions(dependencyName: string): string[] {
  try {
    const parsed = parsePluginSelector(dependencyName);
    if (parsed.scope === "published") {
      const rows = getDb()
        .prepare(
          `SELECT version FROM plugins
           WHERE name = ? AND org_slug = ? AND catalog_slug = ?`,
        )
        .all(parsed.name, parsed.org, parsed.catalog) as Array<{ version: string }>;
      return rows
        .map((row) => row.version)
        .filter((version) => semver.valid(version) !== null)
        .sort(semver.rcompare);
    }
    return listPluginVersions(parsed.name);
  } catch {
    return listPluginVersions(dependencyName);
  }
}

function resolveDependencyVersion(
  dependencyName: string,
  version: string,
): Plugin | undefined {
  try {
    const parsed = parsePluginSelector(dependencyName);
    if (parsed.scope === "published") {
      return getPluginByPublishedIdentity({
        name: parsed.name,
        version,
        org: parsed.org,
        catalog: parsed.catalog,
      });
    }
    return getPluginByName(parsed.name, version);
  } catch {
    return getPluginByName(dependencyName, version);
  }
}

interface WalkFrame {
  pluginId: string;
  label: string;
  path: string[];
  depth: number;
}

export interface DependencyWalk {
  /** Root first, then dependencies ordered by depth then declaration index. */
  selected: SelectedPlugin[];
  rootLabel: string;
}

/**
 * Walk the dependency graph from `rootPluginId`, unifying every plugin name to
 * exactly one version.
 *
 * Selecting a version requires knowing the constraints on it, and discovering
 * those constraints requires expanding a chosen version. The walk therefore
 * runs to a fixed point: each pass expands using the previous pass's
 * selections, recomputes selections from the complete constraint set, and
 * repeats until the selection map stops changing.
 */
export function walkDependencyGraph(input: {
  rootPluginId: string;
  /** Pin selections from a lockfile. Bypasses mediation for the named plugins. */
  lockedVersions?: Map<string, string>;
}): DependencyWalk {
  const root = getPluginById(input.rootPluginId);
  if (!root) {
    throw new Error(`Plugin not found: ${input.rootPluginId}`);
  }
  const rootLabel = label(root.name, root.version);
  const overrides = getPluginOverrides(root.id);

  let previous = new Map<string, string>();

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const constraints = new Map<string, ConstraintRecord[]>();
    const depths = new Map<string, number>();
    const declarationIndexes = new Map<string, number>();
    const shortestPaths = new Map<string, string[]>();
    const sourceKinds = new Map<string, DependencySourceKind>();
    let nextDeclarationIndex = 1;

    const visited = new Set<string>([root.id]);
    const queue: WalkFrame[] = [
      { pluginId: root.id, label: rootLabel, path: [rootLabel], depth: 0 },
    ];

    while (queue.length > 0) {
      const frame = queue.shift();
      if (!frame) break;

      for (const dependency of listDependencies(frame.pluginId)) {
        // Marketplace refs like `web-search@anthropics` store name `web-search`,
        // matching the upstream plugin created by materializeUpstreamPlugin.
        const name = dependency.name;
        if (!sourceKinds.has(name)) {
          sourceKinds.set(name, dependency.source_kind);
        }
        const bucket = constraints.get(name) ?? [];
        bucket.push({
          constraint: dependency.version_constraint || "*",
          path: frame.path,
          requirer: frame.label,
        });
        constraints.set(name, bucket);

        const depth = frame.depth + 1;
        const knownDepth = depths.get(name);
        if (knownDepth === undefined || depth < knownDepth) {
          depths.set(name, depth);
          shortestPaths.set(name, [...frame.path]);
        }
        if (!declarationIndexes.has(name)) {
          declarationIndexes.set(name, nextDeclarationIndex);
          nextDeclarationIndex += 1;
        }

        // Expand using the previous pass's choice so the walk is stable within
        // a pass; the final selection is recomputed below from all constraints.
        const provisional =
          input.lockedVersions?.get(name) ??
          previous.get(name) ??
          selectVersion({
            name,
            available: listAvailableVersions(name),
            constraints: bucket,
            rootOverride: overrides.versions[name],
            rootName: root.name,
            sourceKind: dependency.source_kind,
          }).version;

        const resolved = resolveDependencyVersion(name, provisional);
        if (!resolved) {
          throw missingDependency(name, provisional, dependency.source_kind);
        }
        if (!visited.has(resolved.id)) {
          visited.add(resolved.id);
          queue.push({
            pluginId: resolved.id,
            label: label(name, provisional),
            path: [...frame.path, label(name, provisional)],
            depth,
          });
        }
      }
    }

    const current = new Map<string, string>();
    const reasons = new Map<string, SelectionReason>();
    for (const [name, records] of constraints) {
      const locked = input.lockedVersions?.get(name);
      if (locked !== undefined) {
        current.set(name, locked);
        reasons.set(name, "locked");
        continue;
      }
      const selection = selectVersion({
        name,
        available: listAvailableVersions(name),
        constraints: records,
        rootOverride: overrides.versions[name],
        rootName: root.name,
        sourceKind: sourceKinds.get(name),
      });
      current.set(name, selection.version);
      reasons.set(name, selection.reason);
    }

    const stable =
      current.size === previous.size &&
      [...current].every(([name, version]) => previous.get(name) === version);
    previous = current;

    if (!stable && pass < MAX_PASSES - 1) {
      continue;
    }
    if (!stable) {
      throw new Error(
        "Dependency resolution did not converge. This usually means a version " +
          "cycle; run `ht plugin show <plugin>` to inspect the dependency list.",
      );
    }

    const selected: SelectedPlugin[] = [
      {
        name: root.name,
        version: root.version,
        pluginId: root.id,
        depth: 0,
        declarationIndex: 0,
        constraints: [],
        reason: "root",
        path: [rootLabel],
        source: "local",
      },
    ];

    for (const [name, version] of current) {
      const plugin = resolveDependencyVersion(name, version);
      if (!plugin) {
        throw missingDependency(
          name,
          version,
          sourceKinds.get(name) ?? "local",
        );
      }
      selected.push({
        name,
        version,
        pluginId: plugin.id,
        depth: depths.get(name) ?? 1,
        declarationIndex: declarationIndexes.get(name) ?? Number.MAX_SAFE_INTEGER,
        constraints: constraints.get(name) ?? [],
        reason: reasons.get(name) ?? "mediation",
        path: shortestPaths.get(name) ?? [rootLabel],
        source: sourceKinds.get(name) ?? "local",
      });
    }

    selected.sort(
      (a, b) => a.depth - b.depth || a.declarationIndex - b.declarationIndex,
    );

    return { selected, rootLabel };
  }

  throw new Error("Dependency resolution did not converge");
}
