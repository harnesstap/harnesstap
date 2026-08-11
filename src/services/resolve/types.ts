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
      sourceKind?: string;
    }
  | {
      id: "override-version";
      label: string;
      pluginName: string;
      versions: string[];
      rootName: string;
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
  sourceKind?: string;
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
    const actions: RecoveryAction[] = [
      {
        id: "sync-install",
        label:
          sourceKind === "catalog"
            ? `Pull ${pluginName} from catalog`
            : sourceKind === "marketplace"
              ? `Sync marketplace plugins (install ${pluginName})`
              : `Install or create ${pluginName}`,
        pluginName,
        ...(sourceKind ? { sourceKind } : {}),
      },
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
      `  fix: ${actions[0].label}, then re-apply`,
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

function hintForAction(action: RecoveryAction): string {
  switch (action.id) {
    case "sync-install":
      if (action.sourceKind === "catalog") {
        return `ht plugin pull ${action.pluginName}`;
      }
      if (action.sourceKind === "marketplace") {
        return `ht plugin apply <root> --sync-plugins`;
      }
      return `ht plugin create ${action.pluginName}`;
    case "override-version":
      return `ht plugin edit ${action.rootName} --override plugin:${action.pluginName}@<version>`;
    case "detach-dependency":
      return `ht plugin edit ${action.rootName} --remove plugin:${action.pluginName}`;
    case "clear-override":
      return `ht plugin edit ${action.rootName} --clear-override plugin:${action.pluginName}`;
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
    sourceKind?: string;
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

  constructor(input: { key: string; sides: ResourceSide[]; rootName: string }) {
    const lines = [
      `conflicting ${input.key} at the same depth`,
      ...input.sides.map(
        (side) => `  ${side.pluginName}@${side.pluginVersion} (depth ${side.depth})`,
      ),
    ];
    super(lines.join("\n"));
    this.name = "SingletonConflictError";
    this.key = input.key;
    this.sides = input.sides;
    this.hints = input.sides.map(
      (side) =>
        `ht plugin edit ${input.rootName} --override ${input.key}=${side.pluginName}`,
    );
  }
}
