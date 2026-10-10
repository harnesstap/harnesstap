import { describe, expect, it } from "bun:test";
import { resolveApplyConflictPolicy } from "../../src/services/materialization-conflicts.js";

describe("resolveApplyConflictPolicy", () => {
  it("honors explicit on-conflict values", () => {
    expect(resolveApplyConflictPolicy({ onConflict: "skip" })).toBe("skip");
    expect(resolveApplyConflictPolicy({ onConflict: "replace" })).toBe("replace");
    expect(resolveApplyConflictPolicy({ onConflict: "prompt" })).toBe("prompt");
    expect(resolveApplyConflictPolicy({ onConflict: "overwrite" })).toBe("replace");
    expect(resolveApplyConflictPolicy({ onConflict: "ignore" })).toBe("skip");
  });

  it("does not treat abort as an on-conflict alias", () => {
    expect(() =>
      resolveApplyConflictPolicy({ onConflict: "abort", noInteractive: true }),
    ).toThrow("Invalid --on-conflict value: abort.");
  });

  it("defaults to replace when non-interactive", () => {
    expect(resolveApplyConflictPolicy({ noInteractive: true })).toBe("replace");
  });
});
