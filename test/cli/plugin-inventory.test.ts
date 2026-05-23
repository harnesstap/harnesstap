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

  it("plugin list --format json returns committed and effective arrays", async () => {
    const context = await createTestContext("cli-plugin-list-json");

    try {
      cpSync(fixtureProject, context.projectDir, { recursive: true });
      initGitRepo(
        context.projectDir,
        "git@github.com:acme/harnessdeck-plugins-inventory.git",
      );

      process.env.HOME = fixtureHome;

      await runCli(["init"]);
      const out = await runCli([
        "plugin",
        "list",
        context.projectDir,
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(out.stdout) as {
        scanned_at: string;
        committed: { ref: string }[];
        effective: { ref: string }[];
      };
      expect(typeof parsed.scanned_at).toBe("string");
      expect(Array.isArray(parsed.committed)).toBe(true);
      expect(Array.isArray(parsed.effective)).toBe(true);
      expect(parsed.committed).toHaveLength(2);
      expect(parsed.effective).toHaveLength(3);
      const effectiveRefs = new Set(parsed.effective.map((e) => e.ref));
      expect(effectiveRefs.has("formatter@acme-marketplace")).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("plugin show formatter@acme-marketplace --format json includes ref and entries", async () => {
    const context = await createTestContext("cli-plugin-show-json");

    try {
      cpSync(fixtureProject, context.projectDir, { recursive: true });
      initGitRepo(
        context.projectDir,
        "git@github.com:acme/harnessdeck-plugins-inventory.git",
      );

      process.env.HOME = fixtureHome;

      await runCli(["init"]);
      const out = await runCli([
        "plugin",
        "show",
        "formatter@acme-marketplace",
        context.projectDir,
        "--format",
        "json",
      ]);
      const parsed = JSON.parse(out.stdout) as {
        ref: string;
        entries: Array<{ declared_by_scopes: string[]; ref: string }>;
      };
      expect(parsed.ref).toBe("formatter@acme-marketplace");
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.entries[0]?.ref).toBe("formatter@acme-marketplace");
      expect(parsed.entries[0]?.declared_by_scopes).toContain("project");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin list renders COMMITTED and EFFECTIVE section headers with plugin refs", async () => {
    const context = await createTestContext("cli-plugin-list-human");

    try {
      cpSync(fixtureProject, context.projectDir, { recursive: true });
      initGitRepo(
        context.projectDir,
        "git@github.com:acme/harnessdeck-plugins-inventory.git",
      );

      process.env.HOME = fixtureHome;

      await runCli(["init"]);
      const out = await runCli(["plugin", "list", context.projectDir]);
      expect(out.stdout).toContain("COMMITTED");
      expect(out.stdout).toContain("EFFECTIVE");
      expect(out.stdout).toContain("formatter@acme-marketplace");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin show renders PLUGIN panel with version and scope rows", async () => {
    const context = await createTestContext("cli-plugin-show-human");

    try {
      cpSync(fixtureProject, context.projectDir, { recursive: true });
      initGitRepo(
        context.projectDir,
        "git@github.com:acme/harnessdeck-plugins-inventory.git",
      );

      process.env.HOME = fixtureHome;

      await runCli(["init"]);
      const out = await runCli([
        "plugin",
        "show",
        "formatter@acme-marketplace",
        context.projectDir,
      ]);
      expect(out.stdout).toContain("PLUGIN");
      expect(out.stdout).toContain("formatter@acme-marketplace");
      expect(out.stdout).toContain("Version");
      expect(out.stdout).toContain("Scope");
    } finally {
      await context.cleanup();
    }
  });
});
