import { execFileSync } from "node:child_process";
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
      return resolveKeychainSecret(ref.ref);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown secret provider: ${_exhaustive}`);
    }
  }
}

function resolveKeychainSecret(ref: string): string {
  if (process.platform !== "darwin") {
    throw new Error(
      "Secret ref could not be resolved: keychain provider is only supported on macOS",
    );
  }

  const slashIndex = ref.indexOf("/");
  const service = slashIndex >= 0 ? ref.slice(0, slashIndex) : ref;
  const account = slashIndex >= 0 ? ref.slice(slashIndex + 1) : undefined;

  if (!service) {
    throw new Error(
      `Secret ref could not be resolved: keychain ref "${ref}" must include a service name`,
    );
  }

  const args = ["find-generic-password", "-s", service, "-w"];
  if (account) {
    args.splice(2, 0, "-a", account);
  }

  try {
    return execFileSync("security", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).replace(/\n$/, "");
  } catch {
    const label = account ? `${service}/${account}` : service;
    throw new Error(
      `Secret ref could not be resolved: keychain item "${label}" was not found`,
    );
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

export interface SecretRefWarning {
  key: string;
  message: string;
}

export function resolveSecretRefsBestEffort(
  secretRefs: Record<string, SecretRefInput>,
): {
  resolved: Record<string, string>;
  warnings: SecretRefWarning[];
} {
  const resolved: Record<string, string> = {};
  const warnings: SecretRefWarning[] = [];
  for (const [key, secretRef] of Object.entries(secretRefs)) {
    try {
      resolved[key] = resolveSecretRef(secretRef);
    } catch (error) {
      warnings.push({
        key,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { resolved, warnings };
}
