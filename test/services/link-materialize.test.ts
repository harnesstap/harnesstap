import { describe, expect, it } from "bun:test";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { materializeFromSource } from "../../src/services/link-materialize.ts";
import { cleanupDir, createTempDir } from "../helpers/fs.ts";

describe("materializeFromSource", () => {
  it("clone writes a real file, not a symlink", () => {
    const root = createTempDir("link-materialize-");
    try {
      const source = join(root, "src.txt");
      const dest = join(root, "nested", "dest.txt");
      writeFileSync(source, "payload\n");
      mkdirSync(join(root, "nested"), { recursive: true });
      materializeFromSource(dest, source, "clone");
      expect(lstatSync(dest).isSymbolicLink()).toBe(false);
      expect(readFileSync(dest, "utf8")).toBe("payload\n");
    } finally {
      cleanupDir(root);
    }
  });
});
