import { describe, expect, it } from "bun:test";
import { PROMPT_TEST_TIMEOUT_MS } from "./prompt-test.ts";

describe("prompt test helpers", () => {
  it("defines a default prompt timeout for interactive tests", () => {
    expect(PROMPT_TEST_TIMEOUT_MS).toBe(10_000);
  });
});
