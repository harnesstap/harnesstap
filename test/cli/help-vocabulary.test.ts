import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";
import { resolveApplyConflictPolicy } from "../../src/services/materialization-conflicts.ts";

describe("CLI help vocabulary (W2-12 to W2-15)", () => {
  it("prints the full command path in USAGE", async () => {
    const help = await runCli(["auth", "login", "--help"]);
    expect(help.stdout).toMatch(/USAGE[\s\S]*ht auth login/);
    expect(help.stdout).not.toMatch(/USAGE\s+login /);
  });

  it("aligns option columns and documents one interactive flag", async () => {
    const help = await runCli(["profile", "use", "--help"]);
    expect(help.stdout).toContain("--no-interactive");
    const interactiveLines = help.stdout
      .split("\n")
      .filter((line) => line.includes("--interactive") && !line.includes("--no-interactive"));
    expect(interactiveLines).toEqual([]);
  });

  it("hides duplicate apply --target and resource list --type", async () => {
    const applyHelp = await runCli(["apply", "--help"]);
    const applyOptions = applyHelp.stdout.split("OPTIONS")[1] ?? "";
    expect(applyOptions).toContain("--harness");
    expect(applyOptions).not.toContain("--target");
    expect(applyOptions).toContain("Non-interactive default: cancel");
    expect(applyHelp.stdout).toContain("ht apply base --on-conflict replace");
    const listHelp = await runCli(["resource", "list", "--help"]);
    expect(listHelp.stdout).toContain("[type]");
    expect(listHelp.stdout).not.toMatch(/^\s+-t, --type/m);
  });

  it("rewrites profile create --no-interactive help", async () => {
    const help = await runCli(["profile", "create", "--help"]);
    expect(help.stdout).toContain("Don't open the compose picker");
    expect(help.stdout).not.toContain("enable prompts");
  });

  it("shows plugin publish examples", async () => {
    const help = await runCli(["plugin", "publish", "--help"]);
    expect(help.stdout).toContain("EXAMPLES");
    expect(help.stdout).toContain("ht plugin publish my-plugin");
  });

  it("adds --format to scan help", async () => {
    const help = await runCli(["scan", "--help"]);
    expect(help.stdout).toContain("--format");
  });

  it("hides plugin l alias and --main/--aliases", async () => {
    const pluginHelp = await runCli(["plugin", "--help"]);
    expect(pluginHelp.stdout).not.toMatch(/plugin \(l\)/);
    const harnessHelp = await runCli(["harness", "set", "--help"]);
    const harnessOptions = harnessHelp.stdout.split("OPTIONS")[1] ?? "";
    expect(harnessOptions).not.toContain("--main");
    expect(harnessOptions).not.toContain("--aliases");
  });

  it("lists doctor and does not suggest install for uninstall", async () => {
    const help = await runCli(["--help"]);
    expect(help.stdout).toContain("doctor");
    const doctor = await runCli(["doctor", "--format", "json"]);
    expect(doctor.exitCode ?? 0).toBe(0);
    const payload = JSON.parse(doctor.stdout) as { node: string; paths: { database: string } };
    expect(payload.node).toMatch(/^v?\d+/);
    expect(payload.paths.database).toContain("harnesstap.db");

    const uninstalled = await runCli(["uninstall"]);
    expect(uninstalled.exitCode).toBe(1);
    expect(uninstalled.stderr).toContain("no uninstall command");
    expect(uninstalled.stderr).toContain("npm uninstall -g harnesstap");
    expect(uninstalled.stderr).not.toContain("Did you mean");
    expect(uninstalled.stderr).not.toMatch(/\binstall\b/);

    const versionCmd = await runCli(["version"]);
    expect(versionCmd.exitCode).toBe(1);
    expect(versionCmd.stderr).toContain("no version command");
    expect(versionCmd.stderr).toContain("ht --version");
  });
});

describe("non-interactive --on-conflict default", () => {
  it("cancels unless --on-conflict replace is passed", () => {
    expect(resolveApplyConflictPolicy({ noInteractive: true })).toBe("cancel");
    expect(resolveApplyConflictPolicy({ onConflict: "replace", noInteractive: true })).toBe(
      "replace",
    );
  });
});

describe("lock export format errors", () => {
  it("lists valid formats instead of apply/install", async () => {
    const context = await createTestContext("cli-lock-export-bogus");
    try {
      await runCli(["init"]);
      const result = await runCli(["lock", "export", "--format", "bogus"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("cyclonedx");
      expect(result.stderr).toContain("spdx");
      expect(result.stderr).not.toContain("ht apply");
      expect(result.stderr).not.toContain("ht install");
    } finally {
      await context.cleanup();
    }
  });
});
