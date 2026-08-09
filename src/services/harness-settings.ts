import { resolve } from "node:path";
import {
  deleteProjectHarnessConfig,
  getHarnessPreference,
  getProjectHarnessConfig,
  setHarnessPreference,
  setProjectHarnessConfig,
} from "../models/harness.js";
import { getProjectByOrigin, upsertProject } from "../models/project.js";
import { getAllPlatforms } from "../platforms/registry.js";
import { PLATFORM_FEATURES } from "../types.js";
import { getDedicatedSerializerPlatformIds } from "./platform-serializers.js";
import {
  getGitOrigin,
  normalizeGitUrl,
  projectNameFromUrl,
} from "./git.js";
import { syncProject as defaultSyncProject } from "./project-sync.js";

export type MaterializationStrategy = "symlink-preferred" | "copy";

export interface HarnessCatalogEntry {
  id: string;
  name: string;
  supported: boolean;
  /** Declared PlatformFeature values, ordered by PLATFORM_FEATURES. */
  supports: string[];
}

export interface HarnessSettingsGlobal {
  main_harness: string | null;
  alias_harnesses: string[];
}

export interface HarnessSettingsProject {
  available: boolean;
  override: boolean;
  main_harness?: string | null;
  alias_harnesses?: string[];
  materialization_strategy?: MaterializationStrategy;
  reason?: string;
}

export interface HarnessSettingsPayload {
  global: HarnessSettingsGlobal;
  project?: HarnessSettingsProject;
  harnesses: HarnessCatalogEntry[];
}

export interface PutHarnessSettingsInput {
  global: { main_harness: string; alias_harnesses: string[] };
  project?: {
    path: string;
    override: boolean;
    main_harness?: string;
    alias_harnesses?: string[];
    materialization_strategy?: MaterializationStrategy;
  };
}

export interface PutHarnessSettingsMirrorSummary {
  main_harness: string;
  alias_harnesses: string[];
  platforms_synced: string[];
  files_written: number;
  surface_warnings: Array<{
    harness: string;
    path: string;
    category: string;
    message: string;
    alias_harnesses: string[];
  }>;
}

export interface PutHarnessSettingsResult {
  global: HarnessSettingsGlobal;
  project?: HarnessSettingsProject;
  mirror?: PutHarnessSettingsMirrorSummary;
  mirror_error?: string;
}

export interface HarnessSettingsPutDeps {
  syncProject: typeof defaultSyncProject;
}

function catalog(): HarnessCatalogEntry[] {
  const supported = new Set(getDedicatedSerializerPlatformIds());
  return getAllPlatforms().map((p) => ({
    id: p.id,
    name: p.name,
    supported: supported.has(p.id),
    supports: PLATFORM_FEATURES.filter((feature) => p.supports.has(feature)),
  }));
}

function assertKnownHarnesses(main: string, aliases: string[]): void {
  const known = new Set(getAllPlatforms().map((p) => p.id));
  if (!known.has(main)) {
    throw new Error(`Unknown harness: ${main}`);
  }
  for (const alias of aliases) {
    if (!known.has(alias)) {
      throw new Error(`Unknown harness: ${alias}`);
    }
  }
}

function projectBlock(projectPath: string): HarnessSettingsProject {
  const root = resolve(projectPath);
  const gitOrigin = getGitOrigin(root);
  if (!gitOrigin) {
    return {
      available: false,
      override: false,
      reason: "Project has no git origin",
    };
  }
  const project = getProjectByOrigin(normalizeGitUrl(gitOrigin));
  const config = project ? getProjectHarnessConfig(project.id) : undefined;
  if (!config) {
    return { available: true, override: false };
  }
  return {
    available: true,
    override: true,
    main_harness: config.main_harness,
    alias_harnesses: config.alias_harnesses,
    materialization_strategy: config.materialization_strategy,
  };
}

export function getHarnessSettings(projectPath?: string): HarnessSettingsPayload {
  const preference = getHarnessPreference();
  return {
    global: {
      main_harness: preference?.main_harness ?? null,
      alias_harnesses: preference?.alias_harnesses ?? [],
    },
    ...(projectPath ? { project: projectBlock(projectPath) } : {}),
    harnesses: catalog(),
  };
}

export async function putHarnessSettings(
  input: PutHarnessSettingsInput,
  deps?: HarnessSettingsPutDeps,
): Promise<PutHarnessSettingsResult> {
  const sync = deps?.syncProject ?? defaultSyncProject;
  assertKnownHarnesses(input.global.main_harness, input.global.alias_harnesses);

  // Validate project fields before any preference / project mutations so a
  // failing project path cannot leave a partially written global preference.
  type ValidatedProject =
    | {
        root: string;
        gitOrigin: string;
        override: false;
      }
    | {
        root: string;
        gitOrigin: string;
        override: true;
        main: string;
        aliases: string[];
        strategy: MaterializationStrategy;
      };

  let validatedProject: ValidatedProject | undefined;
  if (input.project) {
    const root = resolve(input.project.path);
    const gitOrigin = getGitOrigin(root);
    if (!gitOrigin) {
      throw new Error("Project harness override requires a git origin");
    }
    if (!input.project.override) {
      validatedProject = { root, gitOrigin, override: false };
    } else {
      const main = input.project.main_harness;
      if (!main || typeof main !== "string") {
        throw new Error("Project main_harness is required when override is enabled");
      }
      const aliases = input.project.alias_harnesses ?? [];
      assertKnownHarnesses(main, aliases);
      validatedProject = {
        root,
        gitOrigin,
        override: true,
        main,
        aliases,
        strategy:
          input.project.materialization_strategy === "copy"
            ? "copy"
            : "symlink-preferred",
      };
    }
  }

  const savedGlobal = setHarnessPreference({
    main_harness: input.global.main_harness,
    alias_harnesses: input.global.alias_harnesses,
  });

  const result: PutHarnessSettingsResult = {
    global: {
      main_harness: savedGlobal.main_harness,
      alias_harnesses: savedGlobal.alias_harnesses,
    },
  };

  if (!validatedProject) {
    return result;
  }

  const project = upsertProject({
    git_origin: normalizeGitUrl(validatedProject.gitOrigin),
    name: projectNameFromUrl(validatedProject.gitOrigin),
    local_path: validatedProject.root,
  });

  if (!validatedProject.override) {
    deleteProjectHarnessConfig(project.id);
    result.project = { available: true, override: false };
    return result;
  }

  const savedProject = setProjectHarnessConfig({
    project_id: project.id,
    main_harness: validatedProject.main,
    alias_harnesses: validatedProject.aliases,
    materialization_strategy: validatedProject.strategy,
  });

  result.project = {
    available: true,
    override: true,
    main_harness: savedProject.main_harness,
    alias_harnesses: savedProject.alias_harnesses,
    materialization_strategy: savedProject.materialization_strategy,
  };

  try {
    const mirror = await sync({ projectRoot: validatedProject.root });
    result.mirror = {
      main_harness: mirror.main_harness,
      alias_harnesses: mirror.alias_harnesses,
      platforms_synced: mirror.platforms_synced,
      files_written: mirror.files_written,
      surface_warnings: mirror.surface_warnings,
    };
  } catch (error) {
    result.mirror_error =
      error instanceof Error ? error.message : String(error);
  }

  return result;
}
