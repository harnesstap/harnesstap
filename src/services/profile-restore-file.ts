import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  collectExpectedManagedFiles,
  type ProfileApplyPreviewScope,
} from "./profile-apply-preview.js";
import { normalizeManagedPath } from "./profile-untracked-resources.js";

export async function restoreManagedFile(input: {
  profileSelector: string;
  path: string;
  scope: ProfileApplyPreviewScope;
  projectPath?: string;
  harness?: string;
}): Promise<{ path: string; absolute_path: string }> {
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

  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, match.content, "utf-8");

  return { path: relativePath, absolute_path: absolutePath };
}
