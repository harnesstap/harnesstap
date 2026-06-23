import { createTableBrowserPrompt } from "./create-table-browser-prompt.js";
import type { ManageAction } from "./table-browser-types.js";

export type ActionListPromptAction =
  | { type: "quit" }
  | { type: "cancel" }
  | { type: "edit"; rowIndex: number }
  | { type: "add" }
  | { type: "delete"; rowIndex: number };

export type ActionListPromptConfig<T> = {
  message: string;
  rows: T[];
  initialQuery?: string;
  filterRows: (rows: T[], query: string) => T[];
  renderBrowse: (args: {
    prefix: string;
    styledMessage: string;
    query: string;
    filteredRows: T[];
    activeRow: T | undefined;
    active: number;
    terminalWidth: number;
    terminalRows: number;
  }) => string;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

function mapManageAction(action: ManageAction): ActionListPromptAction {
  switch (action.type) {
    case "quit":
    case "cancel":
    case "add":
      return action;
    case "edit":
    case "delete":
      return action;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function createActionListPrompt<T>(
  config: ActionListPromptConfig<T>,
  context?: PromptContext,
): Promise<ActionListPromptAction> & { cancel: () => void } {
  const prompt = createTableBrowserPrompt<T, never>(
    {
      message: config.message,
      initialQuery: config.initialQuery,
      intent: { kind: "manage" },
      manageSourceRows: config.rows,
      adapter: {
        resolveItems: (query) => {
          const filtered = config.filterRows(config.rows, query);
          return { filtered, navigable: filtered };
        },
        renderViewport: (args) =>
          config.renderBrowse({
            prefix: args.prefix,
            styledMessage: args.styledMessage,
            query: args.query,
            filteredRows: args.navigable,
            activeRow: args.selectedItem,
            active: args.active,
            terminalWidth: args.terminalWidth,
            terminalRows: args.terminalRows,
          }),
        helpActions: [],
      },
    },
    context,
  );

  const mapped = prompt.then((result) => {
    if (result.kind === "manage") {
      return mapManageAction(result.action);
    }
    throw new Error(`Unexpected table browser result: ${result.kind}`);
  }) as Promise<ActionListPromptAction> & { cancel: () => void };
  mapped.cancel = prompt.cancel;
  return mapped;
}
