import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function blobPath(homeRoot: string, contentHash: string): string {
  const hex = contentHash.replace(/^sha256:/, "");
  return join(homeRoot, "blobs", "sha256", hex.slice(0, 2), hex);
}

export function writeBlob(homeRoot: string, contentHash: string, body: string): void {
  const path = blobPath(homeRoot, contentHash);
  mkdirSync(join(path, ".."), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, body, "utf8");
  }
}

export function readBlob(homeRoot: string, contentHash: string): string {
  return readFileSync(blobPath(homeRoot, contentHash), "utf8");
}
