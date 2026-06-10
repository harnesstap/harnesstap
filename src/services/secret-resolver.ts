import { readFileSync } from "node:fs";
import type { EnvironmentSecretProvider } from "../types.js";

export interface SecretRefInput {
  provider: string;
  ref: string;
}

function assertSecretProvider(provider: string): EnvironmentSecretProvider {
  switch (provider) {
    case "env":
    case "file":
    case "keychain":
      return provider;
    default: {
      const _exhaustive: never = provider as never;
      throw new Error(`Unknown secret provider: ${_exhaustive}`);
    }
  }
}

export function resolveSecretRef(ref: SecretRefInput): string {
  const provider = assertSecretProvider(ref.provider);

  switch (provider) {
    case "env": {
      const value = process.env[ref.ref];
      if (value === undefined) {
        throw new Error(
          `Secret ref could not be resolved: environment variable "${ref.ref}" is not set`,
        );
      }
      return value;
    }
    case "file": {
      try {
        return readFileSync(ref.ref, "utf-8").replace(/\n$/, "");
      } catch {
        throw new Error(
          `Secret ref could not be resolved: file "${ref.ref}" is missing or unreadable`,
        );
      }
    }
    case "keychain":
      throw new Error("keychain secret provider is not yet supported");
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown secret provider: ${_exhaustive}`);
    }
  }
}

export function resolveSecretRefs(
  secretRefs: Record<string, SecretRefInput>,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, secretRef] of Object.entries(secretRefs)) {
    vars[key] = resolveSecretRef(secretRef);
  }
  return vars;
}
