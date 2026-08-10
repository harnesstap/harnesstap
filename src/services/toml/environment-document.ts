import type {
  DeckJsonEnvironment,
  DeckJsonEnvironmentSecretRef,
} from "../../types.js";
import { sortStringRecord } from "./sort.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function environmentsToTomlRecord(
  environments: DeckJsonEnvironment[],
): Record<string, Record<string, unknown>> {
  const record: Record<string, Record<string, unknown>> = {};
  for (const environment of [...environments].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const row: Record<string, unknown> = {};
    if (Object.keys(environment.values).length > 0) {
      row.values = sortStringRecord(environment.values);
    }
    if (environment.secret_refs && Object.keys(environment.secret_refs).length > 0) {
      row.secret_refs = environment.secret_refs;
    }
    record[environment.name] = row;
  }
  return record;
}

export function environmentsFromTomlRecord(
  record: unknown,
): DeckJsonEnvironment[] {
  if (!isRecord(record)) {
    return [];
  }

  return Object.entries(record)
    .map(([name, value]) => {
      if (!isRecord(value)) {
        throw new Error(`Environment ${name} must be a table`);
      }
      const valuesRaw = value.values;
      const values: Record<string, string> = {};
      if (isRecord(valuesRaw)) {
        for (const [key, entry] of Object.entries(valuesRaw)) {
          values[key] = String(entry);
        }
      }
      const secretRefsRaw = value.secret_refs;
      const secret_refs: Record<string, DeckJsonEnvironmentSecretRef> = {};
      if (isRecord(secretRefsRaw)) {
        for (const [key, entry] of Object.entries(secretRefsRaw)) {
          if (!isRecord(entry)) {
            continue;
          }
          secret_refs[key] = {
            provider: String(entry.provider ?? "env") as DeckJsonEnvironmentSecretRef["provider"],
            ref: String(entry.ref ?? ""),
          };
        }
      }
      return {
        name,
        values,
        ...(Object.keys(secret_refs).length > 0 ? { secret_refs } : {}),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function environmentToTomlDocument(
  environment: DeckJsonEnvironment,
): Record<string, unknown> {
  return {
    name: environment.name,
    values: sortStringRecord(environment.values),
    ...(environment.secret_refs && Object.keys(environment.secret_refs).length > 0
      ? { secret_refs: environment.secret_refs }
      : {}),
  };
}
