import { describe, expect, it } from "bun:test";
import packageJson from "../../package.json" with { type: "json" };
import {
  formatDevBuildVersion,
  isReleaseBuild,
  resolveBuildVersion,
} from "../../src/version.ts";

describe("formatDevBuildVersion", () => {
  it("returns the package version unchanged for release builds", () => {
    expect(
      formatDevBuildVersion("1.2.0", { isRelease: true, gitSha: "abc1234def" }),
    ).toBe("1.2.0");
  });

  it("appends -dev+sha for non-release builds", () => {
    expect(
      formatDevBuildVersion("1.2.0", { isRelease: false, gitSha: "abc1234def" }),
    ).toBe("1.2.0-dev+abc1234");
  });

  it("appends -dev when no sha is available", () => {
    expect(formatDevBuildVersion("1.2.0", { isRelease: false })).toBe("1.2.0-dev");
  });

  it("does not double-suffix an already stamped version", () => {
    expect(
      formatDevBuildVersion("1.2.0-dev+abc1234", { gitSha: "ffffeee" }),
    ).toBe("1.2.0-dev+abc1234");
  });

  it("treats HT_RELEASE=1 as a release build", () => {
    expect(isReleaseBuild({ HT_RELEASE: "1" })).toBe(true);
    expect(isReleaseBuild({ HARNESSTAP_RELEASE: "1" })).toBe(true);
    expect(isReleaseBuild({})).toBe(false);
  });
});

describe("npm publish build", () => {
  // npm publish rebuilds dist/ through prepublishOnly, with whatever env the
  // publish step has. 1.4.0 shipped as 1.4.0-dev+9dcdc1f that way (#501).
  it("makes prepublishOnly a release build on its own", () => {
    const script = packageJson.scripts.prepublishOnly;
    expect(script).toMatch(/(^|\s)HT_RELEASE=1\s/);
    expect(script).toContain("bun run build");
  });

  it("bakes the plain package version into a release build", () => {
    expect(resolveBuildVersion({ HT_RELEASE: "1", GITHUB_SHA: "9dcdc1fa00000000" })).toBe(packageJson.version);
    expect(resolveBuildVersion({ GITHUB_SHA: "9dcdc1fa00000000" })).toBe(`${packageJson.version}-dev+9dcdc1f`);
  });
});
