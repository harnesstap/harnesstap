import { describe, expect, it } from "bun:test";
import { nextPatchVersion, validateCutRows, visibleCutErrors } from "./cut-versions-form";

describe("validateCutRows", () => {
  it("returns no errors when every row has a valid new version", () => {
    expect(
      validateCutRows([
        {
          name: "focus",
          currentVersion: "1.0.0",
          newVersion: "1.1.0",
        },
      ]),
    ).toEqual({});
  });

  it("accepts prerelease and build metadata versions", () => {
    expect(
      validateCutRows([
        {
          name: "focus",
          currentVersion: "1.0.0",
          newVersion: "2.0.0-beta.1",
        },
        {
          name: "alt",
          currentVersion: "0.1.0",
          newVersion: "0.2.0+build.1",
        },
      ]),
    ).toEqual({});
  });

  it("reports empty new versions", () => {
    expect(
      validateCutRows([
        {
          name: "focus",
          currentVersion: "1.0.0",
          newVersion: "",
        },
      ]),
    ).toEqual({
      focus: "Version is required",
    });
  });

  it("reports invalid semver versions", () => {
    expect(
      validateCutRows([
        {
          name: "focus",
          currentVersion: "1.0.0",
          newVersion: "not-a-version",
        },
      ]),
    ).toEqual({
      focus: "Use a version like 1.2.3",
    });
  });

  it("reports when new version equals current version", () => {
    expect(
      validateCutRows([
        {
          name: "focus",
          currentVersion: "1.0.0",
          newVersion: "1.0.0",
        },
      ]),
    ).toEqual({
      focus: "Must differ from current version",
    });
  });

  it("returns one error per invalid row", () => {
    expect(
      validateCutRows([
        {
          name: "focus",
          currentVersion: "1.0.0",
          newVersion: "1.0.0",
        },
        {
          name: "alt",
          currentVersion: "2.0.0",
          newVersion: "",
        },
      ]),
    ).toEqual({
      focus: "Must differ from current version",
      alt: "Version is required",
    });
  });
});

describe("nextPatchVersion", () => {
  it("bumps the patch and drops prerelease tags", () => {
    expect(nextPatchVersion("1.0.0")).toBe("1.0.1");
    expect(nextPatchVersion("2.3.9-beta.1")).toBe("2.3.10");
    expect(nextPatchVersion("not-semver")).toBe("");
  });
});

describe("visibleCutErrors", () => {
  it("hides errors until the row is edited", () => {
    const rows = [
      { name: "a", currentVersion: "1.0.0", newVersion: "1.0.0" },
      { name: "b", currentVersion: "1.0.0", newVersion: "1.0.0", edited: true },
    ];
    const errors = validateCutRows(rows);
    expect(Object.keys(errors).sort()).toEqual(["a", "b"]);
    expect(visibleCutErrors(rows, errors)).toEqual({ b: "Must differ from current version" });
  });
});
