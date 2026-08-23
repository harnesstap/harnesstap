import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

describe("CLI resource directories", () => {
  it("lists home defaults in human and json", async () => {
    const context = await createTestContext("cli-resource-directories-list");
    try {
      await runCli(["init"]);
      const home = resolve(context.homeDir);

      const human = await runCli(["resource", "directories", "list"]);
      expect(human.exitCode).toBeUndefined();
      expect(human.stdout).toContain("~");
      expect(human.stdout).toMatch(/\|\s+PATH\s+\|/);
      expect(human.stdout).toContain("RESOURCES");
      expect(human.stdout).toContain("FOLDERS");
      expect(human.stdout).toContain("KIND");
      expect(human.stdout).toContain("PLATFORMS");
      expect(human.stdout).toContain("home");
      expect(human.stdout).toMatch(/tracked director/);

      const json = await runCli(["resource", "directories", "list", "--format", "json"]);
      const parsed = JSON.parse(json.stdout) as Array<{
        kind: string;
        path: string;
        resource_count: number;
        folders: unknown[];
        removable: boolean;
      }>;
      expect(Array.isArray(parsed)).toBe(true);
      const homeEntry = parsed.find((entry) => entry.kind === "home_default");
      expect(homeEntry?.path).toBe(home);
      expect(homeEntry?.removable).toBe(false);
      expect(typeof homeEntry?.resource_count).toBe("number");
      expect(Array.isArray(homeEntry?.folders)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("lists via the ls alias", async () => {
    const context = await createTestContext("cli-resource-directories-ls");
    try {
      await runCli(["init"]);
      const result = await runCli(["resource", "directories", "ls", "--format", "json"]);
      expect(result.exitCode).toBeUndefined();
      const parsed = JSON.parse(result.stdout) as Array<{ kind: string }>;
      expect(parsed.some((entry) => entry.kind === "home_default")).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("adds a harness tree, prints import count, and shows the path on list", async () => {
    const context = await createTestContext("cli-resource-directories-add");
    try {
      await runCli(["init"]);
      const projectDir = join(context.homeDir, "scan-me");
      mkdirSync(join(projectDir, ".cursor", "rules"), { recursive: true });
      writeFileSync(
        join(projectDir, ".cursor", "rules", "style.mdc"),
        "---\ndescription: Style\n---\n# Style",
      );

      const human = await runCli(["resource", "directories", "add", projectDir]);
      expect(human.exitCode).toBeUndefined();
      expect(human.stdout).toContain("Tracking");
      expect(human.stdout).toContain(projectDir);
      expect(human.stdout).toMatch(/imported/);
      expect(human.stdout).toContain("Rescan later with ht resource directories rescan.");

      const jsonAddDir = join(context.homeDir, "json-scan");
      mkdirSync(jsonAddDir, { recursive: true });
      const json = await runCli([
        "resource",
        "directories",
        "add",
        jsonAddDir,
        "--format",
        "json",
      ]);
      const payload = JSON.parse(json.stdout) as {
        imported_count: number;
        directory: { path: string };
      };
      expect(payload.directory.path).toBe(resolve(jsonAddDir));
      expect(typeof payload.imported_count).toBe("number");

      const listed = await runCli(["resource", "directories", "list", "--format", "json"]);
      const entries = JSON.parse(listed.stdout) as Array<{ path: string }>;
      expect(entries.some((entry) => entry.path === resolve(projectDir))).toBe(true);
      expect(entries.some((entry) => entry.path === resolve(jsonAddDir))).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("add without a path is a usage error", async () => {
    const context = await createTestContext("cli-resource-directories-add-missing");
    try {
      await runCli(["init"]);
      await expect(runCli(["resource", "directories", "add"])).rejects.toThrow(
        /missing required argument 'path'/,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("add twice, add home, and add a missing dir fail with the service message", async () => {
    const context = await createTestContext("cli-resource-directories-add-errors");
    try {
      await runCli(["init"]);
      const projectDir = join(context.homeDir, "dup-scan");
      mkdirSync(projectDir, { recursive: true });

      const first = await runCli(["resource", "directories", "add", projectDir]);
      expect(first.exitCode).toBeUndefined();

      const dup = await runCli(["resource", "directories", "add", projectDir]);
      expect(dup.exitCode).toBe(1);
      expect(dup.stderr).toContain("already tracked");

      const home = await runCli(["resource", "directories", "add", context.homeDir]);
      expect(home.exitCode).toBe(1);
      expect(home.stderr).toContain("already tracked as harness defaults");

      const missing = await runCli([
        "resource",
        "directories",
        "add",
        join(context.rootDir, "does-not-exist"),
      ]);
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain("Directory not found");
    } finally {
      await context.cleanup();
    }
  });

  it("removes a custom root from the list and leaves library rows", async () => {
    const context = await createTestContext("cli-resource-directories-remove");
    try {
      await runCli(["init"]);
      const projectDir = join(context.homeDir, "untrack-me");
      mkdirSync(join(projectDir, ".cursor", "rules"), { recursive: true });
      writeFileSync(
        join(projectDir, ".cursor", "rules", "style.mdc"),
        "---\ndescription: Style\n---\n# Style",
      );

      await runCli(["resource", "directories", "add", projectDir]);
      const json = await runCli([
        "resource",
        "directories",
        "remove",
        projectDir,
        "--format",
        "json",
      ]);
      expect(json.exitCode).toBeUndefined();
      const payload = JSON.parse(json.stdout) as { removed: boolean; path: string };
      expect(payload).toEqual({ removed: true, path: resolve(projectDir) });

      const listed = await runCli(["resource", "directories", "list", "--format", "json"]);
      const entries = JSON.parse(listed.stdout) as Array<{ path: string }>;
      expect(entries.some((entry) => entry.path === resolve(projectDir))).toBe(false);

      const resourceModel = await import("../../src/models/resource.ts");
      expect(
        resourceModel.listResources().some((resource) => resource.origin_ref === resolve(projectDir)),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("remove human copy uses rm alias and does not prompt", async () => {
    const context = await createTestContext("cli-resource-directories-rm");
    try {
      await runCli(["init"]);
      const projectDir = join(context.homeDir, "rm-me");
      mkdirSync(projectDir, { recursive: true });
      await runCli(["resource", "directories", "add", projectDir]);

      const human = await runCli(["resource", "directories", "rm", projectDir]);
      expect(human.exitCode).toBeUndefined();
      expect(human.stdout).toContain("Stopped tracking");
      expect(human.stdout).toContain(resolve(projectDir));
      expect(human.stdout).toContain("Library resources from this path were not deleted.");
    } finally {
      await context.cleanup();
    }
  });

  it("remove home and unknown path fail", async () => {
    const context = await createTestContext("cli-resource-directories-remove-errors");
    try {
      await runCli(["init"]);
      const home = await runCli(["resource", "directories", "remove", context.homeDir]);
      expect(home.exitCode).toBe(1);
      expect(home.stderr).toContain("Cannot remove home harness defaults");

      const unknown = await runCli([
        "resource",
        "directories",
        "remove",
        join(context.homeDir, "never-tracked"),
      ]);
      expect(unknown.exitCode).toBe(1);
      expect(unknown.stderr).toContain("Directory not tracked");
    } finally {
      await context.cleanup();
    }
  });

  it("rescans home defaults and reports imported count", async () => {
    const context = await createTestContext("cli-resource-directories-rescan");
    try {
      await runCli(["init"]);
      mkdirSync(join(context.homeDir, ".cursor", "rules"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".cursor", "rules", "home-style.mdc"),
        "---\ndescription: Home style\nalwaysApply: true\n---\n# Home style",
      );

      const json = await runCli(["resource", "directories", "rescan", "--format", "json"]);
      expect(json.exitCode).toBeUndefined();
      const payload = JSON.parse(json.stdout) as {
        imported_count: number;
        directories: unknown[];
        rescanned: Array<{ kind: string; skipped: boolean }>;
      };
      expect(Array.isArray(payload.directories)).toBe(true);
      expect(payload.rescanned.some((row) => row.kind === "home_default")).toBe(true);
      expect(typeof payload.imported_count).toBe("number");

      const human = await runCli(["resource", "directories", "rescan"]);
      expect(human.exitCode).toBeUndefined();
      expect(human.stdout).toMatch(/Rescanned /);
      expect(human.stdout).toMatch(/imported/);
    } finally {
      await context.cleanup();
    }
  });

  it("warns on a missing custom dir and still exits 0", async () => {
    const context = await createTestContext("cli-resource-directories-rescan-skip");
    try {
      await runCli(["init"]);
      const missing = join(context.homeDir, "gone-root");
      mkdirSync(missing, { recursive: true });
      await runCli(["resource", "directories", "add", missing]);
      rmSync(missing, { recursive: true, force: true });

      const human = await runCli(["resource", "directories", "rescan"]);
      expect(human.exitCode).toBeUndefined();
      expect(human.stdout).toContain(resolve(missing));
      expect(human.stdout).toMatch(/Directory not found/);

      const json = await runCli(["resource", "directories", "rescan", "--format", "json"]);
      const payload = JSON.parse(json.stdout) as {
        rescanned: Array<{ path: string; skipped: boolean; error?: string }>;
      };
      const skipped = payload.rescanned.find((row) => row.path === resolve(missing));
      expect(skipped?.skipped).toBe(true);
      expect(skipped?.error).toContain("Directory not found");
    } finally {
      await context.cleanup();
    }
  });

  it("bare resource directories prints group help", async () => {
    const context = await createTestContext("cli-resource-directories-help");
    try {
      await runCli(["init"]);
      const result = await runCli(["resource", "directories"]);
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("add");
      expect(result.stdout).toContain("remove");
      expect(result.stdout).toContain("rescan");
      expect(result.stdout).toContain("Manage directories scanned into the resource library");
    } finally {
      await context.cleanup();
    }
  });
});
