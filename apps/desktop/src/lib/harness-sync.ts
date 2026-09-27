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

export function formatHarnessSyncChangeCount(count: number): string {
  return count === 1 ? "1 change" : `${count} changes`;
}

export const HARNESS_SYNC_PREVIEW_ERROR = "Could not count changes.";

export interface HarnessSyncPreviewRow {
  readonly id: string;
  readonly name: string;
  readonly changes: number;
}

export type HarnessSyncPreviewState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly rows: readonly HarnessSyncPreviewRow[] }
  | { readonly kind: "error"; readonly message: string };
