import { describe, expect, it } from "bun:test";
import { resolveApplyConflictPolicy } from "../../src/services/materialization-conflicts.js";

describe("resolveApplyConflictPolicy", () => {
  it("honors explicit on-conflict values", () => {
    expect(resolveApplyConflictPolicy({ onConflict: "skip" })).toBe("skip");
    expect(resolveApplyConflictPolicy({ onConflict: "replace" })).toBe("replace");
    expect(resolveApplyConflictPolicy({ onConflict: "prompt" })).toBe("prompt");
  });

  it("defaults to replace when non-interactive", () => {
    expect(resolveApplyConflictPolicy({ noInteractive: true })).toBe("replace");
  });
});
