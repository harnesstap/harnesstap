import { basename, join, resolve } from "node:path";
import {
  PROFILE_PLUGIN_TAG,
  PROJECT_DEFAULT_PROFILE_NAME,
  PROJECT_PROFILE_TAG,
  isAutoSeededDefaultProfileName,
  isProfilePlugin,
  isProjectProfilePlugin,
} from "../constants/profile.js";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  getPluginResources,
} from "../models/plugin-model.js";
import type { Plugin } from "../types.js";
import { ensureDefaultProfilePlugin } from "./ensure-default-profile.js";
import {
  findProjectConfig,
  type ProjectConfig,
  type ProjectProfileEntry,
} from "./project-config.js";
import { writeProjectConfigFile } from "./project-config-write.js";
import { persistMergedProjectScan } from "./scanner.js";

export interface BootstrapProjectWorkspaceResult {
  config_path: string;
  default_profile: string;
  profiles: string[];
  already_existed?: boolean;
}

function localProfileEntry(name: string): ProjectProfileEntry {
  return {
    name,
    source: "local",
    selector: name,
  };
}

function dropAutoSeededHomeProfiles(config: ProjectConfig): ProjectConfig {
  const profiles = config.profiles.filter((profile) => {
    if (isAutoSeededDefaultProfileName(profile.name)) {
      return false;
    }
    return !isAutoSeededDefaultProfileName(profile.selector ?? "");
  });
  const default_profile = isAutoSeededDefaultProfileName(config.default_profile ?? "")
    ? undefined
    : config.default_profile;
  const { default_profile: _dropped, ...rest } = config;
  return {
    ...rest,
    profiles,
    ...(default_profile !== undefined ? { default_profile } : {}),
  };
}

export function allocateProjectDefaultPluginName(
  projectPath: string,
  existing: { profiles: ProjectProfileEntry[] } | null,
): string {
  const listed = existing?.profiles.find((profile) => {
    const selector = profile.selector ?? profile.name;
    const plugin = getPluginByName(selector);
    return plugin !== undefined && isProjectProfilePlugin(plugin);
  });
  if (listed) {
    return listed.selector ?? listed.name;
  }

  if (!getPluginByName(PROJECT_DEFAULT_PROFILE_NAME)) {
    return PROJECT_DEFAULT_PROFILE_NAME;
  }

  const base = basename(resolve(projectPath));
  const withBase = `${PROJECT_DEFAULT_PROFILE_NAME} (${base})`;
  if (!getPluginByName(withBase)) {
    return withBase;
  }

  let suffix = 2;
  while (getPluginByName(`${PROJECT_DEFAULT_PROFILE_NAME} (${base} ${suffix})`)) {
    suffix += 1;
  }
  return `${PROJECT_DEFAULT_PROFILE_NAME} (${base} ${suffix})`;
}

export async function seedProjectDefaultProfile(input: {
  name: string;
  projectPath: string;
}): Promise<{ plugin: Plugin; created: boolean }> {
  let plugin = getPluginByName(input.name);
  const created = !plugin;
  if (plugin && !isProfilePlugin(plugin)) {
    throw new Error(`Plugin already exists: ${input.name}`);
  }
  if (!plugin) {
    plugin = createPlugin({
      name: input.name,
      version: "1.0.0",
      description: `Project default inferred from ${input.projectPath}`,
      tags: [PROFILE_PLUGIN_TAG, PROJECT_PROFILE_TAG],
    });
  }

  const attachedMaterial = getPluginResources(plugin.id).filter(
    (resource) => resource.type !== "plugin",
  );
  if (attachedMaterial.length === 0) {
    const persisted = await persistMergedProjectScan(input.projectPath, undefined, {
      conflictPolicy: "skip",
      originRef: input.projectPath,
      namespace: input.name,
    });
    for (const resource of persisted.resources) {
      if (resource.type === "plugin") {
        continue;
      }
      addResourceToPlugin(plugin.id, resource.id);
    }
  }

  return { plugin, created };
}

function ensureProfileListed(
  profiles: ProjectProfileEntry[],
  name: string,
  position: "start" | "end",
): ProjectProfileEntry[] {
  if (profiles.some((profile) => profile.name === name || profile.selector === name)) {
    return profiles;
  }
  const entry = localProfileEntry(name);
  return position === "start" ? [entry, ...profiles] : [...profiles, entry];
}

export async function bootstrapProjectWorkspace(
  projectPath: string,
): Promise<BootstrapProjectWorkspaceResult> {
  ensureDefaultProfilePlugin();
  const resolvedRoot = resolve(projectPath);
  const existing = findProjectConfig(resolvedRoot);
  const alreadyExisted = existing !== null;
  const migrated = existing ? dropAutoSeededHomeProfiles(existing) : null;

  const projectDefaultName = allocateProjectDefaultPluginName(resolvedRoot, migrated);
  await seedProjectDefaultProfile({
    name: projectDefaultName,
    projectPath: resolvedRoot,
  });

  let profiles = migrated?.profiles ?? [];
  profiles = ensureProfileListed(profiles, projectDefaultName, "start");

  const seededDefault =
    migrated?.default_profile === undefined
    || isAutoSeededDefaultProfileName(migrated.default_profile);
  const default_profile = seededDefault
    ? projectDefaultName
    : (migrated?.default_profile ?? projectDefaultName);

  if (!profiles.some((profile) => profile.name === default_profile)) {
    profiles = ensureProfileListed(profiles, default_profile, "start");
  }

  const configPath = existing?.configPath ?? join(resolvedRoot, ".harnesstap", "config.toml");
  writeProjectConfigFile(configPath, {
    default_profile,
    ...(migrated?.default_environment
      ? { default_environment: migrated.default_environment }
      : {}),
    profiles,
    environments: migrated?.environments ?? [],
    plugins: migrated?.plugins ?? [],
  });

  return {
    config_path: configPath,
    default_profile,
    profiles: profiles.map((profile) => profile.name),
    ...(alreadyExisted ? { already_existed: true } : {}),
  };
}
