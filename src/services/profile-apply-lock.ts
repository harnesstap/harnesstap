import { closeSync, mkdirSync, openSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";

export const PROFILE_APPLY_LOCK_FILE = "profile-apply.lock";

export class ProfileApplyLockBusyError extends Error {
  readonly lockPath: string;

  constructor(lockPath: string) {
    super(
      `Another profile apply or switch is in progress (${lockPath}). Wait for it to finish, or remove the lock file if no other HarnessTap process is running.`,
    );
    this.name = "ProfileApplyLockBusyError";
    this.lockPath = lockPath;
  }
}

export interface ProfileApplyLockHandle {
  release(): void;
}

function getLockPath(): string {
  return join(getHarnesstapDir(), PROFILE_APPLY_LOCK_FILE);
}

let lockDepth = 0;
let lockFd: number | undefined;

export function acquireProfileApplyLock(): ProfileApplyLockHandle {
  if (lockDepth > 0) {
    lockDepth += 1;
    return {
      release() {
        lockDepth -= 1;
      },
    };
  }

  const harnesstapDir = getHarnesstapDir();
  mkdirSync(harnesstapDir, { recursive: true });
  const lockPath = getLockPath();
  try {
    lockFd = openSync(lockPath, "wx");
    writeSync(lockFd, `${process.pid}\n`);
    lockDepth = 1;
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === "EEXIST") {
      throw new ProfileApplyLockBusyError(lockPath);
    }
    throw error;
  }

  return {
    release() {
      if (lockDepth <= 0) {
        return;
      }
      lockDepth -= 1;
      if (lockDepth > 0) {
        return;
      }
      const fd = lockFd;
      lockFd = undefined;
      if (fd === undefined) {
        return;
      }
      try {
        closeSync(fd);
      } finally {
        try {
          unlinkSync(lockPath);
        } catch {
          // Ignore races with another process replacing the lock file.
        }
      }
    },
  };
}

export async function withProfileApplyLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = acquireProfileApplyLock();
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
