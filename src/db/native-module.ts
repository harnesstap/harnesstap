export const NATIVE_MODULE_MISMATCH_MESSAGE =
  "HarnessTap was installed under a different Node.js version. Run: npm rebuild -g harnesstap (or reinstall it).";

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
  return message.includes("NODE_MODULE_VERSION");
}

export function reportNativeModuleMismatch(): never {
  console.error(NATIVE_MODULE_MISMATCH_MESSAGE);
  process.exit(1);
}
