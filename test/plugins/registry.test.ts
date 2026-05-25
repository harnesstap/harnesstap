import { describe, it, expect } from "bun:test";
import {
  getPluginProvider,
  getPluginProviders,
  getRegisteredPluginPlatformIds,
} from "../../src/plugins/registry.js";

describe("plugin registry", () => {
  it("registers claude-code and cursor providers", () => {
    expect(getRegisteredPluginPlatformIds()).toEqual(
      expect.arrayContaining(["claude-code", "cursor"]),
    );
    expect(getPluginProvider("claude-code")).toBeDefined();
    expect(getPluginProvider("cursor")).toBeDefined();
    expect(getPluginProvider("warp")).toBeUndefined();
  });

  it("returns both providers by default", () => {
    expect(getPluginProviders()).toHaveLength(2);
  });
});
