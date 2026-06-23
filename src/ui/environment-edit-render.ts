import type { EnvironmentEditRow } from "../services/environment-edit.js";
import {
  computeMaxVisibleRows,
  resolveSectionViewport,
  VIEWPORT_CHROME_LINES,
  type SectionViewport,
} from "./list-viewport.js";
import { styleResourceType, theme } from "./theme.js";

export const ENVIRONMENT_EDIT_KINDS: EnvironmentEditRow["kind"][] = [
  "env_var",
  "secret_ref",
  "model_config",
  "permission",
];

export const ENVIRONMENT_EDIT_KIND_LABELS: Record<EnvironmentEditRow["kind"], string> = {
  env_var: "ENV VARS",
  secret_ref: "SECRET REFS",
  model_config: "MODEL CONFIGS",
  permission: "PERMISSIONS",
};

export function formatEnvironmentEditRowLabel(row: EnvironmentEditRow): string {
  switch (row.kind) {
    case "env_var":
      return `${row.key}=${row.value}`;
    case "secret_ref":
      return `${row.key} (${row.provider}:${row.ref})`;
    case "model_config":
      return row.provider
        ? `${row.name}: ${row.model} @ ${row.provider}`
        : `${row.name}: ${row.model}`;
    case "permission":
      return `${row.name}: ${row.action}:${row.pattern}`;
    default: {
      const neverRow: never = row;
      throw new Error(`Unsupported row kind: ${String(neverRow)}`);
    }
  }
}

export function listNavigableEnvironmentEditRows(
  rows: EnvironmentEditRow[],
): EnvironmentEditRow[] {
  const ordered: EnvironmentEditRow[] = [];
  for (const kind of ENVIRONMENT_EDIT_KINDS) {
    ordered.push(...rows.filter((row) => row.kind === kind));
  }
  return ordered;
}

export type EnvironmentEditActiveSectionContext = {
  kind: EnvironmentEditRow["kind"];
  indexInSection: number;
  sectionRows: EnvironmentEditRow[];
  prevSection?: { kind: EnvironmentEditRow["kind"]; count: number };
  nextSection?: { kind: EnvironmentEditRow["kind"]; count: number };
};

function sectionCount(
  navigable: EnvironmentEditRow[],
  kind: EnvironmentEditRow["kind"],
): number {
  return navigable.filter((row) => row.kind === kind).length;
}

export function resolveEnvironmentActiveSectionContext(
  navigable: EnvironmentEditRow[],
  active: number,
): EnvironmentEditActiveSectionContext {
  const selected = navigable[active];
  if (!selected) {
    return { kind: "env_var", indexInSection: 0, sectionRows: [] };
  }

  const kind = selected.kind;
  const sectionRows = navigable.filter((row) => row.kind === kind);
  const indexInSection = sectionRows.indexOf(selected);

  const kindIndex = ENVIRONMENT_EDIT_KINDS.indexOf(kind);
  const prevSection = ENVIRONMENT_EDIT_KINDS.slice(0, kindIndex)
    .reverse()
    .map((sectionKind) => ({
      kind: sectionKind,
      count: sectionCount(navigable, sectionKind),
    }))
    .find((section) => section.count > 0);
  const nextSection = ENVIRONMENT_EDIT_KINDS.slice(kindIndex + 1)
    .map((sectionKind) => ({
      kind: sectionKind,
      count: sectionCount(navigable, sectionKind),
    }))
    .find((section) => section.count > 0);

  return { kind, indexInSection, sectionRows, prevSection, nextSection };
}

function renderEnvironmentViewportOverflowHints(
  ctx: EnvironmentEditActiveSectionContext,
  viewport: SectionViewport,
): string[] {
  const hints: string[] = [];
  const hiddenBelow = ctx.sectionRows.length - viewport.end;
  const hiddenAbove = viewport.start;
  if (hiddenAbove > 0) {
    hints.push(theme.muted(`  ↑ ${hiddenAbove} above`));
  }
  if (hiddenBelow > 0) {
    hints.push(theme.muted(`  ↓ ${hiddenBelow} more in ${ENVIRONMENT_EDIT_KIND_LABELS[ctx.kind]}`));
  }
  if (ctx.nextSection) {
    hints.push(
      theme.muted(
        `  ${ENVIRONMENT_EDIT_KIND_LABELS[ctx.nextSection.kind]} (${ctx.nextSection.count}) · ↓ next section`,
      ),
    );
  }
  if (viewport.start === 0 && ctx.prevSection) {
    hints.push(
      theme.muted(
        `  ${ENVIRONMENT_EDIT_KIND_LABELS[ctx.prevSection.kind]} (${ctx.prevSection.count}) · ↑ prev section`,
      ),
    );
  }
  return hints;
}

export type EnvironmentEditViewportOptions = {
  activeIndex: number;
  navigable: EnvironmentEditRow[];
  terminalRows: number;
};

export function renderGroupedEnvironmentEditViewport(
  rows: EnvironmentEditRow[],
  opts: EnvironmentEditViewportOptions,
): string {
  if (rows.length === 0) {
    return theme.muted("No matching rows.");
  }

  const ctx = resolveEnvironmentActiveSectionContext(opts.navigable, opts.activeIndex);
  if (ctx.sectionRows.length === 0) {
    return theme.muted("No matching rows.");
  }

  const maxVisibleRows = computeMaxVisibleRows(
    opts.terminalRows,
    VIEWPORT_CHROME_LINES.environmentEdit,
    3,
  );
  const viewport = resolveSectionViewport(
    ctx.sectionRows.length,
    ctx.indexInSection,
    maxVisibleRows,
  );
  const visibleRows = ctx.sectionRows.slice(viewport.start, viewport.end);
  const activeRow = opts.navigable[opts.activeIndex];

  const body = [
    styleResourceType(ctx.kind),
    ENVIRONMENT_EDIT_KIND_LABELS[ctx.kind],
    ...visibleRows.map((row) => {
      const marker = row === activeRow ? theme.accent(">") : " ";
      return `${marker} ${formatEnvironmentEditRowLabel(row)}`;
    }),
    ...renderEnvironmentViewportOverflowHints(ctx, viewport),
  ];

  return body.join("\n");
}

export function renderGroupedEnvironmentEditTable(
  rows: EnvironmentEditRow[],
  activeRow: EnvironmentEditRow | undefined,
): string {
  if (rows.length === 0) {
    return theme.muted("No matching rows.");
  }

  const lines: string[] = [];

  for (const kind of ENVIRONMENT_EDIT_KINDS) {
    const groupRows = rows.filter((row) => row.kind === kind);
    if (groupRows.length === 0) {
      continue;
    }

    lines.push(styleResourceType(kind));
    lines.push(ENVIRONMENT_EDIT_KIND_LABELS[kind]);

    for (const row of groupRows) {
      const marker = row === activeRow ? theme.accent(">") : " ";
      lines.push(`${marker} ${formatEnvironmentEditRowLabel(row)}`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
