import { describe, expect, it } from "bun:test";
import { validateCutRows } from "./cut-versions-form";

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
      focus: "Invalid semver version",
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
