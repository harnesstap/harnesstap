import { describe, expect, it } from "bun:test";
import { parseSwitchChanges } from "../../src/services/profile-switch-prompt.ts";

describe("parseSwitchChanges", () => {
  it("accepts save, stash and discard", () => {
    expect(parseSwitchChanges("save")).toBe("save");
    expect(parseSwitchChanges("stash")).toBe("stash");
    expect(parseSwitchChanges("discard")).toBe("discard");
  });

  it("rejects unknown values", () => {
    expect(parseSwitchChanges("overwrite")).toBe("invalid");
    expect(parseSwitchChanges(undefined)).toBeUndefined();
  });
});
