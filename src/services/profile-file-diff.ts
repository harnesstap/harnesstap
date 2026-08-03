import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectExpectedManagedFiles,
  type ProfileApplyPreviewScope,
} from "./profile-apply-preview.js";
import { normalizeManagedPath } from "./profile-untracked-resources.js";

export interface ManagedFileDiff {
  path: string;
  absolute_path: string;
  /** Expected content from the profile (last applied / would-apply snapshot). */
  expected: string;
  /** Current on-disk content, or null if the file is missing. */
  current: string | null;
}

function readLiveFile(absolutePath: string): string | null {
  if (!existsSync(absolutePath)) {
    return null;
  }
  try {
    return readFileSync(absolutePath, "utf-8");
  } catch {
    return null;
  }
}

export async function getManagedFileDiff(input: {
  profileSelector: string;
  path: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}): Promise<ManagedFileDiff> {
  const profile = input.profileSelector.trim();
  const requestedPath = normalizeManagedPath(input.path.trim());

  const collected = await collectExpectedManagedFiles({
    profile,
    scope: input.scope,
    ...(input.projectPath ? { projectPath: input.projectPath } : {}),
    ...(input.harness ? { harness: input.harness } : {}),
  });

  if (collected.warning) {
    throw new Error(collected.warning);
  }

  const match = collected.expectedFiles.find((file) => {
    const normalized = normalizeManagedPath(file.path, collected.rootPath);
    return (
      normalized === requestedPath
      || normalizeManagedPath(file.path) === requestedPath
    );
  });

  if (!match) {
    throw new Error(`Path is not a managed file for this profile: ${input.path}`);
  }

  const relativePath = normalizeManagedPath(match.path, collected.rootPath);
  const absolutePath = join(collected.rootPath, relativePath);

  return {
    path: relativePath,
    absolute_path: absolutePath,
    expected: match.content,
    current: readLiveFile(absolutePath),
  };
}
