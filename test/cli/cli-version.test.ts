import { describe, expect, it } from "bun:test";
import { isRootVersionRequest } from "../../src/cli/runtime.ts";
import {
  assertSupportedRuntime,
  isSupportedNodeVersion,
} from "../../src/node-version.ts";
import { PACKAGE_VERSION } from "../../src/version.ts";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

describe("CLI version flags", () => {
  it("prints the package version for -V, --version, and --harnesstap-version", async () => {
    for (const flag of ["-V", "--version", "--harnesstap-version"]) {
      const result = await runCli([flag]);
      expect(result.exitCode).toBeUndefined();
      expect(result.stdout.trim()).toBe(PACKAGE_VERSION);
      expect(result.stderr).toBe("");
    }
  });

  it("documents -V, --version in top-level help and hides --harnesstap-version", async () => {
    const result = await runCli(["--help"]);
    expect(result.stdout).toContain("-V, --version");
    expect(result.stdout).not.toContain("--harnesstap-version");
  });

  it("does not treat plugin --version as a root version request", () => {
    expect(isRootVersionRequest(["node", "ht", "--version"])).toBe(true);
    expect(isRootVersionRequest(["node", "ht", "-V"])).toBe(true);
    expect(isRootVersionRequest(["node", "ht", "--no-color", "-V"])).toBe(true);
    expect(
      isRootVersionRequest(["node", "ht", "plugin", "create", "demo", "--version", "1.0.0"]),
    ).toBe(false);
  });

  it("lets plugin create --version set the plugin version instead of printing the CLI version", async () => {
    const context = await createTestContext("cli-root-version-passthrough");
    try {
      await runCli(["init"]);
      const result = await runCli([
        "plugin",
        "create",
        "versioned-plugin",
        "--version",
        "2.3.0",
      ]);
      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout.trim()).not.toBe(PACKAGE_VERSION);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.getPlugin("versioned-plugin");
      expect(plugin?.version).toBe("2.3.0");
    } finally {
      await context.cleanup();
    }
  });

  it("keeps the Node version guard independent of the CLI version flags", () => {
    expect(isSupportedNodeVersion("22.12.0")).toBe(true);
    expect(isSupportedNodeVersion("22.11.0")).toBe(false);
    expect(() =>
      assertSupportedRuntime({ node: "22.12.0" } as NodeJS.ProcessVersions),
    ).not.toThrow();
  });
});
