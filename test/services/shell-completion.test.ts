import { describe, expect, it } from "bun:test";
import type { Command } from "commander";
import { renderShellCompletion } from "../../src/services/shell-completion.ts";

describe("renderShellCompletion", () => {
  it("zsh script parses tab-separated descriptions with compadd -d", () => {
    const script = renderShellCompletion("zsh", {} as Command);

    expect(script).toContain("compadd -d descr -a args");
    expect(script).toContain("*$'\\t'*");
  });
});
