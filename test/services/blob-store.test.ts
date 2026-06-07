import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBlob, writeBlob } from "../../src/services/blob-store.js";

describe("blob-store", () => {
  let root: string;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("writes and reads content-addressed blob", () => {
    root = mkdtempSync(join(tmpdir(), "hd-blob-"));
    const hash = `sha256:${"a".repeat(64)}`;
    writeBlob(root, hash, "body");
    expect(readBlob(root, hash)).toBe("body");
  });
});
