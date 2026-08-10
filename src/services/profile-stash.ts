import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";
import { isEmptyBuiltinProfile } from "../constants/profile.js";
import { getHarnesstapDir } from "../db/connection.js";
import { getActiveProfileName } from "./active-profile.js";
import type { ApplyProfilePluginOptions } from "./profile-apply.js";
import { withProfileApplyLock } from "./profile-apply-lock.js";
import {
  buildProfileContents,
  type ProfileContents,
} from "./profile-contents.js";
import type { DriftFileChange } from "./project-drift.js";
import {
  buildContentsFromResources,
  captureUntrackedResourcesForStash,
  removeUntrackedStashFiles,
  restoreUntrackedStashFiles,
  stashedFilesToDriftChanges,
  type StashedFileSnapshot,
} from "./profile-untracked-resources.js";
import { resolveHomeRoot } from "../utils/home-root.js";

export interface ProfileStashEntry {
  id: string;
  profile_name: string;
  created_at: string;
  contents: ProfileContents;
  file_changes: DriftFileChange[];
  stashed_files: StashedFileSnapshot[];
}

interface ProfileStashFile {
  entries: ProfileStashEntry[];
}

export class ProfileStashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileStashError";
  }
}

function emptyProfileContents(): ProfileContents {
  return {
    plugins: [],
    stack_resource_count: 0,
    stack_summary: null,
    type_counts: {},
    resources: [],
    plugin_pins: [],
    mcp_servers: [],
  };
}

function getProfileStashPath(): string {
  return join(getHarnesstapDir(), "profile-stash.json");
}

function isProfileContents(value: unknown): value is ProfileContents {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ProfileContents>;
  return Array.isArray(candidate.resources);
}

function isStashedFileSnapshot(value: unknown): value is StashedFileSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<StashedFileSnapshot>;
  return typeof candidate.path === "string" && typeof candidate.content === "string";
}

function hydrateStashEntry(raw: unknown): ProfileStashEntry | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const entry = raw as Partial<ProfileStashEntry>;
  if (
    typeof entry.id !== "string"
    || typeof entry.profile_name !== "string"
    || typeof entry.created_at !== "string"
  ) {
    return null;
  }

  const contents = isProfileContents(entry.contents)
    ? entry.contents
    : buildProfileContents(entry.profile_name) ?? emptyProfileContents();
  const fileChanges = Array.isArray(entry.file_changes)
    ? entry.file_changes.filter(
        (change): change is DriftFileChange =>
          typeof change === "object"
          && change !== null
          && typeof (change as DriftFileChange).path === "string"
          && typeof (change as DriftFileChange).type === "string",
      )
    : [];
  const stashedFiles = Array.isArray(entry.stashed_files)
    ? entry.stashed_files.filter(isStashedFileSnapshot)
    : [];

  return {
    id: entry.id,
    profile_name: entry.profile_name,
    created_at: entry.created_at,
    contents,
    file_changes: fileChanges,
    stashed_files: stashedFiles,
  };
}

