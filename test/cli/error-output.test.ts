import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const repoRoot = resolve(import.meta.dirname, "../..");

function runCliProcess(args: string[]) {
  return spawnSync(process.execPath, [resolve(repoRoot, "src/index.ts"), ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });
}

describe("CLI error output", () => {
  it("prints a clean error message without a stacktrace by default", () => {
    const result = runCliProcess(["plugin", "validate", "empty-plugin"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error: unknown command 'plugin validate'");
    expect(result.stderr).not.toContain("CommanderError");
    expect(result.stderr).not.toContain("node_modules/commander/lib/command.js");
    expect(result.stderr).not.toContain("at runHarnesstapCli");
  });

  it("prints the stacktrace when --verbose is enabled", () => {
    const result = runCliProcess(["--verbose", "plugin", "validate", "empty-plugin"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error: unknown command 'plugin validate'");
    expect(result.stderr).toContain("CommanderError");
    expect(result.stderr).toContain("node_modules/commander/lib/command.js");
  });

  it("appends contextual usage and command list after error message", () => {
    const result = runCliProcess(["plugin", "validate", "empty-plugin"]);

    expect(result.status).toBe(1);
    // Should show error message
    expect(result.stderr).toContain("error: unknown command 'plugin validate'");
    // Should append contextual help
    expect(result.stderr).toContain("USAGE");
    expect(result.stderr).toContain("LOCAL LIBRARY");
    // Should show actual plugin commands (without [options] in command name)
    expect(result.stderr).toContain("show [name]");
    expect(result.stderr).toContain("doctor");
    // Should not show stack trace
    expect(result.stderr).not.toContain("CommanderError");
    expect(result.stderr).not.toContain("node_modules/commander/lib/command.js");
  });

  it("does not append contextual help when verbose mode is enabled", () => {
    const result = runCliProcess(["--verbose", "plugin", "validate", "empty-plugin"]);

    expect(result.status).toBe(1);
    // Should show stack trace in verbose mode
    expect(result.stderr).toContain("CommanderError");
    // Should NOT append contextual help when showing stack trace
    expect(result.stderr).not.toContain("USAGE");
  });
});
