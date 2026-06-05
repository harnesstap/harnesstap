import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getHarnessdeckDir } from "../db/connection.js";
import { getConfiguredLayer } from "../models/configured-layer.js";
import {
  getEnvironmentByName,
  getEnvironmentResources,
  getEnvironmentSecretRefs,
} from "../models/environment.js";
import { getDeck, listDecks } from "../models/deck.js";
import type {
  DeckJson,
  DeckJsonEnvironment,
  EnvVarMetadata,
  EnvironmentSecretRef,
  Resource,
  ResourceType,
} from "../types.js";
import { ENVIRONMENT_RESOURCE_TYPES } from "./resource-classification.js";

export interface EnvironmentFragment {
  vars: Record<string, string>;
  secretRefs: Record<string, { provider: string; ref: string }>;
}

export interface EnvironmentCascadeInput {
  home?: EnvironmentFragment;
  layerDefaults?: EnvironmentFragment[];
  deckActive?: EnvironmentFragment;
}

export interface ResolveEnvironmentCascadeForApplyInput {
  configuredLayerIds: string[];
  projectRoot: string;
}

const EMPTY_FRAGMENT: EnvironmentFragment = { vars: {}, secretRefs: {} };

function isEnvironmentResourceType(type: ResourceType): boolean {
  return (ENVIRONMENT_RESOURCE_TYPES as readonly string[]).includes(type);
}

function resourceKey(resource: Pick<Resource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
}

export function resolveEnvironmentCascade(
  layers: EnvironmentCascadeInput,
): EnvironmentFragment {
  const merge = (
    base: EnvironmentFragment,
    next?: EnvironmentFragment,
  ): EnvironmentFragment => ({
    vars: { ...base.vars, ...(next?.vars ?? {}) },
    secretRefs: { ...base.secretRefs, ...(next?.secretRefs ?? {}) },
  });

  let acc: EnvironmentFragment = { vars: {}, secretRefs: {} };
  acc = merge(acc, layers.home);
  for (const fragment of layers.layerDefaults ?? []) {
    acc = merge(acc, fragment);
  }
  acc = merge(acc, layers.deckActive);
  return acc;
}

export function environmentResourcesToFragment(
  resources: Resource[],
  secretRefs: EnvironmentSecretRef[] = [],
): EnvironmentFragment {
  const vars: Record<string, string> = {};

  for (const resource of resources) {
    if (resource.type === "env_var") {
      const meta = resource.metadata as EnvVarMetadata;
      vars[meta.key] = meta.value;
    }
  }

  const secretRefMap = Object.fromEntries(
    secretRefs.map((ref) => [
      ref.key,
      { provider: ref.provider, ref: ref.ref },
    ]),
  );

  return { vars, secretRefs: secretRefMap };
}

export function fragmentFromEnvironmentId(
  environmentId: string,
): EnvironmentFragment {
  return environmentResourcesToFragment(
    getEnvironmentResources(environmentId),
    getEnvironmentSecretRefs(environmentId),
  );
}

function parseEnvironmentJson(raw: unknown): EnvironmentFragment {
  if (!raw || typeof raw !== "object") {
    return EMPTY_FRAGMENT;
  }

  const record = raw as Record<string, unknown>;
  const values =
    record.values && typeof record.values === "object"
      ? (record.values as Record<string, string>)
      : {};
  const secretRefsRaw =
    record.secret_refs && typeof record.secret_refs === "object"
      ? (record.secret_refs as Record<string, { provider: string; ref: string }>)
      : {};

  return {
    vars: values,
    secretRefs: secretRefsRaw,
  };
}

function deckJsonEnvironmentToFragment(
  environment: DeckJsonEnvironment,
): EnvironmentFragment {
  return {
    vars: environment.values,
    secretRefs: Object.fromEntries(
      Object.entries(environment.secret_refs ?? {}).map(([key, ref]) => [
        key,
        { provider: ref.provider, ref: ref.ref },
      ]),
    ),
  };
}

