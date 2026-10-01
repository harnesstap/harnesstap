export function syncHarnessesTooltip(): string {
  return "Merge across registered harnesses. Newest on-disk copy wins conflicts.";
}

export function syncHarnessesConfirmBody(): string {
  return (
    `Merges plugins, MCP, skills, and other resources across your registered harnesses. ` +
    `Prefers shared paths. ` +
    `Cursor and Claude plugin skills also land in .agents for tools that do not load those plugins. ` +
    `Newest on-disk copy wins when the same resource differs.`
  );
}

export function syncHarnessesDisabledReason(input: {
  configuredCount: number;
  running: boolean;
}): string | null {
  if (input.running) return null;
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