function readProfileStashFile(): ProfileStashFile {
  const filePath = getProfileStashPath();
  if (!existsSync(filePath)) {
    return { entries: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<ProfileStashFile>;
    if (!Array.isArray(parsed.entries)) {
      return { entries: [] };
    }
    const entries = parsed.entries
      .map((entry) => hydrateStashEntry(entry))
      .filter((entry): entry is ProfileStashEntry => entry !== null);
    return { entries };
  } catch {
    return { entries: [] };
  }
}

function writeProfileStashFile(file: ProfileStashFile): void {
  const home = getHarnesstapDir();
  mkdirSync(home, { recursive: true });
  writeFileSync(
    getProfileStashPath(),
    `${JSON.stringify(file, null, 2)}\n`,
    "utf-8",
  );
}

export function listProfileStashEntries(): ProfileStashEntry[] {
  return readProfileStashFile().entries;
}

function pushProfileStashEntry(input: {
  profile_name: string;
  contents: ProfileContents;
  file_changes: DriftFileChange[];
  stashed_files: StashedFileSnapshot[];
}): ProfileStashEntry {
  const file = readProfileStashFile();
  const entry: ProfileStashEntry = {
    id: ulid(),
    profile_name: input.profile_name,
    created_at: new Date().toISOString(),
    contents: input.contents,
    file_changes: input.file_changes,
    stashed_files: input.stashed_files,
  };
  file.entries.unshift(entry);
  writeProfileStashFile(file);
  return entry;
}

function popProfileStashEntry(): ProfileStashEntry | undefined {
  const file = readProfileStashFile();
  const entry = file.entries.shift();
  if (entry) {
    writeProfileStashFile(file);
  }
  return entry;
}

function peekProfileStashEntry(): ProfileStashEntry | undefined {
  return readProfileStashFile().entries[0];
}

function resolveStashableActiveProfile(): string {
  const activeProfile = getActiveProfileName();
  if (!activeProfile) {
    throw new ProfileStashError(
      "No active profile to stash. Set one with profile use <name> first.",
    );
  }
  if (isEmptyBuiltinProfile(activeProfile)) {
    throw new ProfileStashError(
      'Legacy active profile "empty" has no stashable state. Run profile use <name>, then profile stash.',
    );
  }
  return activeProfile;
}

export interface StashClearedUntrackedResult {
  dry_run: boolean;
  profile_name: string;
  removed_files: string[];
}

export interface StashProfileResult {
  entry: ProfileStashEntry;
  cleared: StashClearedUntrackedResult;
}

export async function stashProfileCommand(
  options: ApplyProfilePluginOptions,
): Promise<StashProfileResult> {
  return withProfileApplyLock(async () => {
    const profileName = resolveStashableActiveProfile();
    let capture: Awaited<ReturnType<typeof captureUntrackedResourcesForStash>>;
    try {
      capture = await captureUntrackedResourcesForStash({
        profileSelector: profileName,
        harness: options.harness,
      });
    } catch (error) {
      throw new ProfileStashError(
        error instanceof Error ? error.message : String(error),
      );
    }

    const homeRoot = resolveHomeRoot();
    const contents = buildContentsFromResources(capture.resources);
    const fileChanges = stashedFilesToDriftChanges(capture.files);
    const removedFiles = removeUntrackedStashFiles(
      homeRoot,
      capture.files,
      options.dryRun,
    );

    if (options.dryRun) {
      return {
        entry: {
          id: "dry-run",
          profile_name: profileName,
          created_at: new Date().toISOString(),
          contents,
          file_changes: fileChanges,
          stashed_files: capture.files,
        },
        cleared: {
          dry_run: true,
          profile_name: profileName,
          removed_files: removedFiles,
        },
      };
    }

    const entry = pushProfileStashEntry({
      profile_name: profileName,
      contents,
      file_changes: fileChanges,
      stashed_files: capture.files,
    });

    return {
      entry,
      cleared: {
        dry_run: false,
        profile_name: profileName,
        removed_files: removedFiles,
      },
    };
  });
}

export interface RestoreStashedUntrackedResult {
  dry_run: boolean;
  profile_name: string;
  restored_files: string[];
  cancelled: boolean;
}

export interface RestoreProfileStashResult {
  entry: ProfileStashEntry;
  restored: RestoreStashedUntrackedResult;
  removed: boolean;
}

export async function popProfileStashCommand(
  options: ApplyProfilePluginOptions,
): Promise<RestoreProfileStashResult> {
  return withProfileApplyLock(async () => {
    const entry = popProfileStashEntry();
    if (!entry) {
      throw new ProfileStashError("No stashed profile to restore.");
    }
    const homeRoot = resolveHomeRoot();
    const restoredFiles = restoreUntrackedStashFiles(
      homeRoot,
      entry.stashed_files,
      options.dryRun,
    );
    return {
      entry,
      restored: {
        dry_run: options.dryRun === true,
        profile_name: entry.profile_name,
        restored_files: restoredFiles,
        cancelled: false,
      },
      removed: true,
    };
  });
}

export async function applyProfileStashCommand(
  options: ApplyProfilePluginOptions,
): Promise<RestoreProfileStashResult> {
  return withProfileApplyLock(async () => {
    const entry = peekProfileStashEntry();
    if (!entry) {
      throw new ProfileStashError("No stashed profile to restore.");
    }
    const homeRoot = resolveHomeRoot();
    const restoredFiles = restoreUntrackedStashFiles(
      homeRoot,
      entry.stashed_files,
      options.dryRun,
    );
    return {
      entry,
      restored: {
        dry_run: options.dryRun === true,
        profile_name: entry.profile_name,
        restored_files: restoredFiles,
        cancelled: false,
      },
      removed: false,
    };
  });
}
