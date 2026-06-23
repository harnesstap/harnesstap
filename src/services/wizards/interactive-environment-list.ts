import { createEnvironmentTableBrowserAdapter } from "./adapters/environment-table-browser.js";
import {
  createTableBrowserPrompt,
} from "./prompts/create-table-browser-prompt.js";
import type { EnvironmentListRow } from "../../ui/environment-list-render.js";
import {
  mapFilterTableBrowserResult,
  type ListHubResult,
} from "./list-browser-hub.js";

export type InteractiveEnvironmentListResult = ListHubResult;

type PromptConfig = {
  message: string;
  environments: EnvironmentListRow[];
  initialQuery?: string;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

export const promptForInteractiveEnvironmentList: (
  config: PromptConfig,
  context?: PromptContext,
) => Promise<InteractiveEnvironmentListResult> = async (config, context) => {
  const result = await createTableBrowserPrompt<EnvironmentListRow, string>(
    {
      message: config.message,
      initialQuery: config.initialQuery,
      intent: { kind: "filter" },
      adapter: createEnvironmentTableBrowserAdapter({
        environments: config.environments,
      }),
    },
    context,
  );

  return mapFilterTableBrowserResult(result);
};
