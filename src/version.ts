import packageJson from "../package.json" with { type: "json" };

declare const __HT_VERSION__: string | undefined;

function resolvePackageVersion(): string {
  // tsup and the sidecar build define __HT_VERSION__; the JSON import is the
  // source/test fallback and is inlined by every bundler, never read at runtime.
  if (typeof __HT_VERSION__ === "string" && __HT_VERSION__.length > 0) {
    return __HT_VERSION__;
  }
  return packageJson.version;
}

export const PACKAGE_VERSION: string = resolvePackageVersion();
