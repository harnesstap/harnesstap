import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashGeneratedContent } from "../../src/services/materialization-ownership.js";
import { hashFileContentStreaming } from "../../src/services/streaming-content-hash.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ht-stream-hash-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function reference(bytes: Buffer): string {
  return hashGeneratedContent(bytes.toString("utf-8"));
}

function streamed(bytes: Buffer, chunk: number): string | undefined {
  const file = join(dir, "f");
  writeFileSync(file, bytes);
  return hashFileContentStreaming(file, chunk);
}

describe("hashFileContentStreaming", () => {
  test("matches the whole-file hash for hand-picked edge cases at every chunk size", () => {
    const cases = [
      "",
      "\n",
      "\n\n\n",
      "\r",
      "\r\n",
      "\r\r\n",
      "a",
      "a\n",
      "a\r\n",
      "a\r\n\r\n",
      "a\n\r\nb\n\n",
      "a\rb",
      "a\r",
      "a\n\r",
      "\n\r\n\r",
      "line1\r\nline2\r\n\r\n\r\n",
      "\uFEFFbom first\r\n",
      "héllo wörld \u{1F600}\r\n",
    ];
    for (const text of cases) {
      const bytes = Buffer.from(text, "utf-8");
      for (let chunk = 1; chunk <= bytes.length + 1; chunk += 1) {
        expect(streamed(bytes, chunk)).toBe(reference(bytes));
      }
    }
  });

  test("matches for random bytes including invalid UTF-8, CRLF and trailing newlines", () => {
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const alphabet = [0x0a, 0x0d, 0x0a, 0x0d, 0x61, 0x20, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80, 0xff, 0xc0, 0x80];
    for (let round = 0; round < 300; round += 1) {
      const length = next() % 40;
      const bytes = Buffer.alloc(length);
      for (let i = 0; i < length; i += 1) bytes[i] = alphabet[next() % alphabet.length]!;
      const expected = reference(bytes);
      for (const chunk of [1, 2, 3, 5, 7, 64]) {
        expect(streamed(bytes, chunk)).toBe(expected);
      }
    }
  });

  test("hashes a file much larger than one chunk", () => {
    const text = `${"x".repeat(100)}\r\n`.repeat(5000) + "\n\n";
    const bytes = Buffer.from(text, "utf-8");
    expect(streamed(bytes, 4096)).toBe(reference(bytes));
    expect(hashFileContentStreaming(join(dir, "f"))).toBe(reference(bytes));
  });

  test("returns undefined for a missing file and for a folder", () => {
    expect(hashFileContentStreaming(join(dir, "missing"))).toBeUndefined();
    expect(hashFileContentStreaming(dir)).toBeUndefined();
  });
});
