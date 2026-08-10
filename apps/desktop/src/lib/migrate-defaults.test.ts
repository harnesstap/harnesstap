import { describe, expect, it } from "bun:test";
import { defaultMigrateExportFilename } from "./migrate-defaults";

describe("defaultMigrateExportFilename", () => {
  it("returns workspace archive name", () => {
    expect(defaultMigrateExportFilename({ scope: "workspace" })).toBe(
      "harnesstap-migrate.tar.gz",
    );
  });

  it("returns plugin toml name", () => {
    expect(
      defaultMigrateExportFilename({ scope: "plugin", plugin: "my-setup" }),
    ).toBe("my-setup.harnesstap.toml");
  });

  it("returns resource toml name", () => {
    expect(
      defaultMigrateExportFilename({
        scope: "resource",
        resource: "instruction:hello@namespace",
      }),
    ).toBe("instruction-hello.harnesstap.toml");
  });

  it("returns environment toml name", () => {
    expect(
      defaultMigrateExportFilename({ scope: "environment", environment: "prod" }),
    ).toBe("prod.environment.toml");
  });
});
