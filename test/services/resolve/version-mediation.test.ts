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
    expect(error.reason).toBe("constraint-conflict");
    expect(error.message).toContain("No installed version of base satisfies");
    expect(error.message).toContain("team-standards@2.1.0 → base ^2.0.0");
    expect(error.message).toContain("legacy-review@1.4.0 → base ^1.2.0");
    expect(error.message).toContain("available:");
    expect(error.actions[0]?.id).toBe("override-version");
    expect(error.actions.some((a) => a.id === "detach-dependency")).toBe(true);
    expect(error.hints[0]).toContain("ht plugin edit my-setup --override plugin:base@");
  });

  it("classifies empty inventory as missing-inventory with sync-install primary", () => {
    let caught: unknown;
    try {
      selectVersion({
        name: "design-doc",
        available: [],
        constraints: [
          {
            constraint: "*",
            requirer: "Teads (Default)@1.0.1",
            path: ["Teads (Default)@1.0.1"],
          },
        ],
        rootName: "Teads (Default)",
        sourceKind: "marketplace",
      });
    } catch (err) {
      caught = err;
    }
    const error = caught as UnsatisfiableConstraintError;
    expect(error.reason).toBe("missing-inventory");
    expect(error.message).toContain("No local version of design-doc is installed");
    expect(error.message).toContain("required by: Teads (Default)@1.0.1 → design-doc *");
    expect(error.actions[0]).toMatchObject({
      id: "sync-install",
      pluginName: "design-doc",
      sourceKind: "marketplace",
    });
    expect(error.hints[0]).toContain("--sync-plugins");
  });

  it("classifies a missing override version as override-missing", () => {
    expect(() =>
      selectVersion({
        name: "base",
        available,
        constraints: [],
        rootOverride: "9.9.9",
        rootName: "root",
      }),
    ).toThrow(UnsatisfiableConstraintError);

    try {
      selectVersion({
        name: "base",
        available,
        constraints: [],
        rootOverride: "9.9.9",
        rootName: "root",
      });
    } catch (err) {
      const error = err as UnsatisfiableConstraintError;
      expect(error.reason).toBe("override-missing");
      expect(error.message).toContain("Override requests base@9.9.9");
      expect(error.actions.some((a) => a.id === "clear-override")).toBe(true);
      expect(error.actions.some((a) => a.id === "override-version")).toBe(true);
    }
  });
});
