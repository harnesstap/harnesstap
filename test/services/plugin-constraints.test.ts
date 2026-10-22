import { describe, expect, it } from "bun:test";
import {
  parseVersionConstraint,
  satisfiesConstraint,
} from "../../src/services/plugin-constraints.ts";

describe("plugin-constraints", () => {
  it("treats plain semver as exact pin", () => {
    expect(parseVersionConstraint("2.1.0").kind).toBe("exact");
    expect(satisfiesConstraint("2.1.0", "2.1.0")).toBe(true);
    expect(satisfiesConstraint("2.1.0", "2.1.1")).toBe(false);
  });

  it("evaluates semver ranges", () => {
    const range = ">=2.1.0 <3.0.0";
    expect(parseVersionConstraint(range).kind).toBe("range");
    expect(satisfiesConstraint(range, "2.5.0")).toBe(true);
    expect(satisfiesConstraint(range, "3.0.0")).toBe(false);
  });

  it("returns false for unknown installed version", () => {
    expect(satisfiesConstraint("2.0.0", "unknown")).toBe(false);
  });

  it("treats a git sha install version as unsatisfied instead of throwing", () => {
    // Claude Code records `version: "ea10b213686c"` for marketplace plugins
    // without a version, e.g. context7@claude-plugins-official.
    expect(satisfiesConstraint("1.0.0", "ea10b213686c")).toBe(false);
    expect(satisfiesConstraint("^1.0.0", "ea10b213686c")).toBe(false);
  });

  it("reads latest as any version, like *", () => {
    expect(parseVersionConstraint("latest")).toEqual({ kind: "range", range: "*" });
    expect(parseVersionConstraint(" latest ")).toEqual({ kind: "range", range: "*" });
    expect(satisfiesConstraint("latest", "1.0.2")).toBe(true);
    expect(satisfiesConstraint("latest", "2.0.0-beta.1")).toBe(true);
    expect(satisfiesConstraint("latest", "unknown")).toBe(false);
    expect(() => parseVersionConstraint("newest")).toThrow(/Invalid version constraint: newest/);
  });

  it("explains a commit SHA given where a version is expected", () => {
    expect(() => parseVersionConstraint("a878bcad3958")).toThrow(
      /looks like a commit SHA.*depend on the plugin's git repository instead/,
    );
  });
});
