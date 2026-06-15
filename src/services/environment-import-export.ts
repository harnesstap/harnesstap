import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import {
  addSecretRefToEnvironment,
  createEnvironment,
  getEnvironmentByName,
  getEnvironmentResources,
  getEnvironmentSecretRefs,
  upsertEnvironmentEnvVar,
} from "../models/environment.js";
import { resolveEnvironmentOrThrow } from "./environment-selectors.js";
import { assertTransportExtension } from "./transport/validate.js";
import { formatTransportToml } from "./transport/write.js";
import { deckJsonToTomlDocument } from "./transport/deck.js";
import type {
  DeckJsonEnvironment,
  DeckJsonEnvironmentSecretRef,
  EnvVarMetadata,
  Environment,
} from "../types.js";

export interface EnvironmentImportExportPayload {
  environment: DeckJsonEnvironment;
  toml: string;
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

function environmentToTomlDocument(environment: DeckJsonEnvironment): Record<string, unknown> {
  const deckDocument = deckJsonToTomlDocument({
    $schema: "urn:harnessdeck:deck:v1",
    version: 1,
    name: environment.name,
    layers: [],
    environments: [environment],
  });
  return {
    name: environment.name,
    environments: deckDocument.environments,
  };
}

export function exportEnvironmentToml(
  selector: string,
): EnvironmentImportExportPayload {
  const environment = resolveEnvironmentOrThrow(selector);
  const payload = toDeckJsonEnvironment(environment);
  return {
    environment: payload,
    toml: formatTransportToml(environmentToTomlDocument(payload)),
  };
}

/** @deprecated Use exportEnvironmentToml */
export const exportEnvironmentJsonc = exportEnvironmentToml;

function parseEnvironmentToml(raw: string): DeckJsonEnvironment {
  const document = parse(raw) as Record<string, unknown>;
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("Invalid environment TOML: expected a table at the document root");
  }

  if (document.environments && typeof document.environments === "object") {
    const environments = document.environments as Record<string, Record<string, unknown>>;
    const name = typeof document.name === "string" ? document.name : Object.keys(environments)[0];
    if (!name || !environments[name]) {
      throw new Error("Environment import payload must include a named environment");
    }
    const entry = environments[name];
    const valuesRaw = entry.values;
    const values: Record<string, string> = {};
    if (valuesRaw && typeof valuesRaw === "object" && !Array.isArray(valuesRaw)) {
      for (const [key, value] of Object.entries(valuesRaw)) {
        values[key] = String(value);
      }
    }
    return {
      name,
      values,
      ...(entry.secret_refs && typeof entry.secret_refs === "object"
        ? { secret_refs: entry.secret_refs as DeckJsonEnvironment["secret_refs"] }
        : {}),
    };
  }

  if (typeof document.name !== "string" || !document.name) {
    throw new Error("Environment import payload must include a non-empty name");
  }
  const valuesRaw = document.values;
  if (!valuesRaw || typeof valuesRaw !== "object" || Array.isArray(valuesRaw)) {
    throw new Error("Environment import payload must include values table");
  }
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(valuesRaw as Record<string, unknown>)) {
    values[key] = String(value);
  }
  return {
    name: document.name,
    values,
    ...(document.secret_refs && typeof document.secret_refs === "object"
      ? { secret_refs: document.secret_refs as DeckJsonEnvironment["secret_refs"] }
      : {}),
  };
}

export function importEnvironmentToml(
  raw: string,
  options?: { createIfMissing?: boolean },
): { environment: Environment; imported_keys: string[]; imported_secret_refs: string[] } {
  const payload = parseEnvironmentToml(raw);
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

/** @deprecated Use importEnvironmentToml */
export const importEnvironmentJsonc = importEnvironmentToml;

export function importEnvironmentFile(filePath: string): ReturnType<typeof importEnvironmentToml> {
  assertTransportExtension(filePath);
  return importEnvironmentToml(readFileSync(filePath, "utf-8"));
}
