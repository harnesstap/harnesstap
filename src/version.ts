import { createRequire } from "node:module";

declare const __HT_VERSION__: string;

function readPackageJsonVersion(): string {
  const require = createRequire(import.meta.url);
  return (require("../package.json") as { version: string }).version;
}

function resolvePackageVersion(): string {
  try {
    if (typeof __HT_VERSION__ === "string" && __HT_VERSION__.length > 0) {
      return __HT_VERSION__;
    }
  } catch {
    // Running from source: tsup has not injected __HT_VERSION__.
  }
  return readPackageJsonVersion();
}

export const PACKAGE_VERSION: string = resolvePackageVersion();
