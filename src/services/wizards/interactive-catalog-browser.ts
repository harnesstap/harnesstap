import { createRemoteCatalogListPrompt } from "./prompts/create-remote-catalog-list-prompt.js";
import type {
  RemoteCatalogListInstallResult,
  RemoteCatalogListPromptContext,
} from "./prompts/types.js";

export type InteractiveCatalogBrowserResult = RemoteCatalogListInstallResult;

type PromptConfig = {
  message: string;
  scopeLabel: string;
  listPlugins: (input: { q: string; limit: number }) => Promise<
    import("../catalog-types.js").CatalogPlugin[]
  >;
};

export const promptForInteractiveCatalogBrowser: (
  config: PromptConfig,
  context?: RemoteCatalogListPromptContext,
) => Promise<InteractiveCatalogBrowserResult> = (config, context) =>
  createRemoteCatalogListPrompt(
    { ...config, mode: { kind: "install" } },
    context,
  ) as Promise<InteractiveCatalogBrowserResult>;

export async function runInteractiveCatalogBrowser(input: {
  message: string;
  scopeLabel: string;
  listPlugins: PromptConfig["listPlugins"];
}): Promise<InteractiveCatalogBrowserResult> {
  return promptForInteractiveCatalogBrowser(input);
}
