import { describe, expect, it } from "bun:test";
import {
  defaultMigrateExportFilename,
  migrateExportSteps,
  migrateImportSteps,
  migrateStepCopy,
  migrateStepPosition,
} from "./migrate-defaults";

describe("defaultMigrateExportFilename", () => {
  it("returns workspace archive name", () => {
    expect(defaultMigrateExportFilename({ scope: "workspace" })).toBe(
      "harnesstap-migrate.tar.gz",
    );
  });

  it("returns plugin package envelope name", () => {
    expect(
      defaultMigrateExportFilename({ scope: "plugin", plugin: "my-setup" }),
    ).toBe("my-setup.ap.json");
  });

  it("returns resource package envelope name", () => {
    expect(
      defaultMigrateExportFilename({
        scope: "resource",
        resource: "instruction:hello@namespace",
      }),
    ).toBe("instruction-hello.ap.json");
  });
});

describe("migrate step copy", () => {
  it("numbers workspace export as 4 steps", () => {
    const steps = migrateExportSteps("workspace");
    expect(steps).toEqual(["scope", "options", "path", "confirm"]);
    expect(migrateStepCopy(1, steps.length)).toBe("Step 1 of 4");
    expect(migrateStepPosition(steps, "scope")).toEqual({ current: 1, total: 4 });
  });

  it("numbers plugin export as 5 steps", () => {
    expect(migrateExportSteps("plugin")).toHaveLength(5);
  });

  it("numbers import as 3 steps", () => {
    expect(migrateImportSteps()).toEqual(["path", "scope", "confirm"]);
    expect(migrateStepCopy(1, 3)).toBe("Step 1 of 3");
  });
});
