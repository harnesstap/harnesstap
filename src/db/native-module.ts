import { NATIVE_MODULE_MISMATCH_MESSAGE } from "../copy/cli.js";

export { NATIVE_MODULE_MISMATCH_MESSAGE };

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

/** Run a native sqlite load; print the DS-6 one-liner on ABI mismatch. */
export function withNativeModuleGuard<T>(load: () => T): T {
  try {
    return load();
  } catch (error) {
    if (isNativeModuleMismatch(error)) {
      reportNativeModuleMismatch(error);
    }
    throw error;
  }
}
