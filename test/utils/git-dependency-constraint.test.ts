import { describe, expect, it } from "bun:test";
import {
  InvalidGitDependencyConstraintError,
  isGitRefConstraint,
  parseGitDependencyConstraint,
} from "../../src/utils/git-dependency-constraint.ts";
import { parseOriginLocator, formatOriginLocator } from "../../src/utils/plugin-origin-locator.ts";

describe("parseGitDependencyConstraint", () => {
  it("reads empty, latest and * as unpinned", () => {
    for (const raw of ["", "  ", "latest", "*", undefined]) {
      expect(parseGitDependencyConstraint(raw)).toEqual({ kind: "none" });
    }
  });

  it("reads full and abbreviated SHAs as commits", () => {
    expect(parseGitDependencyConstraint("f8797fe")).toEqual({ kind: "commit", sha: "f8797fe" });
    expect(parseGitDependencyConstraint("#F8797FE0")).toEqual({ kind: "commit", sha: "f8797fe0" });
    const full = "86bcb454a85082dd3972ac696e0005ce9ed3a8e8";
    expect(parseGitDependencyConstraint(full)).toEqual({ kind: "commit", sha: full });
  });

  it("reads branch and tag names, bare or explicit", () => {
    expect(parseGitDependencyConstraint("main")).toEqual({ kind: "ref", ref: "main" });
    expect(parseGitDependencyConstraint("#release/2026")).toEqual({ kind: "ref", ref: "release/2026" });
    expect(parseGitDependencyConstraint("ref:v1.2.0")).toEqual({ kind: "ref", ref: "v1.2.0" });
    expect(parseGitDependencyConstraint("ref:1.x")).toEqual({ kind: "ref", ref: "1.x" });
  });

  it("keeps semver versions and ranges, resolved against tags", () => {
    expect(parseGitDependencyConstraint("1.0.0")).toEqual({ kind: "semver", range: "1.0.0" });
    expect(parseGitDependencyConstraint("^1.2.0")).toEqual({ kind: "semver", range: "^1.2.0" });
    expect(parseGitDependencyConstraint("v1.2.3")).toEqual({ kind: "semver", range: "v1.2.3" });
  });

  it("rejects names git would refuse", () => {
    for (const raw of ["bad..ref", "has space", "ref:", "#", "-flag", "a~1", "end.lock"]) {
      expect(() => parseGitDependencyConstraint(raw)).toThrow(InvalidGitDependencyConstraintError);
    }
  });

  it("tells ref pins from version constraints", () => {
    expect(isGitRefConstraint("f8797fe")).toBe(true);
    expect(isGitRefConstraint("main")).toBe(true);
    expect(isGitRefConstraint("^1.0.0")).toBe(false);
    expect(isGitRefConstraint("latest")).toBe(false);
    expect(isGitRefConstraint("bad..ref")).toBe(false);
  });
});

describe("git origin locator pins", () => {
  it("reads and writes <url>#<ref>, and an old locator without a pin", () => {
    expect(parseOriginLocator("https://github.com/o/r.git")).toEqual({
      kind: "git",
      url: "https://github.com/o/r.git",
    });
    const pinned = parseOriginLocator("https://github.com/o/r.git#f8797fe");
    expect(pinned).toEqual({ kind: "git", url: "https://github.com/o/r.git", ref: "f8797fe" });
    expect(pinned ? formatOriginLocator(pinned) : "").toBe("https://github.com/o/r.git#f8797fe");
  });
});
