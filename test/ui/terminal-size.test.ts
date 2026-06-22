import { describe, expect, it } from "bun:test";
import { terminalRows } from "../../src/ui/theme.ts";

describe("terminalRows", () => {
  it("returns a positive default when stdout rows is undefined", () => {
    const original = process.stdout.rows;
    Object.defineProperty(process.stdout, "rows", { value: undefined, configurable: true });
    try {
      expect(terminalRows()).toBeGreaterThanOrEqual(24);
    } finally {
      Object.defineProperty(process.stdout, "rows", { value: original, configurable: true });
    }
  });
});
