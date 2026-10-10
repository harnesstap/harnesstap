import type { DependencySourceKind, Resource } from "../../types.js";

/** One version constraint on a plugin name, with the path that introduced it. */
export interface ConstraintRecord {
  /** Raw constraint as declared, e.g. `^2.0.0`. Empty or `*` means any. */
  constraint: string;
  /**
   * Labels from the root down to and including the requirer.
   * A constraint declared by the root itself has `path.length === 1`.
   */
  path: string[];
  /** Label of the plugin that declared this constraint, e.g. `team-standards@2.1.0`. */
  requirer: string;
}

export type SelectionReason =
  | "root"
  | "root-override"
  | "root-constraint"
  | "mediation"
  | "locked";

/** One plugin name after Pass 1, unified to exactly one version. */
export interface SelectedPlugin {
  name: string;
  version: string;
  pluginId: string;
  /** Root is 0; a direct dependency of the root is 1. */
  depth: number;
  /** Global first-encounter order during the BFS walk. Ties break on this. */
  declarationIndex: number;
  constraints: ConstraintRecord[];
  reason: SelectionReason;
  /** Shortest path from the root to this plugin. */
  path: string[];
  /** Provenance from the first-seen dependency edge; root is always `local`. */
  source: DependencySourceKind;
}

export type ResourceDecisionReason =
  | "only-candidate"
  | "nearest-to-root"
  | "identical-content"
  | "declaration-order"
  | "root-override";

export interface ResourceSide {
  pluginName: string;
  pluginVersion: string;
  depth: number;
  resourceId?: string;
  source?: string;
  namespace?: string;
  fingerprint?: string;
  preview?: string;
}

/** One `type:name` outcome from Pass 2. */
export interface ResourceDecision {
  key: string;
  winner: ResourceSide;
  losers: ResourceSide[];
  reason: ResourceDecisionReason;
}

export interface ResolutionRoot {
  name: string;
  version: string;
  pluginId: string;
  /** True when the root was synthesized from multiple apply arguments. */
  ephemeral: boolean;
}

export interface ResolutionResult {
  root: ResolutionRoot;
  /** Root first (depth 0), then dependencies ordered by depth, then declaration. */
  selected: SelectedPlugin[];
  /** Winning material resources, deduplicated by resolution key. */
  resources: Resource[];
  decisions: ResourceDecision[];
  warnings: string[];
}

export type UnsatisfiableReason =
  | "missing-inventory"
  | "constraint-conflict"
  | "override-missing";

export type RecoveryAction =
  | {
      id: "sync-install";
      label: string;
      pluginName: string;
      sourceKind?: DependencySourceKind;
    }
  | {
      id: "create-plugin";
      label: string;
      pluginName: string;
    }
  | {
      id: "override-version";
      label: string;
      pluginName: string;
      versions: string[];
      rootName: string;
    }
  | {
      id: "override-resource";
      label: string;
      rootName: string;
      key: string;
      winnerPluginName: string;
      winnerResourceId?: string;
      source?: string;
      namespace?: string;
      fingerprint?: string;
      preview?: string;
    }
  | {
      id: "detach-dependency";
      label: string;
      rootName: string;
      pluginName: string;
    }
  | {
      id: "clear-override";
      label: string;
      rootName: string;
      pluginName: string;
    }
  | {
      id: "tag-as-profile";
      label: string;
      pluginName: string;
    };

function requirerLines(
  pluginName: string,
  requirers: ConstraintRecord[],
): string[] {
  return requirers.map(
    (record) =>
      `  ${record.requirer} → ${pluginName} ${record.constraint || "*"}`,
  );
}

