import { describe, expect, it } from "bun:test";
import {
  formatDevBuildVersion,
  isReleaseBuild,
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
