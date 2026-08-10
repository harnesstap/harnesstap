import { describe, expect, it } from "bun:test";
import {
  intersectConstraints,
  normalizeConstraint,
  selectVersion,
} from "../../../src/services/resolve/version-mediation.ts";
import { UnsatisfiableConstraintError } from "../../../src/services/resolve/types.ts";
import type { ConstraintRecord } from "../../../src/services/resolve/types.ts";

function record(constraint: string, requirer: string, depth = 2): ConstraintRecord {
  return {
    constraint,
    requirer,
    path: depth === 1 ? ["root@1.0.0"] : ["root@1.0.0", requirer],
  };
}

describe("normalizeConstraint", () => {
  it("turns an exact version into an equality range", () => {
    expect(normalizeConstraint("1.2.3")).toBe("=1.2.3");
  });

  it("passes ranges through and treats blank/latest as any", () => {
    expect(normalizeConstraint("^2.0.0")).toBe("^2.0.0");
    expect(normalizeConstraint("")).toBe("*");
    expect(normalizeConstraint("latest")).toBe("*");
    expect(normalizeConstraint("*")).toBe("*");
  });

  it("rejects garbage", () => {
    expect(() => normalizeConstraint("not-a-range")).toThrow(
      /Invalid version constraint/,
    );
  });
});

describe("intersectConstraints", () => {
  it("drops any-constraints and ANDs the rest", () => {
    expect(intersectConstraints(["*", "^2.0.0", ""])).toBe("^2.0.0");
    expect(intersectConstraints(["^2.0.0", ">=2.1.0"])).toBe("^2.0.0 >=2.1.0");
  });

  it("returns any when nothing is constrained", () => {
    expect(intersectConstraints([])).toBe("*");
    expect(intersectConstraints(["*", ""])).toBe("*");
  });
});

describe("selectVersion", () => {
  const available = ["1.0.0", "1.2.0", "2.0.0", "2.1.0", "2.2.0"];

  it("picks the highest version satisfying the intersection", () => {
    const result = selectVersion({
      name: "base",
      available,
      constraints: [record("^2.0.0", "a@1.0.0"), record("<2.2.0", "b@1.0.0")],
      rootName: "root",
    });
    expect(result).toEqual({ version: "2.1.0", reason: "mediation" });
  });

  it("picks the highest available when nothing constrains it", () => {
    const result = selectVersion({
      name: "base",
      available,
      constraints: [record("", "a@1.0.0")],
      rootName: "root",
    });
    expect(result).toEqual({ version: "2.2.0", reason: "mediation" });
  });

  it("lets a root override end mediation outright", () => {
    const result = selectVersion({
      name: "base",
      available,
      constraints: [record("^2.0.0", "a@1.0.0")],
      rootOverride: "1.0.0",
      rootName: "root",
    });
    expect(result).toEqual({ version: "1.0.0", reason: "root-override" });
  });

  it("lets a root-declared constraint end mediation outright", () => {
    const result = selectVersion({
      name: "base",
      available,
      constraints: [
        record("^2.0.0", "a@1.0.0"),
        record("=1.2.0", "root@1.0.0", 1),
      ],
      rootName: "root",
    });
    expect(result).toEqual({ version: "1.2.0", reason: "root-constraint" });
  });

  it("errors on an empty intersection and names both requirers with their paths", () => {
    let caught: unknown;
    try {
      selectVersion({
        name: "base",
        available,
        constraints: [
          record("^2.0.0", "team-standards@2.1.0"),
          record("^1.2.0", "legacy-review@1.4.0"),
        ],
        rootName: "my-setup",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnsatisfiableConstraintError);
    const error = caught as UnsatisfiableConstraintError;
    expect(error.message).toContain("cannot satisfy plugin base");
    expect(error.message).toContain("team-standards@2.1.0 → base ^2.0.0");
    expect(error.message).toContain("legacy-review@1.4.0 → base ^1.2.0");
    expect(error.hints[0]).toBe(
      "ht layer edit my-setup --override plugin:base@<version>",
    );
  });

  it("errors when a root override names a version that is not available", () => {
    expect(() =>
      selectVersion({
        name: "base",
        available,
        constraints: [],
        rootOverride: "9.9.9",
        rootName: "root",
      }),
    ).toThrow(UnsatisfiableConstraintError);
  });
});
