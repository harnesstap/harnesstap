import { createTableBrowserPrompt } from "./create-table-browser-prompt.js";
import type { ConstraintRenderArgs } from "./table-browser-types.js";

export type EditableMultiSelectPromptResult<T> = {
  rows: T[];
};

export type EditableMultiSelectRow = {
  id: string;
  checked: boolean;
  version_constraint?: string;
};

export type EditableMultiSelectPromptConfig<T extends EditableMultiSelectRow> = {
  message: string;
  rows: T[];
  initialQuery?: string;
  cancelMessage?: string;
  requiresVersionConstraint: (row: T) => boolean;
  resolveItems: (
    rows: T[],
    query: string,
  ) => {
    filtered: T[];
    navigable: T[];
  };
  renderBrowse: (args: {
    prefix: string;
    styledMessage: string;
    query: string;
    rows: T[];
    filtered: T[];
    navigable: T[];
    activeRow: T | undefined;
    active: number;
    checkedCount: number;
    terminalWidth: number;
    terminalRows: number;
  }) => string;
  renderShow: (row: T) => string;
  renderConstraint: (args: {
    prefix: string;
    styledMessage: string;
    target: T | undefined;
    constraintDraft: string;
    helpLine: string;
  }) => string;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

export function createEditableMultiSelectPrompt<T extends EditableMultiSelectRow>(
  config: EditableMultiSelectPromptConfig<T>,
  context?: PromptContext,
): Promise<EditableMultiSelectPromptResult<T>> & { cancel: () => void } {
  const prompt = createTableBrowserPrompt<T, T>(
    {
      message: config.message,
      initialQuery: config.initialQuery,
      intent: { kind: "pick-many" },
      cancelMessage: config.cancelMessage,
      pickManyItems: config.rows,
      resolvePickManyItems: config.resolveItems,
      requiresVersionConstraint: config.requiresVersionConstraint,
      renderConstraint: config.renderConstraint as
        | ((args: ConstraintRenderArgs<T>) => string)
        | undefined,
      onCommitPickMany: (rows) => rows as T[],
      adapter: {
        resolveItems: () => ({ filtered: [], navigable: [] }),
        renderViewport: (args) =>
          config.renderBrowse({
            prefix: args.prefix,
            styledMessage: args.styledMessage,
            query: args.query,
            rows: (args.items ?? config.rows) as T[],
            filtered: args.filtered as T[],
            navigable: args.navigable as T[],
            activeRow: args.selectedItem,
            active: args.active,
            checkedCount: args.checkedCount ?? 0,
            terminalWidth: args.terminalWidth,
            terminalRows: args.terminalRows,
          }),
        renderShow: config.renderShow,
        getItemKey: (row) => row.id,
        helpActions: [],
      },
    },
    context,
  );

  const mapped = prompt.then((result) => {
    if (result.kind === "pick-many") {
      return { rows: result.values as T[] };
    }
    throw new Error(`Unexpected table browser result: ${result.kind}`);
  }) as Promise<EditableMultiSelectPromptResult<T>> & { cancel: () => void };
  mapped.cancel = prompt.cancel;
  return mapped;
}
