import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { handleOpenPath } from "../../src/agent/open-path-handlers.ts";
import { createResource } from "../../src/models/resource.ts";
import * as openPath from "../../src/services/open-path.ts";
import {
  resolveEditorPath,
  resolveExistingResourceFilesystemPath,
  resolveResourceEditorPath,
} from "../../src/services/resource-editor-path.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

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
