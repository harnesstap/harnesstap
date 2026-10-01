export function syncHarnessesTooltip(mainName: string): string {
  return `Merge across configured harnesses. ${mainName} wins conflicts.`;
}

export function syncHarnessesConfirmBody(mainName: string): string {
  return (
    `Merges plugins, MCP, skills, and other resources across your configured harnesses. ` +
    `Prefers shared paths. ` +
    `Cursor and Claude plugin skills also land in .agents for tools that do not load those plugins. ` +
    `${mainName} wins when the same resource differs.`
  );
}

export function syncHarnessesDisabledReason(input: {
  configuredCount: number;
  hasMain: boolean;
  running: boolean;
}): string | null {
  if (input.running) return null;
  if (!input.hasMain) return "Set a main harness first";
  if (input.configuredCount === 1) return "Add another harness to sync";
  return null;
}

export interface HarnessSyncChangeKinds {
  readonly added: number;
  readonly removed: number;
  readonly modified: number;
}

export function formatHarnessSyncChangeSummary(
  counts: HarnessSyncChangeKinds,
): string {
  const parts: string[] = [];
  if (counts.added > 0) parts.push(`${counts.added} added`);
  if (counts.removed > 0) parts.push(`${counts.removed} removed`);
  if (counts.modified > 0) parts.push(`${counts.modified} modified`);
  return parts.length > 0 ? parts.join(", ") : "no resource changes";
}

export const HARNESS_SYNC_PREVIEW_ERROR = "Could not count resource changes.";

export interface HarnessSyncPreviewRow extends HarnessSyncChangeKinds {
  readonly id: string;
  readonly name: string;
}

export type HarnessSyncPreviewState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly rows: readonly HarnessSyncPreviewRow[] }
  | { readonly kind: "error"; readonly message: string };
