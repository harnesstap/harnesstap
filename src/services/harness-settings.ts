import { resolve } from "node:path";
import {
  deleteProjectHarnessConfig,
  getHarnessPreference,
  getProjectHarnessConfig,
  setHarnessPreference,
  setProjectHarnessConfig,
} from "../models/harness.js";
import { getAllPlatforms } from "../platforms/registry.js";
import { PLATFORM_FEATURES } from "../types.js";
import { getDedicatedSerializerPlatformIds } from "./platform-serializers.js";
import {
  normalizeRegisteredHarnesses,
  registeredHarnessesOf,
} from "./harness-targets.js";
import { ensureProjectForRoot, findProjectForRoot } from "./project-identity.js";

export type MaterializationStrategy = "symlink-preferred" | "copy";

export interface HarnessCatalogEntry {
  id: string;
  name: string;
  supported: boolean;
  /** Declared PlatformFeature values, ordered by PLATFORM_FEATURES. */
  supports: string[];
}

export interface HarnessSettingsGlobal {
  registered_harnesses: string[];
}

export interface HarnessSettingsProject {
  available: boolean;
  override: boolean;
  registered_harnesses?: string[];
  materialization_strategy?: MaterializationStrategy;
  reason?: string;
}

export interface HarnessSettingsPayload {
  global: HarnessSettingsGlobal;
  project?: HarnessSettingsProject;
  harnesses: HarnessCatalogEntry[];
}

export interface PutHarnessSettingsInput {
  global: { registered_harnesses: string[] };
  project?: {
    path: string;
    override: boolean;
    registered_harnesses?: string[];
    materialization_strategy?: MaterializationStrategy;
  };
}

export interface PutHarnessSettingsResult {
  global: HarnessSettingsGlobal;
  project?: HarnessSettingsProject;
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

function assertKnownHarnesses(harnesses: string[]): void {
  const known = new Set(getAllPlatforms().map((p) => p.id));
  for (const harness of harnesses) {
    if (!known.has(harness)) {
      throw new Error(`Unknown harness: ${harness}`);
    }
  }
}

function projectBlock(projectPath: string): HarnessSettingsProject {
  const root = resolve(projectPath);
  const project = findProjectForRoot(root);
  const config = project ? getProjectHarnessConfig(project.id) : undefined;
  if (!config) {
    return { available: true, override: false };
  }
  return {
    available: true,
    override: true,
    registered_harnesses: registeredHarnessesOf(config),
    materialization_strategy: config.materialization_strategy,
  };
}

export function getHarnessSettings(projectPath?: string): HarnessSettingsPayload {
  const preference = getHarnessPreference();
  return {
    global: {
      registered_harnesses: registeredHarnessesOf(preference),
    },
    ...(projectPath ? { project: projectBlock(projectPath) } : {}),
    harnesses: catalog(),
  };
}

export async function putHarnessSettings(
  input: PutHarnessSettingsInput,
): Promise<PutHarnessSettingsResult> {
  const globalRegistered = normalizeRegisteredHarnesses(input.global.registered_harnesses);
  if (globalRegistered.length === 0) {
    throw new Error("global.registered_harnesses must include at least one harness");
  }
  assertKnownHarnesses(globalRegistered);

  type ValidatedProject =
    | {
        root: string;
        override: false;
      }
    | {
        root: string;
        override: true;
        registered: string[];
        strategy: MaterializationStrategy;
      };

  let validatedProject: ValidatedProject | undefined;
  if (input.project) {
    const root = resolve(input.project.path);
    if (!input.project.override) {
      validatedProject = { root, override: false };
    } else {
      const registered = normalizeRegisteredHarnesses(
        input.project.registered_harnesses ?? [],
      );
      if (registered.length === 0) {
        throw new Error(
          "Project registered_harnesses is required when override is enabled",
        );
      }
      assertKnownHarnesses(registered);
      validatedProject = {
        root,
        override: true,
        registered,
        strategy:
          input.project.materialization_strategy === "copy"
            ? "copy"
            : "symlink-preferred",
      };
    }
  }

  const savedGlobal = setHarnessPreference({
    registered_harnesses: globalRegistered,
  });

  const result: PutHarnessSettingsResult = {
    global: {
      registered_harnesses: registeredHarnessesOf(savedGlobal),
    },
  };

  if (!validatedProject) {
    return result;
  }

  const project = ensureProjectForRoot(validatedProject.root);

  if (!validatedProject.override) {
    deleteProjectHarnessConfig(project.id);
    result.project = { available: true, override: false };
    return result;
  }

  const savedProject = setProjectHarnessConfig({
    project_id: project.id,
    registered_harnesses: validatedProject.registered,
    materialization_strategy: validatedProject.strategy,
  });

  result.project = {
    available: true,
    override: true,
    registered_harnesses: registeredHarnessesOf(savedProject),
    materialization_strategy: savedProject.materialization_strategy,
  };

  return result;
}
