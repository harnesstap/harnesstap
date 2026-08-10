import { getLayerById, getLayerByName, listLayerVersions } from "../../models/layer-model.js";
import { listAttachedLayerRefs } from "../layer-composition.js";
import { getLayerOverrides } from "../layer-overrides.js";
import { selectVersion } from "./version-mediation.js";
import type { ConstraintRecord, SelectedPlugin, SelectionReason } from "./types.js";

/** Safety valve: the fixpoint converges in far fewer passes in practice. */
const MAX_PASSES = 64;

function label(name: string, version: string): string {
  return `${name}@${version}`;
}

interface WalkFrame {
  layerId: string;
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
 * Walk the dependency graph from `rootLayerId`, unifying every plugin name to
 * exactly one version.
 *
 * Selecting a version requires knowing the constraints on it, and discovering
 * those constraints requires expanding a chosen version. The walk therefore
 * runs to a fixed point: each pass expands using the previous pass's
 * selections, recomputes selections from the complete constraint set, and
 * repeats until the selection map stops changing.
 */
export function walkDependencyGraph(input: {
  rootLayerId: string;
  /** Pin selections from a lockfile. Bypasses mediation for the named plugins. */
  lockedVersions?: Map<string, string>;
}): DependencyWalk {
  const root = getLayerById(input.rootLayerId);
  if (!root) {
    throw new Error(`Layer not found: ${input.rootLayerId}`);
  }
  const rootLabel = label(root.name, root.version);
  const overrides = getLayerOverrides(root.id);

  let previous = new Map<string, string>();

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const constraints = new Map<string, ConstraintRecord[]>();
    const depths = new Map<string, number>();
    const declarationIndexes = new Map<string, number>();
    const shortestPaths = new Map<string, string[]>();
    let nextDeclarationIndex = 1;

    const visited = new Set<string>([root.id]);
    const queue: WalkFrame[] = [
      { layerId: root.id, label: rootLabel, path: [rootLabel], depth: 0 },
    ];

    while (queue.length > 0) {
      const frame = queue.shift();
      if (!frame) break;

      for (const dependency of listAttachedLayerRefs(frame.layerId)) {
        const name = dependency.dependency_name;
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
            available: listLayerVersions(name),
            constraints: bucket,
            rootOverride: overrides.versions[name],
            rootName: root.name,
          }).version;

        const resolved = getLayerByName(name, provisional);
        if (!resolved) {
          throw new Error(`Layer not found: ${label(name, provisional)}`);
        }
        if (!visited.has(resolved.id)) {
          visited.add(resolved.id);
          queue.push({
            layerId: resolved.id,
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
        available: listLayerVersions(name),
        constraints: records,
        rootOverride: overrides.versions[name],
        rootName: root.name,
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
          "cycle; run `ht layer show <layer>` to inspect the dependency list.",
      );
    }

    const selected: SelectedPlugin[] = [
      {
        name: root.name,
        version: root.version,
        layerId: root.id,
        depth: 0,
        declarationIndex: 0,
        constraints: [],
        reason: "root",
        path: [rootLabel],
      },
    ];

    for (const [name, version] of current) {
      const layer = getLayerByName(name, version);
      if (!layer) {
        throw new Error(`Layer not found: ${label(name, version)}`);
      }
      selected.push({
        name,
        version,
        layerId: layer.id,
        depth: depths.get(name) ?? 1,
        declarationIndex: declarationIndexes.get(name) ?? Number.MAX_SAFE_INTEGER,
        constraints: constraints.get(name) ?? [],
        reason: reasons.get(name) ?? "mediation",
        path: shortestPaths.get(name) ?? [rootLabel],
      });
    }

    selected.sort(
      (a, b) => a.depth - b.depth || a.declarationIndex - b.declarationIndex,
    );

    return { selected, rootLabel };
  }

  throw new Error("Dependency resolution did not converge");
}
