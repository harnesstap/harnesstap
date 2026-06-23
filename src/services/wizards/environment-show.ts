import { listEnvironmentsCommand } from "../environment-commands.js";
import {
  filterEnvironmentsBySearch,
  type EnvironmentListRow,
} from "../../ui/environment-list-render.js";
import { createEnvironmentTableBrowserAdapter } from "./adapters/environment-table-browser.js";
import { createTableBrowserPrompt } from "./prompts/create-table-browser-prompt.js";

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

export async function runEnvironmentShowWizard(
  input?: {
    search?: string;
  },
  context?: PromptContext,
): Promise<string | undefined> {
  const environments = listEnvironmentsCommand();
  const filtered = input?.search
    ? filterEnvironmentsBySearch(environments, input.search)
    : environments;
  if (filtered.length === 0) {
    return undefined;
  }

  const result = await createTableBrowserPrompt<EnvironmentListRow, string>({
    message: "Which environment do you want to show?",
    initialQuery: input?.search,
    intent: { kind: "pick-one", action: "show" },
    adapter: {
      ...createEnvironmentTableBrowserAdapter({ environments: filtered }),
      onPick: (row) => row.environment.name,
      helpActions: [
        ["↑↓", "select"],
        ["type", "search"],
        ["⏎", "show"],
        ["esc", "cancel"],
      ],
    },
  }, context);

  if (result.kind === "pick-one") {
    return result.value;
  }

  return undefined;
}
