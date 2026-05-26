import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyClaudePresetExtensions } from "../platforms/claude-preset-extensions.js";
import type {
  ClaudePresetConfig,
  Resource,
  SerializedFile,
} from "../types.js";
import { getPlatformSerializer } from "./platform-serializers.js";

export interface ApplyResult {
  platformId: string;
  files: SerializedFile[];
}

/**
 * Generate platform files from resources without writing to disk.
 * Useful for dry-run / diff.
 */
export async function generateFiles(
  resources: Resource[],
  platforms: string[],
  projectRoot: string,
  claudeConfig?: ClaudePresetConfig,
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];

  for (const pid of platforms) {
    const serializer = getPlatformSerializer(pid);
    let files = await serializer.serialize(resources, projectRoot);
    if (pid === "claude-code" && claudeConfig) {
      files = applyClaudePresetExtensions(files, claudeConfig, projectRoot);
    }
    results.push({ platformId: pid, files });
  }

  return results;
}

/**
 * Write serialized files to disk, creating directories as needed.
 */
export function writeFiles(
  files: SerializedFile[],
  projectRoot: string,
): void {
  for (const file of files) {
    const fullPath = join(projectRoot, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, "utf-8");
  }
}

/**
 * Full apply: serialize resources for each platform and write to disk.
 */
export async function applyToProject(
  resources: Resource[],
  platforms: string[],
  projectRoot: string,
  claudeConfig?: ClaudePresetConfig,
): Promise<ApplyResult[]> {
  const results = await generateFiles(resources, platforms, projectRoot, claudeConfig);

  for (const result of results) {
    writeFiles(result.files, projectRoot);
  }

  return results;
}
