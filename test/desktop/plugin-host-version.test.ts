import { describe, expect, it } from "bun:test";
import {
  formatHostPluginVersionOption,
  hostPluginVersionHint,
  hostPluginVersionOptions,
  pluginVersionFieldVisible,
} from "../../apps/desktop/src/lib/plugin-host-version.ts";

describe("plugin host version labels", () => {
  it("annotates marketplace and disagreeing plugin.json versions", () => {
    expect(
      formatHostPluginVersionOption({
        version: "6.2.0",
        manifest_version: "6.2.0",
        advertised: true,
      }),
    ).toBe("6.2.0 (marketplace)");
    expect(
      formatHostPluginVersionOption({
        version: "6.3.0",
        manifest_version: "5.1.0",
        advertised: false,
      }),
    ).toBe("6.3.0 (plugin.json 5.1.0)");
    expect(
      formatHostPluginVersionOption({
        version: "5.1.0",
        manifest_version: "5.1.0",
        advertised: false,
      }),
    ).toBe("5.1.0");
  });

  it("hints when the marketplace catalog disagrees with the install", () => {
    expect(hostPluginVersionHint("6.1.1", "5.1.0")).toBe("Marketplace lists 6.1.1.");
    expect(hostPluginVersionHint("5.1.0", "5.1.0")).toBeNull();
    expect(hostPluginVersionHint(null, "5.1.0")).toBeNull();
  });

  it("builds filterable combobox options from cache and marketplace notes", () => {
    expect(
      hostPluginVersionOptions([
        { version: "6.3.0", manifest_version: "6.3.0", advertised: true },
        { version: "5.1.0", manifest_version: "5.1.0", advertised: false },
      ]),
    ).toEqual([
      { value: "6.3.0", label: "6.3.0 (marketplace)" },
      { value: "5.1.0", label: "5.1.0" },
    ]);
  });

  it("shows Version for marketplace plugin refs", () => {
    expect(
      pluginVersionFieldVisible({
        type: "plugin",
        origin_kind: "marketplace_link",
      }),
    ).toBe(true);
    expect(pluginVersionFieldVisible({ type: "skill" })).toBe(false);
  });
});
