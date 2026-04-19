import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { ClaudeCodeSerializer } from "../platforms/claude-code.js";
import { CursorSerializer } from "../platforms/cursor.js";
import { CodexSerializer } from "../platforms/codex.js";
import { OpenCodeSerializer } from "../platforms/opencode.js";
import { CopilotSerializer } from "../platforms/copilot.js";
import { GenericAgentsSerializer } from "../platforms/generic-agents.js";
import type { PlatformSerializer, Resource, SerializedFile } from "../types.js";

function getSerializer(platformId: string): PlatformSerializer {
  switch (platformId) {
    case "claude-code":
      return new ClaudeCodeSerializer();
    case "cursor":
      return new CursorSerializer();
    case "codex":
      return new CodexSerializer();
    case "opencode":
      return new OpenCodeSerializer();
    case "github-copilot":
    case "copilot-cli":
      return new CopilotSerializer(platformId as any);
    default:
      return new GenericAgentsSerializer(platformId);
  }
}

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
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];

  for (const pid of platforms) {
    const serializer = getSerializer(pid);
    const files = await serializer.serialize(resources, projectRoot);
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
): Promise<ApplyResult[]> {
  const results = await generateFiles(resources, platforms, projectRoot);

  for (const result of results) {
    writeFiles(result.files, projectRoot);
  }

  return results;
}
