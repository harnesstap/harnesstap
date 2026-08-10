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

export class UnsatisfiableConstraintError extends Error {
  readonly pluginName: string;
  readonly requirers: ConstraintRecord[];
  readonly available: string[];
  readonly hints: string[];

  constructor(input: {
    pluginName: string;
    requirers: ConstraintRecord[];
    available: string[];
    rootName: string;
    /** When set, empty local inventory can point at source-specific install/sync fixes. */
    sourceKind?: string;
  }) {
    const lines = [`cannot satisfy plugin ${input.pluginName}`];
    for (const record of input.requirers) {
      lines.push(
        `  ${record.requirer} → ${input.pluginName} ${record.constraint || "*"}`,
      );
    }
    super(lines.join("\n"));
    this.name = "UnsatisfiableConstraintError";
    this.pluginName = input.pluginName;
    this.requirers = input.requirers;
    this.available = input.available;

    const inventoryHint =
      input.available.length > 0
        ? `Available locally: ${input.available.join(", ")}`
        : `No local versions of ${input.pluginName} found`;

    if (input.available.length === 0 && input.sourceKind === "marketplace") {
      this.hints = [`ht plugin apply <root> --sync-plugins`, inventoryHint];
    } else if (input.available.length === 0 && input.sourceKind === "catalog") {
      this.hints = [`ht plugin pull ${input.pluginName}`, inventoryHint];
    } else {
      this.hints = [
        `ht plugin edit ${input.rootName} --override plugin:${input.pluginName}@<version>`,
        inventoryHint,
      ];
    }
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
