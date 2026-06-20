import { createLocalMultiSelectPrompt } from "./prompts/create-local-multi-select-prompt.js";
import type { LocalMultiSelectChoice } from "./prompts/create-local-multi-select-prompt.js";
import { PromptBackError } from "./shared.js";

const PROMPT_BACK_SENTINEL = "__harnessdeck_prompt_back__";

type SearchableChoice<T extends string> = LocalMultiSelectChoice<T>;

type PromptConfig<T extends string> = {
  message: string;
  choices: SearchableChoice<T>[];
  default?: T[];
  initialQuery?: string;
  pageSize?: number;
  loop?: boolean;
};

type PromptContext = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  clearPromptOnDone?: boolean;
  signal?: AbortSignal;
};

export async function promptForSearchableMultiSelect(
  config: PromptConfig<string>,
  context?: PromptContext,
): Promise<string[]> {
  const result = await createLocalMultiSelectPrompt(
    { ...config, escapeSentinel: PROMPT_BACK_SENTINEL },
    context,
  );
  if (result.length === 1 && result[0] === PROMPT_BACK_SENTINEL) {
    throw new PromptBackError();
  }
  return result;
}
