import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import * as openPath from "../../src/services/open-path.ts";

describe("revealPathInFileManager", () => {
  afterEach(() => {
    spyOn(openPath, "openPathInSystemEditor").mockRestore();
    spyOn(openPath, "revealPathInFileManager").mockRestore();
  });

  it("opens directories through the system opener", async () => {
    const context = await createTestContext("reveal-dir");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const dirPath = join(context.homeDir, "docs");
      mkdirSync(dirPath);
      const openSpy = spyOn(openPath, "openPathInSystemEditor").mockImplementation(
        () => {},
      );

      openPath.revealPathInFileManager(dirPath);
      expect(openSpy).toHaveBeenCalledWith(dirPath);
    } finally {
      await context.cleanup();
    }
  });

  it("resolves revealable files under home", async () => {
    const context = await createTestContext("reveal-file-resolve");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const filePath = join(context.homeDir, "notes.md");
      writeFileSync(filePath, "ok\n");
      expect(openPath.resolveOpenableFilesystemPath(filePath)).toBeTruthy();
    } finally {
      await context.cleanup();
    }
  });
});
