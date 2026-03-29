import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAllPlatforms } from "../platforms/registry.js";
import { ClaudeCodeSerializer } from "../platforms/claude-code.js";
import { CursorSerializer } from "../platforms/cursor.js";
import { CodexSerializer } from "../platforms/codex.js";
import { GenericAgentsSerializer } from "../platforms/generic-agents.js";
import type { PlatformSerializer, Resource } from "../types.js";
import { createResource } from "../models/resource.js";

// ── Serializer factory ─────────────────────────────────────────────────

function getSerializer(platformId: string): PlatformSerializer {
  switch (platformId) {
    case "claude-code":
      return new ClaudeCodeSerializer();
    case "cursor":
      return new CursorSerializer();
    case "codex":
      return new CodexSerializer();
    default:
      return new GenericAgentsSerializer(platformId);
  }
}

// ── Platform detection ─────────────────────────────────────────────────

/** Check if a platform has any recognizable files in the project. */
function platformHasFiles(platformId: string, projectRoot: string): boolean {
  const platform = getAllPlatforms().find((p) => p.id === platformId);
  if (!platform) return false;

  const pathsToCheck = Object.values(platform.projectPaths).filter(Boolean) as string[];

  for (const p of pathsToCheck) {
    const fullPath = join(projectRoot, p);
    if (existsSync(fullPath)) return true;
  }

  return false;
}

/** Detect all platforms with configuration in a project directory. */
export function detectPlatforms(projectRoot: string): string[] {
  return getAllPlatforms()
    .filter((p) => platformHasFiles(p.id, projectRoot))
    .map((p) => p.id);
}

// ── Scanning ───────────────────────────────────────────────────────────

export interface ScanResult {
  platformId: string;
  resources: Omit<Resource, "id" | "created_at" | "updated_at">[];
}

/** Scan a single platform in a project directory. */
export async function scanPlatform(
  platformId: string,
  projectRoot: string,
): Promise<ScanResult> {
  const serializer = getSerializer(platformId);
  const resources = await serializer.scan(projectRoot);
  return { platformId, resources };
}

/** Scan all detected platforms in a project directory. */
export async function scanProject(
  projectRoot: string,
  platformFilter?: string,
): Promise<ScanResult[]> {
  const platforms = platformFilter
    ? [platformFilter]
    : detectPlatforms(projectRoot);

  const results: ScanResult[] = [];
  for (const pid of platforms) {
    results.push(await scanPlatform(pid, projectRoot));
  }
  return results;
}

/**
 * Scan and persist: scan all platforms and save unique resources to the database.
 * Deduplicates by name+type to avoid re-importing the same resource.
 */
export async function scanAndPersist(
  projectRoot: string,
  platformFilter?: string,
): Promise<Resource[]> {
  const results = await scanProject(projectRoot, platformFilter);
  const seen = new Set<string>();
  const persisted: Resource[] = [];

  for (const result of results) {
    for (const r of result.resources) {
      const key = `${r.type}:${r.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const saved = createResource({
        type: r.type,
        name: r.name,
        description: r.description,
        content: r.content,
        metadata: r.metadata,
        source: r.source,
      });
      persisted.push(saved);
    }
  }

  return persisted;
}
