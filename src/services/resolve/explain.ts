import { ui } from "../../ui/index.js";
import type {
  ResolutionResult,
  ResourceDecisionReason,
  SelectionReason,
} from "./types.js";

const SELECTION_LABEL: Record<SelectionReason, string> = {
  root: "root",
  "root-override": "root override",
  "root-constraint": "root constraint",
  mediation: "mediation",
  locked: "lockfile",
};

const DECISION_LABEL: Record<ResourceDecisionReason, string> = {
  "only-candidate": "only candidate",
  "nearest-to-root": "nearest to root",
  "identical-content": "identical content",
  "declaration-order": "declared last",
  "root-override": "root override",
};

export interface ExplainPayload {
  root: { name: string; version: string; ephemeral: boolean };
  selected: Array<{
    name: string;
    version: string;
    depth: number;
    reason: SelectionReason;
    path: string[];
    constraints: Array<{ requirer: string; constraint: string }>;
  }>;
  resources: Array<{
    key: string;
    winner: string;
    losers: string[];
    reason: ResourceDecisionReason;
  }>;
  warnings: string[];
}

function side(input: { layerName: string; layerVersion: string }): string {
  return `${input.layerName}@${input.layerVersion}`;
}

export function explainPayload(result: ResolutionResult): ExplainPayload {
  return {
    root: {
      name: result.root.name,
      version: result.root.version,
      ephemeral: result.root.ephemeral,
    },
    selected: result.selected
      .filter((plugin) => plugin.depth > 0)
      .map((plugin) => ({
        name: plugin.name,
        version: plugin.version,
        depth: plugin.depth,
        reason: plugin.reason,
        path: plugin.path,
        constraints: plugin.constraints.map((record) => ({
          requirer: record.requirer,
          constraint: record.constraint,
        })),
      })),
    resources: result.decisions.map((decision) => ({
      key: decision.key,
      winner: side(decision.winner),
      losers: decision.losers.map(side),
      reason: decision.reason,
    })),
    warnings: result.warnings,
  };
}

export function renderExplain(result: ResolutionResult): string {
  const lines: string[] = [];

  lines.push(ui.theme.muted("Versions"));
  const dependencies = result.selected.filter((plugin) => plugin.depth > 0);
  if (dependencies.length === 0) {
    lines.push(ui.theme.muted("  (no dependencies)"));
  }
  for (const plugin of dependencies) {
    lines.push(
      `  ${plugin.name}@${plugin.version}  ${ui.theme.muted(
        `depth ${plugin.depth} · ${SELECTION_LABEL[plugin.reason]}`,
      )}`,
    );
    for (const record of plugin.constraints) {
      lines.push(
        ui.theme.muted(
          `    ${record.requirer} → ${plugin.name} ${record.constraint || "*"}`,
        ),
      );
    }
  }

  lines.push("");
  lines.push(ui.theme.muted("Resources"));
  const contested = result.decisions.filter((decision) => decision.losers.length > 0);
  if (contested.length === 0) {
    lines.push(ui.theme.muted("  (no contested resources)"));
  }
  for (const decision of contested) {
    lines.push(
      `  ${decision.key}  ${ui.theme.muted(
        `${side(decision.winner)} wins over ${decision.losers
          .map(side)
          .join(", ")} · ${DECISION_LABEL[decision.reason]}`,
      )}`,
    );
  }

  return lines.join("\n");
}
