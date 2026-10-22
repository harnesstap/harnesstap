import { NATIVE_MODULE_MISMATCH_MESSAGE, SQLITE_MODULE_MISSING_MESSAGE } from "../copy/cli.js";

export { NATIVE_MODULE_MISMATCH_MESSAGE, SQLITE_MODULE_MISSING_MESSAGE };

function shouldShowNativeModuleDetails(): boolean {
  if (process.env.HARNESSTAP_DEBUG === "1") {
    return true;
  }
  return process.argv.includes("-v") || process.argv.includes("--verbose");
}

export function isNativeModuleMismatch(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const err = error as { code?: unknown; message?: unknown };
  const code = typeof err.code === "string" ? err.code : "";
  const message = typeof err.message === "string" ? err.message : String(error);
  if (code === "ERR_DLOPEN_FAILED") {
    return true;
  }
  return message.includes("NODE_MODULE_VERSION") || message.includes("ERR_DLOPEN");
}

export function reportNativeModuleMismatch(cause?: unknown): never {
  if (shouldShowNativeModuleDetails() && cause !== undefined) {
    console.error(cause);
  }
  console.error(NATIVE_MODULE_MISMATCH_MESSAGE);
  process.exit(1);
}

/**
 * better-sqlite3 is an optional dependency (#501). An install where its
 * native build failed, or one with scripts off, leaves it missing.
 */
export function isSqliteModuleMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const err = error as { code?: unknown; message?: unknown };
  const message = typeof err.message === "string" ? err.message : "";
  if (!message.includes("better-sqlite3") && !message.includes("better_sqlite3")) {
    return false;
  }
  return (
    err.code === "MODULE_NOT_FOUND"
    || err.code === "ERR_MODULE_NOT_FOUND"
    || message.includes("Could not locate the bindings file")
    || message.includes("Cannot find module")
  );
}

export function reportSqliteModuleMissing(cause?: unknown): never {
  if (shouldShowNativeModuleDetails() && cause !== undefined) {
    console.error(cause);
  }
  console.error(SQLITE_MODULE_MISSING_MESSAGE);
  process.exit(1);
}

/** Run a native sqlite load; print a DS-6 one-liner on ABI mismatch or a missing module. */
export function withNativeModuleGuard<T>(load: () => T): T {
  try {
    return load();
  } catch (error) {
    if (isNativeModuleMismatch(error)) {
      reportNativeModuleMismatch(error);
    }
    if (isSqliteModuleMissing(error)) {
      reportSqliteModuleMissing(error);
    }
    throw error;
  }
}