function buildUnsatisfiable(input: {
  pluginName: string;
  requirers: ConstraintRecord[];
  available: string[];
  rootName: string;
  sourceKind?: DependencySourceKind;
  rootOverride?: string;
}): {
  reason: UnsatisfiableReason;
  message: string;
  actions: RecoveryAction[];
  hints: string[];
} {
  const { pluginName, requirers, available, rootName, sourceKind } = input;

  if (input.rootOverride && !available.includes(input.rootOverride)) {
    const actions: RecoveryAction[] = [];
    if (available.length > 0) {
      actions.push({
        id: "override-version",
        label: `Pick an installed version of ${pluginName}`,
        pluginName,
        versions: available,
        rootName,
      });
    } else if (sourceKind === "marketplace" || sourceKind === "catalog") {
      actions.push({
        id: "sync-install",
        label:
          sourceKind === "marketplace"
            ? `Sync marketplace plugins (install ${pluginName})`
            : `Pull ${pluginName} from catalog`,
        pluginName,
        sourceKind,
      });
    }
    actions.push({
      id: "clear-override",
      label: `Clear override for ${pluginName}`,
      rootName,
      pluginName,
    });
    const message = [
      `Override requests ${pluginName}@${input.rootOverride}, but that version is not installed.`,
      available.length > 0
        ? `  available: ${available.join(", ")}`
        : `  available: (none)`,
      `  fix: ${actions[0]?.label ?? "clear the override"}`,
    ].join("\n");
    return {
      reason: "override-missing",
      message,
      actions,
      hints: actions.map((action) => hintForAction(action)),
    };
  }

  if (available.length === 0) {
    const installAction: RecoveryAction =
      sourceKind === "catalog" || sourceKind === "marketplace"
        ? {
            id: "sync-install",
            label:
              sourceKind === "catalog"
                ? `Pull ${pluginName} from catalog`
                : `Sync marketplace plugins (install ${pluginName})`,
            pluginName,
            sourceKind,
          }
        : {
            id: "create-plugin",
            label: `Create ${pluginName}`,
            pluginName,
          };
    const actions: RecoveryAction[] = [
      installAction,
      {
        id: "detach-dependency",
        label: `Detach ${pluginName} from ${rootName}`,
        rootName,
        pluginName,
      },
    ];
    const requiredBy = requirers.map(
      (record) =>
        `  required by: ${record.requirer} → ${pluginName} ${record.constraint || "*"}`,
    );
    const message = [
      `No local version of ${pluginName} is installed.`,
      ...requiredBy,
      `  fix: ${installAction.label}, then re-apply`,
    ].join("\n");
    return {
      reason: "missing-inventory",
      message,
      actions,
      hints: actions.map((action) => hintForAction(action)),
    };
  }

  const actions: RecoveryAction[] = [
    {
      id: "override-version",
      label: `Override ${pluginName} to an available version`,
      pluginName,
      versions: available,
      rootName,
    },
    {
      id: "detach-dependency",
      label: `Detach ${pluginName} from ${rootName}`,
      rootName,
      pluginName,
    },
  ];
  const message = [
    `No installed version of ${pluginName} satisfies the required constraints.`,
    ...requirerLines(pluginName, requirers),
    `  available: ${available.join(", ")}`,
    `  fix: override ${pluginName} to an available version, or detach a conflicting dependency`,
  ].join("\n");
  return {
    reason: "constraint-conflict",
    message,
    actions,
    hints: actions.map((action) => hintForAction(action)),
  };
}

export const CONFLICT_PREVIEW_LINES = 12;

export function previewConflictContent(content: string): string {
  const lines = content.split("\n");
  if (lines.length <= CONFLICT_PREVIEW_LINES) {
    return content;
  }
  return [
    ...lines.slice(0, CONFLICT_PREVIEW_LINES),
    `... (${lines.length} lines in content)`,
  ].join("\n");
}

function conflictSideParts(
  side: ResourceSide,
  sides: readonly ResourceSide[],
): string[] {
  const plugin = `${side.pluginName}@${side.pluginVersion}`;
  const samePlugin =
    sides.length > 0
    && sides.every(
      (other) =>
        other.pluginName === side.pluginName
        && other.pluginVersion === side.pluginVersion,
    );
  const sourcesDiffer = new Set(sides.map((entry) => entry.source ?? "")).size > 1;
  const namespacesDiffer =
    new Set(sides.map((entry) => entry.namespace ?? "")).size > 1;
  const parts: string[] = [];
  if (!samePlugin) {
    parts.push(plugin);
  }
  const source = side.source?.trim();
  if (source && (samePlugin || sourcesDiffer)) {
    parts.push(source);
  }
  if (namespacesDiffer && side.namespace?.trim()) {
    parts.push(`@${side.namespace}`);
  }
  if (side.fingerprint) {
    parts.push(side.fingerprint.slice(0, 7));
  }
  if (parts.length === 0) {
    parts.push(plugin);
  }
  return parts;
}

