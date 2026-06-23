import { describe, expect, it } from "bun:test";
import { readTerminalSize } from "../../src/services/wizards/prompts/hooks/use-terminal-size.ts";

describe("useTerminalSize helpers", () => {
  it("reads terminal dimensions", () => {
    const size = readTerminalSize();
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  });
});
