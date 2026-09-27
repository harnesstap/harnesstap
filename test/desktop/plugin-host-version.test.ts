import { describe, expect, it } from "bun:test";
import {
  formatHostPluginVersionId,
  formatHostPluginVersionOption,
  hostPluginVersionHint,
  hostPluginVersionKind,
  hostPluginVersionOptions,
  libraryPullIsDisabled,
  libraryPullVersionsTooltip,
  pluginVersionFieldVisible,
} from "../../apps/desktop/src/lib/plugin-host-version.ts";

describe("plugin host version labels", () => {
  it("labels tagged/marketplace semver as release", () => {
    expect(
      formatHostPluginVersionOption({
        version: "6.2.0",
        manifest_version: "6.2.0",
        advertised: true,
      }),
    ).toBe("6.2.0 (release, marketplace)");
    expect(
      formatHostPluginVersionOption({
        version: "6.3.0",
        manifest_version: "5.1.0",
        advertised: false,
      }),
    ).toBe("6.3.0 (release, plugin.json 5.1.0)");
    expect(
      formatHostPluginVersionOption({
        version: "5.1.0",
        manifest_version: "5.1.0",
        advertised: false,
      }),
    ).toBe("5.1.0 (release)");
  });

  it("labels git commit hashes as git and shortens them in the closed field", () => {
    const sha = "6fd4507659784c351abbd2bc264c7162cfd386dc";
    expect(hostPluginVersionKind(sha)).toBe("git");
    expect(hostPluginVersionKind("5.1.0")).toBe("release");
    expect(formatHostPluginVersionId(sha)).toBe("6fd450765978");
    expect(formatHostPluginVersionId("abc1234")).toBe("abc1234");
    expect(
      formatHostPluginVersionOption({
        version: sha,
        manifest_version: "5.1.0",
        advertised: false,
      }),
    ).toBe("6fd450765978 (git, plugin.json 5.1.0)");
    expect(
      formatHostPluginVersionOption({
        version: sha,
        manifest_version: sha,
        advertised: true,
      }),
    ).toBe("6fd450765978 (git, marketplace)");
  });

  it("hints when the marketplace catalog disagrees with the install", () => {
    expect(hostPluginVersionHint("6.1.1", "5.1.0")).toBe("Marketplace lists 6.1.1.");
    expect(hostPluginVersionHint("5.1.0", "5.1.0")).toBeNull();
    expect(hostPluginVersionHint(null, "5.1.0")).toBeNull();
  });

  it("disables Pull and tooltips the source-unavailable reason", () => {
    expect(libraryPullVersionsTooltip(null)).toBe("Fetch versions from source");
    expect(libraryPullIsDisabled(null)).toBe(false);
    expect(
      libraryPullVersionsTooltip("Marketplace acme-plugins is not installed"),
    ).toBe("Marketplace acme-plugins is not installed");
    expect(
      libraryPullIsDisabled("Marketplace acme-plugins is not installed"),
    ).toBe(true);
    expect(
      libraryPullVersionsTooltip("Plugin demo has no marketplace, so source versions cannot be pulled"),
    ).toBe("Plugin demo has no marketplace, so source versions cannot be pulled");
  });

  it("builds filterable combobox options from cache and marketplace notes", () => {
    const sha = "6fd4507659784c351abbd2bc264c7162cfd386dc";
    expect(
      hostPluginVersionOptions([
        { version: "6.3.0", manifest_version: "6.3.0", advertised: true },
        { version: "5.1.0", manifest_version: "5.1.0", advertised: false },
        { version: sha, manifest_version: null, advertised: false },
      ]),
    ).toEqual([
      { value: "6.3.0", label: "6.3.0 (release, marketplace)" },
      { value: "5.1.0", label: "5.1.0 (release)" },
      { value: sha, label: "6fd450765978 (git)", title: sha },
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
