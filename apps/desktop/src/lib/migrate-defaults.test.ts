import { describe, expect, it } from "bun:test";
import { defaultMigrateExportFilename } from "./migrate-defaults";

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
