import { describe, expect, it } from "bun:test";
import { isRootVersionRequest } from "../../src/cli/runtime.ts";
import { PACKAGE_VERSION } from "../../src/version.ts";
import { runCli } from "../helpers/cli.ts";

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
    expect(
      isRootVersionRequest(["node", "ht", "plugin", "create", "demo", "--version", "1.0.0"]),
    ).toBe(false);
  });
});
