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
    const result = runCliProcess(["preset", "validate", "empty-preset"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error: unknown command 'preset validate'");
    expect(result.stderr).not.toContain("CommanderError");
    expect(result.stderr).not.toContain("node_modules/commander/lib/command.js");
    expect(result.stderr).not.toContain("at runHarnessdeckCli");
  });

  it("prints the stacktrace when --verbose is enabled", () => {
    const result = runCliProcess(["--verbose", "preset", "validate", "empty-preset"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error: unknown command 'preset validate'");
    expect(result.stderr).toContain("CommanderError");
    expect(result.stderr).toContain("node_modules/commander/lib/command.js");
  });
});
