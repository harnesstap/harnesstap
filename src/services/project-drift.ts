import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getLatestSnapshot } from "../models/snapshot.js";

export type DriftChangeType = "added" | "modified" | "deleted";

export interface DriftFileChange {
  path: string;
  type: DriftChangeType;
  platform?: string;
  resource?: { type: string; name: string };
}

export interface ProjectDriftReport {
  project_root: string;
  snapshot_id: string | null;
  snapshot_label: string | null;
  has_drift: boolean;
  changes: DriftFileChange[];
}

function readProjectFile(projectRoot: string, relativePath: string): string | null {
  const fullPath = join(projectRoot, relativePath);
  if (!existsSync(fullPath)) return null;
  try {
    return readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Compare on-disk project files against the latest apply/sync snapshot.
 */
export function detectProjectDrift(
  projectRoot: string,
  snapshot: { id: string; label: string; state: { platform_files: Record<string, Record<string, string>> } },
): ProjectDriftReport {
  const changes: DriftFileChange[] = [];
  const seen = new Set<string>();

  for (const [platformId, files] of Object.entries(snapshot.state.platform_files)) {
    for (const [relativePath, expectedContent] of Object.entries(files)) {
      seen.add(relativePath);
      const current = readProjectFile(projectRoot, relativePath);
      if (current === null) {
        changes.push({ path: relativePath, type: "deleted", platform: platformId });
        continue;
      }
      if (current !== expectedContent) {
        changes.push({ path: relativePath, type: "modified", platform: platformId });
      }
    }
  }

  return {
    project_root: projectRoot,
    snapshot_id: snapshot.id,
    snapshot_label: snapshot.label,
    has_drift: changes.length > 0,
    changes,
  };
}

export function detectProjectDriftFromLatest(
  projectRoot: string,
  projectId: string,
): ProjectDriftReport | null {
  const snapshot = getLatestSnapshot(projectId);
  if (!snapshot) {
    return {
      project_root: projectRoot,
      snapshot_id: null,
      snapshot_label: null,
      has_drift: false,
      changes: [],
    };
  }
  return detectProjectDrift(projectRoot, snapshot);
}
