import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";

/**
 * One upstream update at a time across processes: the Desktop sidecar's
 * scheduled check and install, and `ht plugin update` / Update all. The
 * scheduled run skips when the lock is held; the CLI waits for it.
 */
export const UPSTREAM_UPDATE_LOCK_FILE = "upstream-update.lock";

export class UpstreamUpdateLockBusyError extends Error {
  readonly lockPath: string;

  constructor(lockPath: string) {
    super(`Another plugin update is in progress (${lockPath}). Try again when it finishes.`);
    this.name = "UpstreamUpdateLockBusyError";
    this.lockPath = lockPath;
  }
}

export function upstreamUpdateLockPath(): string {
  return join(getHarnesstapDir(), UPSTREAM_UPDATE_LOCK_FILE);
}

let depth = 0;
let heldFd: number | undefined;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** A lock left by a process that is gone is cleared; a live holder never is. */
function clearIfStale(lockPath: string): boolean {
  let pid: number;
  try {
    pid = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
  } catch {
    return false;
  }
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || pidAlive(pid)) return false;
  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function tryAcquire(lockPath: string): boolean {
  try {
    heldFd = openSync(lockPath, "wx");
    writeSync(heldFd, `${process.pid}\n`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return clearIfStale(lockPath) ? tryAcquire(lockPath) : false;
  }
}

function release(lockPath: string): void {
  depth -= 1;
  if (depth > 0) return;
  const fd = heldFd;
  heldFd = undefined;
  if (fd === undefined) return;
  try {
    closeSync(fd);
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // Already gone.
    }
  }
}

/**
 * Run fn while holding the upstream update lock. waitMs 0 fails fast with
 * UpstreamUpdateLockBusyError; a positive waitMs polls until the holder is done.
 */
export async function withUpstreamUpdateLock<T>(
  fn: () => Promise<T>,
  opts?: { waitMs?: number; pollMs?: number; onWait?: () => void },
): Promise<T> {
  const lockPath = upstreamUpdateLockPath();
  if (depth > 0) {
    depth += 1;
    try {
      return await fn();
    } finally {
      release(lockPath);
    }
  }
  mkdirSync(getHarnesstapDir(), { recursive: true });
  const waitMs = opts?.waitMs ?? 0;
  const pollMs = opts?.pollMs ?? 250;
  const deadline = Date.now() + waitMs;
  let announced = false;
  while (!tryAcquire(lockPath)) {
    if (Date.now() >= deadline) throw new UpstreamUpdateLockBusyError(lockPath);
    if (!announced) {
      announced = true;
      opts?.onWait?.();
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  depth = 1;
  try {
    return await fn();
  } finally {
    release(lockPath);
  }
}
