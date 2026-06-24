import type { render } from "@inquirer/testing";

/** Default per-test timeout for interactive prompt tests. */
export const PROMPT_TEST_TIMEOUT_MS = 10_000;

const PROMPT_DISMISS_TIMEOUT_MS = 2_000;

type RenderResult = Awaited<ReturnType<typeof render>>;

type PromptIt = typeof import("bun:test").it;

export const promptIt: PromptIt = (name, fn, timeout) =>
  it(name, fn, timeout ?? PROMPT_TEST_TIMEOUT_MS);

export async function dismissPrompt(
  result: Pick<RenderResult, "answer" | "events">,
): Promise<void> {
  result.events.keypress("escape");
  await Promise.race([
    result.answer.then(() => undefined).catch(() => undefined),
    new Promise<void>((resolve) => {
      setTimeout(resolve, PROMPT_DISMISS_TIMEOUT_MS);
    }),
  ]);
}

export async function withPrompt<T>(
  renderPromise: Promise<RenderResult>,
  run: (result: RenderResult) => Promise<T> | T,
): Promise<T> {
  const result = await renderPromise;
  try {
    return await run(result);
  } finally {
    await dismissPrompt(result);
  }
}
