import { createRemoteCatalogListPrompt } from "./prompts/create-remote-catalog-list-prompt.js";
import type {
  RemoteCatalogListApplyResult,
  RemoteCatalogListPromptContext,
  RemoteCatalogListSelection,
} from "./prompts/types.js";

export type InteractiveCatalogSearchSelection = RemoteCatalogListSelection;

export type InteractiveCatalogSearchResult = RemoteCatalogListApplyResult;

type PromptConfig = {
  message: string;
  scopeLabel: string;
  initialQuery?: string;
  listLayers: (input: { q: string; limit: number }) => Promise<
    import("../catalog-types.js").CatalogLayer[]
  >;
};

export const promptForInteractiveCatalogSearch: (
  config: PromptConfig,
  context?: RemoteCatalogListPromptContext,
) => Promise<InteractiveCatalogSearchResult> = (config, context) =>
  createRemoteCatalogListPrompt(
    { ...config, mode: { kind: "apply" } },
    context,
  ) as Promise<InteractiveCatalogSearchResult>;

export async function runInteractiveCatalogSearch(input: {
  message: string;
  scopeLabel: string;
  initialQuery?: string;
  listLayers: PromptConfig["listLayers"];
}): Promise<InteractiveCatalogSearchResult> {
  return promptForInteractiveCatalogSearch(input);
}
