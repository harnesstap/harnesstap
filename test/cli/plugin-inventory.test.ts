import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";

const fixtureProject = join(
  import.meta.dirname,
  "../fixtures/claude-plugins-project",
);
const fixtureHome = join(
  import.meta.dirname,
  "../fixtures/claude-plugins-home",
);

describe("CLI plugin inventory (scan + project status)", () => {
  let harnessdeckHome: string;
  let previousHarnessdeckHome: string | undefined;

  beforeEach(() => {
    harnessdeckHome = mkdtempSync(join(tmpdir(), "hd-plugin-inv-"));
    previousHarnessdeckHome = process.env.HARNESSDECK_HOME;
    process.env.HARNESSDECK_HOME = harnessdeckHome;
  });

  afterEach(() => {
    if (previousHarnessdeckHome === undefined) {
      delete process.env.HARNESSDECK_HOME;
    } else {
      process.env.HARNESSDECK_HOME = previousHarnessdeckHome;
    }
  });

  it("persists Claude plugin counts on scan and surfaces them in project status JSON", async () => {
    const context = await createTestContext("cli-plugin-inventory");

    try {
      cpSync(fixtureProject, context.projectDir, { recursive: true });
      initGitRepo(
        context.projectDir,
        "git@github.com:acme/harnessdeck-plugins-inventory.git",
      );

      process.env.HOME = fixtureHome;

      await runCli(["init"]);
      const scanOut = await runCli(["scan", context.projectDir]);
      expect(scanOut.stdout).toMatch(/plugins \(claude-code\): .*committed.*effective/i);

      const statusOut = await runCli([
        "project",
        "status",
        context.projectDir,
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(statusOut.stdout) as {
        claude_code: {
          plugins: {
            committed_count: number;
            effective_count: number;
          };
        };
      };
      expect(parsed.claude_code.plugins.committed_count).toBe(2);
      expect(parsed.claude_code.plugins.effective_count).toBe(3);
    } finally {
      await context.cleanup();
    }
  });
});
