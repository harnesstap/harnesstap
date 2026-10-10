import { describe, expect, it } from "bun:test";
import { isValidPluginDisplayName } from "../../src/services/plugin-display-name.ts";

describe("isValidPluginDisplayName", () => {
  it("accepts ordinary names and rejects empty, path, and control characters", () => {
    expect(isValidPluginDisplayName("team-stack")).toBe(true);
    expect(isValidPluginDisplayName("global default")).toBe(true);
    expect(isValidPluginDisplayName("")).toBe(false);
    expect(isValidPluginDisplayName("   ")).toBe(false);
    expect(isValidPluginDisplayName("../evil")).toBe(false);
    expect(isValidPluginDisplayName("a/b")).toBe(false);
    expect(isValidPluginDisplayName("a\\b")).toBe(false);
    expect(isValidPluginDisplayName("bad\nname")).toBe(false);
  });
});
