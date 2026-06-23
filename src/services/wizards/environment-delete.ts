import { listEnvironmentsCommand } from "../environment-commands.js";
import {
  filterEnvironmentsBySearch,
  type EnvironmentListRow,
} from "../../ui/environment-list-render.js";
import { createEnvironmentTableBrowserAdapter } from "./adapters/environment-table-browser.js";
import { createTableBrowserPrompt } from "./prompts/create-table-browser-prompt.js";
import { promptForValue } from "./shared.js";

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

export async function runEnvironmentDeleteWizard(
  input?: {
    search?: string;
  },
  context?: PromptContext,
): Promise<string[]> {
  const environments = listEnvironmentsCommand();
  const filtered = input?.search
    ? filterEnvironmentsBySearch(environments, input.search)
    : environments;

  if (filtered.length > 0) {
    const result = await createTableBrowserPrompt<EnvironmentListRow, string>({
      message: "Which environment do you want to delete?",
      initialQuery: input?.search,
      intent: { kind: "pick-one", action: "delete" },
      adapter: {
        ...createEnvironmentTableBrowserAdapter({ environments: filtered }),
        onPick: (row) => row.environment.name,
        helpActions: [
          ["↑↓", "select"],
          ["type", "search"],
          ["⏎", "delete"],
          ["esc", "cancel"],
        ],
      },
    }, context);

    if (result.kind === "pick-one") {
      return [result.value];
    }

    return [];
  }

  const selector = await promptForValue({
    message: "Environment name or ID to delete",
    default: input?.search,
  });
  return selector.length > 0 ? [selector] : [];
}
