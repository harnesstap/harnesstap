import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { handleOpenPath } from "../../src/agent/open-path-handlers.ts";
import { createResource } from "../../src/models/resource.ts";
import * as openPath from "../../src/services/open-path.ts";
import { toContentsResource } from "../../src/services/profile-contents.ts";
import {
  resolveEditorPath,
  resolveExistingResourceFilesystemPath,
  resolveResourceEditorPath,
} from "../../src/services/resource-editor-path.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { hostPluginPackageDir } from "../../src/services/package-cache/paths.ts";

describe("resource-editor-path service", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("opens an existing file path directly", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-editor-path-"));
    tempDirs.push(dir);
    const filePath = join(dir, "demo.md");
    writeFileSync(filePath, "# demo", "utf-8");

    expect(resolveEditorPath(filePath)).toBe(filePath);
  });

  it("opens untracked resources from a path hint", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-editor-untracked-"));
    tempDirs.push(dir);
    const filePath = join(dir, "CLAUDE.md");
    writeFileSync(filePath, "# claude instructions", "utf-8");

    expect(
      resolveResourceEditorPath({
        selector: "untracked:instruction:claude-instructions",
        pathHint: filePath,
      }),
    ).toBe(filePath);
  });

  it("falls back to scratch content when no on-disk path exists", async () => {
    const context = await createInitializedTestContext("resource-editor-scratch");
    try {
      const resource = createResource({
        type: "skill",
        name: "scratch-skill",
        description: "",
        content: "# scratch content",
        metadata: {},
        source: "manual",
      });

      const resolved = resolveResourceEditorPath({
        selector: resource.id,
      });

      expect(existsSync(resolved)).toBe(true);
      expect(readFileSync(resolved, "utf-8")).toBe("# scratch content");
    } finally {
      await context.cleanup();
    }
  });

  it("resolves marketplace plugin-relative sources against the install root", async () => {
    const context = await createInitializedTestContext("resource-editor-relative");
    try {
      const installRoot = join(
        context.homeDir,
        ".claude",
        "plugins",
        "cache",
        "teads-plugins",
        "devx",
      );
      mkdirSync(join(installRoot, "agents"), { recursive: true });
      writeFileSync(
        join(installRoot, "plugin.json"),
        JSON.stringify({ name: "devx", version: "1.0.0" }),
        "utf-8",
      );
      const absolutePath = join(installRoot, "agents", "devx.md");
      writeFileSync(absolutePath, "# DevX agent\n", "utf-8");

      const resource = createResource({
        type: "agent",
        name: "devx",
        namespace: "devx",
        description: "General DevX guide",
        content: "# DevX agent",
        metadata: {},
        source: "agents/devx.md",
        origin_kind: "marketplace_link",
        origin_ref: "devx@teads-plugins",
      });

      expect(() => resolveEditorPath("agents/devx.md")).toThrow(
        /Path is not an openable file: agents\/devx.md/,
      );
      expect(
        resolveExistingResourceFilesystemPath(resource, "agents/devx.md"),
      ).toBe(absolutePath);
      expect(
        resolveResourceEditorPath({
          selector: "agent:devx@devx",
          pathHint: "agents/devx.md",
        }),
      ).toBe(absolutePath);
    } finally {
      await context.cleanup();
    }
  });

  it("opens agents/devx.md from a native install when the canonical cache copy has no file", async () => {
    const context = await createInitializedTestContext("resource-editor-canonical-miss");
    try {
      const nativeRoot = join(
        context.homeDir,
        ".claude",
        "plugins",
        "cache",
        "teads-plugins",
        "devx",
      );
      mkdirSync(join(nativeRoot, "agents"), { recursive: true });
      writeFileSync(
        join(nativeRoot, "plugin.json"),
        JSON.stringify({ name: "devx", version: "1.0.0" }),
        "utf-8",
      );
      const absolutePath = join(nativeRoot, "agents", "devx.md");
      writeFileSync(absolutePath, "# DevX agent\n", "utf-8");

      const canonicalRoot = hostPluginPackageDir(
        getHarnesstapDir(),
        "teads-plugins",
        "devx",
        "devx",
      );
      mkdirSync(canonicalRoot, { recursive: true });
      writeFileSync(
        join(canonicalRoot, "plugin.json"),
        JSON.stringify({ name: "devx", version: "1.0.0" }),
        "utf-8",
      );

      const resource = createResource({
        type: "agent",
        name: "devx",
        namespace: "devx",
        description: "General DevX guide",
        content: "# DevX agent",
        metadata: {},
        source: "agents/devx.md",
        origin_kind: "marketplace_link",
        origin_ref: "devx@teads-plugins",
      });

      expect(
        resolveExistingResourceFilesystemPath(resource, "agents/devx.md"),
      ).toBe(absolutePath);
      expect(
        resolveResourceEditorPath({
          selector: "agent:devx@devx",
          pathHint: "agents/devx.md",
        }),
      ).toBe(absolutePath);
    } finally {
      await context.cleanup();
    }
  });

  it("does not write editor-scratch when a live disk path is missing", async () => {
    const context = await createInitializedTestContext("resource-editor-missing-live");
    try {
      const missing = join(
        context.homeDir,
        ".config",
        "opencode",
        "agents",
        "agent-creator.md",
      );
      const resource = createResource({
        type: "agent",
        name: "agent-creator",
        description: "",
        content: "# stale",
        metadata: { content_status: "live" },
        source: "~/.config/opencode/agents/agent-creator.md",
        origin_kind: "manual",
        origin_ref: context.homeDir,
      });

      expect(() =>
        resolveResourceEditorPath({
          selector: resource.id,
          pathHint: "~/.config/opencode/agents/agent-creator.md",
        }),
      ).toThrow(/Path is not an openable file/);
      expect(existsSync(missing)).toBe(false);
      expect(existsSync(join(getHarnesstapDir(), "editor-scratch"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("opens the canonical live skill when ~/.agents is a symlink copy of ~/.claude", async () => {
    const context = await createInitializedTestContext("resource-editor-agents-symlink");
    try {
      const claudeDir = join(context.homeDir, ".claude", "skills", "agent-development");
      const agentsDir = join(context.homeDir, ".agents", "skills", "agent-development");
      mkdirSync(claudeDir, { recursive: true });
      mkdirSync(join(context.homeDir, ".agents", "skills"), { recursive: true });
      const liveFile = join(claudeDir, "SKILL.md");
      writeFileSync(liveFile, "---\nname: agent-development\n---\nbody\n", "utf-8");
      symlinkSync(claudeDir, agentsDir);

      const resource = createResource({
        type: "skill",
        name: "agent-development",
        description: "",
        content: "body",
        metadata: {},
        source: "~/.agents/skills/agent-development/SKILL.md",
        origin_kind: "local_snapshot",
        origin_ref: context.homeDir,
      });

      const canonical = realpathSync(liveFile);
      expect(
        resolveExistingResourceFilesystemPath(resource, agentsDir),
      ).toBe(canonical);
      expect(
        resolveResourceEditorPath({
          selector: resource.id,
          pathHint: "~/.agents/skills/agent-development",
        }),
      ).toBe(canonical);
      expect(toContentsResource(resource)).toMatchObject({
        source: "~/.agents/skills/agent-development/SKILL.md",
        filesystem_path: canonical,
      });
    } finally {
      await context.cleanup();
    }
  });

  it("resolves a bare AGENTS.md live source to ~/.agents/AGENTS.md", async () => {
    const context = await createInitializedTestContext("resource-editor-agents-md");
    try {
      const agentsDir = join(context.homeDir, ".agents");
      mkdirSync(agentsDir, { recursive: true });
      const liveFile = join(agentsDir, "AGENTS.md");
      writeFileSync(liveFile, "# global agents\n", "utf-8");

      const resource = createResource({
        type: "instruction",
        name: "agents-instructions",
        description: "",
        content: "# stale snapshot",
        metadata: { content_status: "live" },
        source: "AGENTS.md",
        origin_kind: "local_snapshot",
        origin_ref: context.homeDir,
      });

      expect(resolveExistingResourceFilesystemPath(resource, "AGENTS.md")).toBe(
        liveFile,
      );
      expect(
        resolveResourceEditorPath({
          selector: resource.id,
          pathHint: "AGENTS.md",
        }),
      ).toBe(liveFile);
      expect(toContentsResource(resource)).toMatchObject({
        source: "AGENTS.md",
        filesystem_path: liveFile,
      });
    } finally {
      await context.cleanup();
    }
  });
});

describe("POST /v1/open-path relative plugin sources", () => {
  it("opens a marketplace-relative path when the selector is provided", async () => {
    const context = await createInitializedTestContext("open-path-relative-agent");
    const openSpy = spyOn(openPath, "openPathInSystemEditor").mockImplementation(
      () => {},
    );
    const revealSpy = spyOn(openPath, "revealPathInFileManager").mockImplementation(
      () => {},
    );
    try {
      const installRoot = join(
        context.homeDir,
        ".claude",
        "plugins",
        "cache",
        "teads-plugins",
        "devx",
      );
      mkdirSync(join(installRoot, "agents"), { recursive: true });
      writeFileSync(
        join(installRoot, "plugin.json"),
        JSON.stringify({ name: "devx", version: "1.0.0" }),
        "utf-8",
      );
      const absolutePath = join(installRoot, "agents", "devx.md");
      writeFileSync(absolutePath, "# DevX agent\n", "utf-8");
      createResource({
        type: "agent",
        name: "devx",
        namespace: "devx",
        description: "General DevX guide",
        content: "# DevX agent",
        metadata: {},
        source: "agents/devx.md",
        origin_kind: "marketplace_link",
        origin_ref: "devx@teads-plugins",
      });

      const token = "test-token";
      const relativeOnly = await handleOpenPath(
        new Request("http://127.0.0.1/v1/open-path", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ path: "agents/devx.md" }),
        }),
        token,
      );
      expect(relativeOnly.status).toBe(400);
      const relativeBody = (await relativeOnly.json()) as { message?: string };
      expect(relativeBody.message).toContain("agents/devx.md");

      const withSelector = await handleOpenPath(
        new Request("http://127.0.0.1/v1/open-path", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            selector: "agent:devx@devx",
            pathHint: "agents/devx.md",
            reveal: true,
          }),
        }),
        token,
      );
      expect(withSelector.status).toBe(200);
      const body = (await withSelector.json()) as { path: string };
      expect(body.path).toBe(absolutePath);
      expect(revealSpy).toHaveBeenCalledTimes(1);
      expect(revealSpy.mock.calls[0]?.[0]).toBe(absolutePath);
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
      revealSpy.mockRestore();
      await context.cleanup();
    }
  });
});
