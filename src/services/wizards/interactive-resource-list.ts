import type { ResourceType } from "../../types.js";
import { createResourceTableBrowserAdapter } from "./adapters/resource-table-browser.js";
import {
  createTableBrowserPrompt,
} from "./prompts/create-table-browser-prompt.js";
import type { ResourceListRow } from "../../ui/resource-list-render.js";
import {
  mapFilterTableBrowserResult,
  type ListHubResult,
} from "./list-browser-hub.js";

export type InteractiveResourceListResult = ListHubResult;

type PromptConfig = {
  message: string;
  resources: ResourceListRow[];
  typeFilter?: ResourceType;
  showId?: boolean;
  showAll?: boolean;
  initialQuery?: string;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

export const promptForInteractiveResourceList: (
  config: PromptConfig,
  context?: PromptContext,
) => Promise<InteractiveResourceListResult> = async (config, context) => {
  const result = await createTableBrowserPrompt<ResourceListRow, string>(
    {
      message: config.message,
      initialQuery: config.initialQuery,
      intent: { kind: "filter" },
      adapter: createResourceTableBrowserAdapter({
        resources: config.resources,
        typeFilter: config.typeFilter,
        showId: config.showId,
        showAll: config.showAll,
      }),
    },
    context,
  );

  return mapFilterTableBrowserResult(result);
};
