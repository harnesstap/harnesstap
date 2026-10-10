import { describe, expect, it } from "bun:test";
import {
  pluginDescriptionFromManifest,
  semverSafePluginVersion,
} from "../../src/services/plugin-semver.ts";

describe("semverSafePluginVersion", () => {
  it("keeps a valid semver", () => {
    expect(semverSafePluginVersion("1.2.3", "abc123")).toBe("1.2.3");
    expect(semverSafePluginVersion("0.1.0-beta.1")).toBe("0.1.0-beta.1");
  });

  it("maps a git SHA version to 0.0.0+git.<sha12>", () => {
    expect(semverSafePluginVersion("9cc65d03aa2d")).toBe("0.0.0+git.9cc65d03aa2d");
    expect(semverSafePluginVersion(undefined, "9cc65d03aa2dffffffffffff")).toBe(
      "0.0.0+git.9cc65d03aa2d",
    );
  });

  it("falls back to 0.0.0 when nothing usable is present", () => {
    expect(semverSafePluginVersion("not-a-version")).toBe("0.0.0");
    expect(semverSafePluginVersion("")).toBe("0.0.0");
  });
});

describe("pluginDescriptionFromManifest", () => {
  it("trims plugin.json descriptions", () => {
    expect(pluginDescriptionFromManifest("  Session helpers  ")).toBe("Session helpers");
    expect(pluginDescriptionFromManifest(undefined)).toBe("");
  });
});
