import { describe, it, expect } from "bun:test";
import {
  getPluginProvider,
  getPluginProviders,
  getRegisteredPluginPlatformIds,
} from "../../src/plugins/registry.js";

describe("plugin registry", () => {
  it("registers claude-code, cursor, goose, and copilot-cli providers", () => {
    expect(getRegisteredPluginPlatformIds()).toEqual(
      expect.arrayContaining(["claude-code", "cursor", "goose", "copilot-cli"]),
    );
    expect(getPluginProvider("claude-code")).toBeDefined();
    expect(getPluginProvider("cursor")).toBeDefined();
    expect(getPluginProvider("goose")).toBeDefined();
    expect(getPluginProvider("copilot-cli")).toBeDefined();
    expect(getPluginProvider("warp")).toBeUndefined();
  });

  it("returns all providers by default", () => {
    expect(getPluginProviders()).toHaveLength(4);
  });
});
