import { readFileSync } from "node:fs";
import { computationSlot, inStatusComputation } from "./status-computation.js";

/**
 * Read a file's bytes, or null when it is missing or unreadable. Inside a
 * status computation each path is read once and shared by the dry-run plan,
 * ownership hashing and the drift compare. Callers must not mutate the
 * returned buffer.
 */
export function readDiskBytesOnce(fullPath: string): Buffer | null {
  if (!inStatusComputation()) return readDiskBytes(fullPath);
  const bytes = computationSlot("disk-bytes", () => new Map<string, Buffer | null>());
  if (bytes.has(fullPath)) return bytes.get(fullPath) ?? null;
  const read = readDiskBytes(fullPath);
  bytes.set(fullPath, read);
  return read;
}

/** UTF-8 text of `readDiskBytesOnce`, decoded once per computation. */
export function readDiskTextOnce(fullPath: string): string | null {
  if (!inStatusComputation()) {
    const read = readDiskBytes(fullPath);
    return read === null ? null : read.toString("utf-8");
  }
  const texts = computationSlot("disk-texts", () => new Map<string, string | null>());
  if (texts.has(fullPath)) return texts.get(fullPath) ?? null;
  const read = readDiskBytesOnce(fullPath);
  const text = read === null ? null : read.toString("utf-8");
  texts.set(fullPath, text);
  return text;
}

function readDiskBytes(fullPath: string): Buffer | null {
  try {
    return readFileSync(fullPath);
  } catch {
    return null;
  }
}
