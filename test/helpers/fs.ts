import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function createTempDir(prefix = "skilldeck-test"): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

export function writeTextFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}

export function cleanupDir(dirPath: string): void {
  rmSync(dirPath, { recursive: true, force: true });
}
