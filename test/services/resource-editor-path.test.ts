import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { createResource } from "../../src/models/resource.ts";
import {
  resolveEditorPath,
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
});