function readEnvironmentFile(path: string): EnvironmentFragment {
  if (!existsSync(path)) {
    return EMPTY_FRAGMENT;
  }
  try {
    return parseEnvironmentJson(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return EMPTY_FRAGMENT;
  }
}

function readActiveEnvironmentName(baseDir: string): string | undefined {
  const jsonPath = join(baseDir, "active-environment.json");
  if (existsSync(jsonPath)) {
    try {
      const raw = JSON.parse(readFileSync(jsonPath, "utf-8")) as { name?: string };
      if (typeof raw.name === "string" && raw.name.length > 0) {
        return raw.name;
      }
    } catch {
      // fall through
    }
  }

  const textPath = join(baseDir, "active-environment");
  if (existsSync(textPath)) {
    const name = readFileSync(textPath, "utf-8").trim();
    if (name.length > 0) {
      return name;
    }
  }

  return undefined;
}

export function loadHomeEnvironmentFragment(): EnvironmentFragment | undefined {
  const harnessdeckDir = getHarnessdeckDir();
  const activeName = readActiveEnvironmentName(harnessdeckDir);
  if (!activeName) {
    return undefined;
  }

  const fileFragment = readEnvironmentFile(
    join(harnessdeckDir, "environments", `${activeName}.json`),
  );
  if (Object.keys(fileFragment.vars).length > 0 || Object.keys(fileFragment.secretRefs).length > 0) {
    return fileFragment;
  }

  const dbEnvironment = getEnvironmentByName(activeName);
  if (dbEnvironment) {
    return fragmentFromEnvironmentId(dbEnvironment.id);
  }

  return undefined;
}

export function loadLayerDefaultFragments(
  configuredLayerIds: string[],
): EnvironmentFragment[] {
  return configuredLayerIds.flatMap((configuredLayerId) => {
    const configuredLayer = getConfiguredLayer(configuredLayerId);
    if (!configuredLayer?.default_environment_id) {
      return [];
    }
    return [fragmentFromEnvironmentId(configuredLayer.default_environment_id)];
  });
}

function loadDeckActiveFragmentFromRepo(projectRoot: string): EnvironmentFragment | undefined {
  const deckJsonPath = join(projectRoot, ".harnessdeck", "deck.json");
  if (!existsSync(deckJsonPath)) {
    return undefined;
  }

  let deckJson: DeckJson;
  try {
    deckJson = JSON.parse(readFileSync(deckJsonPath, "utf-8")) as DeckJson;
  } catch {
    return undefined;
  }

  const activeName = deckJson.active_environment;
  if (!activeName) {
    return undefined;
  }

  const envFilePath = join(
    projectRoot,
    ".harnessdeck",
    "environments",
    `${activeName}.json`,
  );
  const fileFragment = readEnvironmentFile(envFilePath);
  if (Object.keys(fileFragment.vars).length > 0 || Object.keys(fileFragment.secretRefs).length > 0) {
    return fileFragment;
  }

  const inlineEnvironment = deckJson.environments?.find(
    (environment) => environment.name === activeName,
  );
  if (inlineEnvironment) {
    return deckJsonEnvironmentToFragment(inlineEnvironment);
  }

  const dbEnvironment = getEnvironmentByName(activeName);
  if (dbEnvironment) {
    return fragmentFromEnvironmentId(dbEnvironment.id);
  }

  return undefined;
}

function loadDeckActiveFragmentFromDb(projectRoot: string): EnvironmentFragment | undefined {
  const resolvedProjectRoot = resolve(projectRoot);
  const deck = listDecks().find(
    (candidate) => resolve(candidate.root_path) === resolvedProjectRoot,
  );
  if (!deck?.active_environment_id) {
    return undefined;
  }
  return fragmentFromEnvironmentId(deck.active_environment_id);
}

export function loadDeckActiveEnvironmentFragment(
  projectRoot: string,
  deckId?: string,
): EnvironmentFragment | undefined {
  if (deckId) {
    const deck = getDeck(deckId);
    if (deck?.active_environment_id) {
      return fragmentFromEnvironmentId(deck.active_environment_id);
    }
  }

  const fromDb = loadDeckActiveFragmentFromDb(projectRoot);
  if (fromDb) {
    return fromDb;
  }

  return loadDeckActiveFragmentFromRepo(projectRoot);
}

export function buildEnvironmentCascadeInput(
  input: ResolveEnvironmentCascadeForApplyInput,
): EnvironmentCascadeInput {
  return {
    home: loadHomeEnvironmentFragment(),
    layerDefaults: loadLayerDefaultFragments(input.configuredLayerIds),
    deckActive: loadDeckActiveEnvironmentFragment(input.projectRoot),
  };
}

export function resolveEnvironmentCascadeForApply(
  input: ResolveEnvironmentCascadeForApplyInput,
): EnvironmentFragment {
  return resolveEnvironmentCascade(buildEnvironmentCascadeInput(input));
}

export function fragmentToEnvironmentResources(
  fragment: EnvironmentFragment,
): Resource[] {
  const now = new Date().toISOString();
  return Object.entries(fragment.vars).map(([key, value]) => ({
    id: `cascade:${key}`,
    type: "env_var" as const,
    name: key,
    description: "",
    content: "",
    metadata: { key, value } satisfies EnvVarMetadata,
    source: "environment-cascade",
    created_at: now,
    updated_at: now,
  }));
}

/**
 * Strip environment resources from the merged layer set, then overlay the
 * resolved cascade (home ◂ layer default ◂ deck active).
 */
export function mergeResolvedEnvironmentIntoResources(
  resources: Resource[],
  cascade: EnvironmentFragment,
): Resource[] {
  const nonEnvironmentResources = resources.filter(
    (resource) => !isEnvironmentResourceType(resource.type),
  );
  const cascadeResources = fragmentToEnvironmentResources(cascade);

  const order: string[] = [];
  const byKey = new Map<string, Resource>();
  for (const resource of [...nonEnvironmentResources, ...cascadeResources]) {
    const key = resourceKey(resource);
    if (!byKey.has(key)) {
      order.push(key);
    }
    byKey.set(key, resource);
  }

  return order
    .map((key) => byKey.get(key))
    .filter((resource): resource is Resource => resource !== undefined);
}
