import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { COMMAND_HELP_REGISTRY } from "../../src/services/cli-help-registry.ts";
import * as openPath from "../../src/services/open-path.ts";
import { upsertProject } from "../../src/models/project.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";

describe("resolveOpenableFilesystemPath", () => {
  afterEach(() => {
    spyOn(openPath, "openPathInSystemEditor").mockRestore();
  });

  it("resolves an existing file under home", async () => {
    const context = await createTestContext("open-path-home-file");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const filePath = join(context.homeDir, "notes.md");
      writeFileSync(filePath, "# notes\n");

      expect(openPath.resolveOpenableFilesystemPath(filePath)).toBe(
        realpathSync(filePath),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("expands ~ under resolveHomeRoot", async () => {
    const context = await createTestContext("open-path-tilde");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const filePath = join(context.homeDir, "tilde.md");
      writeFileSync(filePath, "ok\n");

      expect(openPath.resolveOpenableFilesystemPath("~/tilde.md")).toBe(
        realpathSync(filePath),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("resolves an existing directory under home", async () => {
    const context = await createTestContext("open-path-home-dir");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const dirPath = join(context.homeDir, "docs");
      mkdirSync(dirPath);

      expect(openPath.resolveOpenableFilesystemPath(dirPath)).toBe(
        realpathSync(dirPath),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("resolves a project local_path after the project is registered", async () => {
    const context = await createTestContext("open-path-project");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      upsertProject({
        git_origin: "https://example.com/open-path-project.git",
        name: "open-path-project",
        local_path: context.projectDir,
      });
      const filePath = join(context.projectDir, "AGENTS.md");
      writeFileSync(filePath, "# agents\n");

      expect(openPath.resolveOpenableFilesystemPath(filePath)).toBe(
        realpathSync(filePath),
      );
      expect(openPath.resolveOpenableFilesystemPath(".")).toBe(
        realpathSync(context.projectDir),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("throws when the path does not exist", async () => {
    const context = await createTestContext("open-path-missing");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      expect(() =>
        openPath.resolveOpenableFilesystemPath(
          join(context.homeDir, "no-such-file.md"),
        ),
      ).toThrow(/Path is not an openable file or directory/);
    } finally {
      await context.cleanup();
    }
  });

  it("refuses a path outside allowed roots", async () => {
    const context = await createTestContext("open-path-escape");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const outside = join(context.rootDir, "outside.md");
      writeFileSync(outside, "nope\n");

      expect(() => openPath.resolveOpenableFilesystemPath(outside)).toThrow(
        /Path is outside allowed roots/,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("refuses a symlink whose realpath leaves allowed roots", async () => {
    const context = await createTestContext("open-path-symlink");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const outside = join(context.rootDir, "secret.md");
      writeFileSync(outside, "secret\n");
      const linkPath = join(context.homeDir, "escape.md");
      symlinkSync(outside, linkPath);

      expect(() => openPath.resolveOpenableFilesystemPath(linkPath)).toThrow(
        /Path is outside allowed roots/,
      );
    } finally {
      await context.cleanup();
    }
  });
});

describe("ht open", () => {
  let openSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    openSpy = spyOn(openPath, "openPathInSystemEditor").mockImplementation(() => {});
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it("opens an allowed file and prints a human success line", async () => {
    const context = await createTestContext("cli-open-file");
    try {
      await runCli(["init"]);
      const filePath = join(context.homeDir, "CLAUDE.md");
      writeFileSync(filePath, "# claude\n");

      const result = await runCli(["open", filePath]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain(`Opened ${realpathSync(filePath)}`);
      expect(openSpy).toHaveBeenCalledWith(realpathSync(filePath));
    } finally {
      await context.cleanup();
    }
  });

  it("opens then prints JSON { path } for --format json", async () => {
    const context = await createTestContext("cli-open-json");
    try {
      await runCli(["init"]);
      const filePath = join(context.homeDir, "AGENTS.md");
      writeFileSync(filePath, "# agents\n");

      const result = await runCli(["open", "--format", "json", filePath]);

      expect(result.exitCode).toBeUndefined();
      const payload = JSON.parse(result.stdout) as { path: string };
      expect(payload).toEqual({ path: realpathSync(filePath) });
      expect(openSpy).toHaveBeenCalledWith(realpathSync(filePath));
    } finally {
      await context.cleanup();
    }
  });

  it("opens an allowed directory including cwd when cwd is a registered project", async () => {
    const context = await createTestContext("cli-open-dir");
    try {
      await runCli(["init"]);
      upsertProject({
        git_origin: "https://example.com/cli-open-dir.git",
        name: "cli-open-dir",
        local_path: context.projectDir,
      });

      const result = await runCli(["open", "."]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain(`Opened ${realpathSync(context.projectDir)}`);
      expect(openSpy).toHaveBeenCalledWith(realpathSync(context.projectDir));
    } finally {
      await context.cleanup();
    }
  });

  it("expands ~ for a file under home", async () => {
    const context = await createTestContext("cli-open-tilde");
    try {
      await runCli(["init"]);
      mkdirSync(join(context.homeDir, ".claude"), { recursive: true });
      const filePath = join(context.homeDir, ".claude", "CLAUDE.md");
      writeFileSync(filePath, "# home\n");

      const result = await runCli(["open", "~/.claude/CLAUDE.md"]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain(`Opened ${realpathSync(filePath)}`);
      expect(openSpy).toHaveBeenCalledTimes(1);
    } finally {
      await context.cleanup();
    }
  });

  it("reports missing required argument path without spawning", async () => {
    const context = await createTestContext("cli-open-missing-arg");
    try {
      await runCli(["init"]);
      const result = await runCli(["open"], { isTTY: false });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing required argument 'path'");
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      await context.cleanup();
    }
  });

  it("fails for a missing path without spawning", async () => {
    const context = await createTestContext("cli-open-missing-file");
    try {
      await runCli(["init"]);
      const missing = join(context.homeDir, "gone.md");

      const result = await runCli(["open", missing]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Path is not an openable file or directory");
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      await context.cleanup();
    }
  });

  it("refuses a path outside allowed roots without spawning", async () => {
    const context = await createTestContext("cli-open-escape");
    try {
      await runCli(["init"]);
      const outside = join(context.rootDir, "outside.md");
      writeFileSync(outside, "nope\n");

      const result = await runCli(["open", outside]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Path is outside allowed roots");
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      await context.cleanup();
    }
  });

  it("refuses a symlink whose realpath leaves allowed roots", async () => {
    const context = await createTestContext("cli-open-symlink");
    try {
      await runCli(["init"]);
      const outside = join(context.rootDir, "secret.md");
      writeFileSync(outside, "secret\n");
      const linkPath = join(context.homeDir, "escape.md");
      symlinkSync(outside, linkPath);

      const result = await runCli(["open", linkPath]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Path is outside allowed roots");
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      await context.cleanup();
    }
  });

  it("does not treat plugin editor as an alias of open", async () => {
    const context = await createTestContext("cli-open-not-plugin-editor");
    try {
      await runCli(["init"]);
      createPlugin({ name: "team-stack", version: "1.2.0" });

      const result = await runCli([
        "plugin",
        "editor",
        "team-stack",
        "--format",
        "json",
        "--no-interactive",
      ]);

      expect(result.exitCode).toBeUndefined();
      const payload = JSON.parse(result.stdout) as { plugin: string; path: string };
      expect(payload.plugin).toBe("team-stack@1.2.0");
      expect(payload.path).toContain("team-stack@1.2.0.ap.json");
      expect(existsSync(payload.path)).toBe(true);
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      await context.cleanup();
    }
  });
});

describe("ht open help", () => {
  it("registers a leaf help entry with description and examples", async () => {
    const context = await createTestContext("cli-open-help");
    try {
      const result = await runCli(["open", "--help"]);

      expect(result.exitCode).toBeUndefined();
      expect(result.stdout).toContain("Open a file or directory in your system editor");
      expect(result.stdout).toContain("open ~/.claude/CLAUDE.md");
      expect(result.stdout).toContain("open .");
      expect(result.stdout).toContain("open --format json ./AGENTS.md");
      expect(COMMAND_HELP_REGISTRY.open?.description).toBe(
        "Open a file or directory in your system editor",
      );
      expect(COMMAND_HELP_REGISTRY.open?.examples?.length).toBeGreaterThan(0);
    } finally {
      await context.cleanup();
    }
  });

  it("appears under PROJECT on top-level help", async () => {
    const result = await runCli(["--help"]);
    expect(result.stdout).toContain("PROJECT");
    expect(result.stdout).toMatch(/open\s+\[path\]/);
  });
});