/** Unique human label for one singleton-conflict copy. */
export function describeConflictSide(
  side: ResourceSide,
  sides: readonly ResourceSide[],
): string {
  const base = conflictSideParts(side, sides).join(" · ");
  const collisions = sides.filter(
    (other) => conflictSideParts(other, sides).join(" · ") === base,
  );
  if (collisions.length > 1 && side.resourceId) {
    return `${base} · ${side.resourceId.slice(0, 8)}`;
  }
  return base;
}

/** Plugin name, or resource id when one plugin owns multiple copies. */
export function overrideWinnerValue(
  side: ResourceSide,
  sides: readonly ResourceSide[],
): string {
  const sameName =
    sides.filter((other) => other.pluginName === side.pluginName).length > 1;
  if (sameName && side.resourceId) {
    return side.resourceId;
  }
  return side.pluginName;
}

function hintForAction(action: RecoveryAction): string {
  switch (action.id) {
    case "sync-install":
      if (action.sourceKind === "catalog") {
        return `ht plugin pull ${action.pluginName}`;
      }
      if (action.sourceKind === "marketplace") {
        return `Run ht profile use to install "${action.pluginName}".`;
      }
      return `ht plugin create ${action.pluginName}`;
    case "create-plugin":
      return `ht plugin create ${action.pluginName}`;
    case "override-version":
      return `ht plugin edit ${action.rootName} --override plugin:${action.pluginName}@<version>`;
    case "override-resource":
      return `ht plugin edit ${action.rootName} --override ${action.key}=${action.winnerResourceId ?? action.winnerPluginName}`;
    case "detach-dependency":
      return `ht plugin edit ${action.rootName} --remove plugin:${action.pluginName}`;
    case "clear-override":
      return `ht plugin edit ${action.rootName} --clear-override plugin:${action.pluginName}`;
    case "tag-as-profile":
      return `ht profile tag ${action.pluginName}`;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export class UnsatisfiableConstraintError extends Error {
  readonly pluginName: string;
  readonly requirers: ConstraintRecord[];
  readonly available: string[];
  readonly reason: UnsatisfiableReason;
  readonly actions: RecoveryAction[];
  readonly hints: string[];

  constructor(input: {
    pluginName: string;
    requirers: ConstraintRecord[];
    available: string[];
    rootName: string;
    /** When set, empty local inventory can point at source-specific install/sync fixes. */
    sourceKind?: DependencySourceKind;
    rootOverride?: string;
  }) {
    const built = buildUnsatisfiable(input);
    super(built.message);
    this.name = "UnsatisfiableConstraintError";
    this.pluginName = input.pluginName;
    this.requirers = input.requirers;
    this.available = input.available;
    this.reason = built.reason;
    this.actions = built.actions;
    this.hints = built.hints;
  }
}

export class SingletonConflictError extends Error {
  readonly key: string;
  readonly sides: ResourceSide[];
  readonly hints: string[];
  readonly actions: RecoveryAction[];

  constructor(input: { key: string; sides: ResourceSide[]; rootName: string }) {
    const actions: RecoveryAction[] = input.sides.map((side) => {
      const winnerResourceId =
        overrideWinnerValue(side, input.sides) !== side.pluginName
          ? overrideWinnerValue(side, input.sides)
          : side.resourceId;
      return {
        id: "override-resource",
        label: `Use ${describeConflictSide(side, input.sides)} for ${input.key}`,
        rootName: input.rootName,
        key: input.key,
        winnerPluginName: side.pluginName,
        ...(winnerResourceId ? { winnerResourceId } : {}),
        ...(side.source ? { source: side.source } : {}),
        ...(side.namespace ? { namespace: side.namespace } : {}),
        ...(side.fingerprint ? { fingerprint: side.fingerprint } : {}),
        ...(side.preview ? { preview: side.preview } : {}),
      };
    });
    const lines = [
      `conflicting ${input.key} at the same depth`,
      ...input.sides.map((side) => {
        const detail = describeConflictSide(side, input.sides);
        const plugin = `${side.pluginName}@${side.pluginVersion}`;
        const suffix = detail === plugin ? "" : ` · ${detail}`;
        return `  ${plugin} (depth ${side.depth})${suffix}`;
      }),
      `  fix: ${actions[0]?.label ?? `override ${input.key}`}`,
    ];
    super(lines.join("\n"));
    this.name = "SingletonConflictError";
    this.key = input.key;
    this.sides = input.sides;
    this.actions = actions;
    this.hints = actions.map((action) => hintForAction(action));
  }
}
