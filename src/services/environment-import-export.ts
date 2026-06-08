import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";
import {
  addSecretRefToEnvironment,
  createEnvironment,
  getEnvironmentByName,
  getEnvironmentResources,
  getEnvironmentSecretRefs,
  upsertEnvironmentEnvVar,
} from "../models/environment.js";
import { resolveEnvironmentOrThrow } from "./environment-selectors.js";
import type {
  DeckJsonEnvironment,
  DeckJsonEnvironmentSecretRef,
  EnvVarMetadata,
  Environment,
} from "../types.js";

export interface EnvironmentImportExportPayload {
  environment: DeckJsonEnvironment;
  jsonc: string;
}

function toDeckJsonEnvironment(environment: Environment): DeckJsonEnvironment {
  const values: Record<string, string> = {};
  for (const resource of getEnvironmentResources(environment.id)) {
    if (resource.type !== "env_var") continue;
    const metadata = resource.metadata as EnvVarMetadata;
    values[metadata.key] = metadata.value;
  }

  const secretRefs = Object.fromEntries(
    getEnvironmentSecretRefs(environment.id).map((secretRef) => [
      secretRef.key,
      {
        provider: secretRef.provider as DeckJsonEnvironmentSecretRef["provider"],
        ref: secretRef.ref,
      },
    ]),
  );

  return {
    name: environment.name,
    values,
    ...(Object.keys(secretRefs).length > 0 ? { secret_refs: secretRefs } : {}),
  };
}

export function exportEnvironmentJsonc(
  selector: string,
): EnvironmentImportExportPayload {
  const environment = resolveEnvironmentOrThrow(selector);
  const payload = toDeckJsonEnvironment(environment);
  return {
    environment: payload,
    jsonc: `${JSON.stringify(payload, null, 2)}\n`,
  };
}

function parseDeckEnvironmentJsonc(raw: string): DeckJsonEnvironment {
  const parseErrors: ParseError[] = [];
  const parsed = parseJsonc(raw, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as Record<string, unknown>;

  if (parseErrors.length > 0) {
    const [firstError] = parseErrors;
    const detail = firstError
      ? `${printParseErrorCode(firstError.error)} at offset ${firstError.offset}`
      : "invalid JSONC";
    throw new Error(`Invalid environment JSONC: ${detail}`);
  }

  if (typeof parsed.name !== "string" || !parsed.name) {
    throw new Error("Environment import payload must include a non-empty name");
  }
  if (!parsed.values || typeof parsed.values !== "object") {
    throw new Error("Environment import payload must include values object");
  }

  return parsed as unknown as DeckJsonEnvironment;
}

export function importEnvironmentJsonc(
  raw: string,
  options?: { createIfMissing?: boolean },
): { environment: Environment; imported_keys: string[]; imported_secret_refs: string[] } {
  const payload = parseDeckEnvironmentJsonc(raw);
  const existing = getEnvironmentByName(payload.name);
  const environment =
    existing ??
    (options?.createIfMissing === false
      ? undefined
      : createEnvironment({
          name: payload.name,
          description: `imported environment ${payload.name}`,
        }));

  if (!environment) {
    throw new Error(`Environment not found: ${payload.name}`);
  }

  for (const [key, value] of Object.entries(payload.values)) {
    upsertEnvironmentEnvVar(environment.id, key, value);
  }
  for (const [key, secretRef] of Object.entries(payload.secret_refs ?? {})) {
    addSecretRefToEnvironment(
      environment.id,
      key,
      secretRef.provider,
      secretRef.ref,
    );
  }

  return {
    environment,
    imported_keys: Object.keys(payload.values).sort(),
    imported_secret_refs: Object.keys(payload.secret_refs ?? {}).sort(),
  };
}
