import { describe, expect, it } from "vitest";
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
});
