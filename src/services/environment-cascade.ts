import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import { getPluginById } from "../models/plugin-model.js";
import {
  getEnvironmentByName,
  getEnvironmentResources,
  getEnvironmentSecretRefs,
} from "../models/environment.js";
import type {
  EnvVarMetadata,
  EnvironmentSecretRef,
  Resource,
  ResourceType,
} from "../types.js";
import { ENVIRONMENT_RESOURCE_TYPES } from "./resource-classification.js";
import { resolveSecretRefs } from "./secret-resolver.js";

export interface EnvironmentFragment {
  vars: Record<string, string>;
  secretRefs: Record<string, { provider: string; ref: string }>;
}

export interface EnvironmentCascadeInput {
  home?: EnvironmentFragment;
  pluginDefaults?: EnvironmentFragment[];
}

export interface ResolveEnvironmentCascadeForApplyInput {
  configuredPluginIds: string[];
}

const EMPTY_FRAGMENT: EnvironmentFragment = { vars: {}, secretRefs: {} };

function isEnvironmentResourceType(type: ResourceType): boolean {
  return (ENVIRONMENT_RESOURCE_TYPES as readonly string[]).includes(type);
}

function resourceKey(resource: Pick<Resource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
}

export function resolveEnvironmentCascade(
  plugins: EnvironmentCascadeInput,
): EnvironmentFragment {
  const merge = (
    base: EnvironmentFragment,
    next?: EnvironmentFragment,
  ): EnvironmentFragment => ({
    vars: { ...base.vars, ...(next?.vars ?? {}) },
    secretRefs: { ...base.secretRefs, ...(next?.secretRefs ?? {}) },
  });

  let acc: EnvironmentFragment = { vars: {}, secretRefs: {} };
  acc = merge(acc, plugins.home);
  for (const fragment of plugins.pluginDefaults ?? []) {
    acc = merge(acc, fragment);
  }
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

function loadActiveEnvironmentFragment(baseDir: string): EnvironmentFragment | undefined {
  const activeName = readActiveEnvironmentName(baseDir);
  if (!activeName) {
    return undefined;
  }

  const fileFragment = readEnvironmentFile(
    join(baseDir, "environments", `${activeName}.json`),
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

export function loadHomeEnvironmentFragment(): EnvironmentFragment | undefined {
  return loadActiveEnvironmentFragment(getHarnesstapDir());
}

export function loadProjectActiveEnvironmentFragment(
  projectRoot: string,
): EnvironmentFragment | undefined {
  return loadActiveEnvironmentFragment(join(projectRoot, ".harnesstap"));
}

export function loadPluginDefaultFragments(
  configuredPluginIds: string[],
): EnvironmentFragment[] {
  return configuredPluginIds.flatMap((configuredPluginId) => {
    const configuredPlugin = getPluginById(configuredPluginId);
    if (!configuredPlugin?.default_environment_id) {
      return [];
    }
    return [fragmentFromEnvironmentId(configuredPlugin.default_environment_id)];
  });
}

export function buildEnvironmentCascadeInput(
  input: ResolveEnvironmentCascadeForApplyInput,
): EnvironmentCascadeInput {
  return {
    home: loadHomeEnvironmentFragment(),
    pluginDefaults: loadPluginDefaultFragments(input.configuredPluginIds),
  };
}

export function resolveEnvironmentCascadeForApply(
  input: ResolveEnvironmentCascadeForApplyInput,
): EnvironmentFragment {
  const cascaded = resolveEnvironmentCascade(buildEnvironmentCascadeInput(input));
  const resolvedSecrets = resolveSecretRefs(cascaded.secretRefs);
  return {
    vars: { ...cascaded.vars, ...resolvedSecrets },
    secretRefs: cascaded.secretRefs,
  };
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
    namespace: "",
    origin_kind: "manual" as const,
    origin_ref: "",
    content_hash: "",
    content_blob_ref: "",
    created_at: now,
    updated_at: now,
  }));
}

/**
 * Strip environment resources from the merged plugin set, then overlay the
 * resolved cascade (home ◂ plugin default).
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
