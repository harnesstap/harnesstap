import { lstatSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  classifyManagedPathOwnership,
  hashFileOrLink,
  hashOnDiskFile,
  isSymlinkPath,
} from "../safe-file-removal.js";
import type { KeptHostPluginViewReason } from "./host-plugin-view-policy.js";
import { readHostPluginViewRecord } from "./host-plugin-views.js";

/**
 * Who owns one file of a host plugin cache folder: `owned` when HarnessTap
 * wrote it and it is unchanged since, `modified` when HarnessTap wrote it and
 * it changed since, `unmanaged` when HarnessTap did not write it.
 */
export function hostViewFileOwnership(input: {
  homeRoot: string;
  hostView: string;
  path: string;
  recorded: Record<string, string>;
}): "owned" | KeptHostPluginViewReason {
  const absolute = join(input.hostView, input.path);
  const recorded = input.recorded[input.path];
  if (recorded) {
    if (recorded === hashFileOrLink(absolute)) return "owned";
    // Records from before links were kept as links hold the linked bytes.
    if (isSymlinkPath(absolute) && recorded === hashOnDiskFile(absolute)) return "owned";
    return "modified";
  }
  const fromHome = relative(input.homeRoot, absolute).split(sep).join("/");
  const ownership = classifyManagedPathOwnership(input.homeRoot, fromHome);
  return ownership === "unowned" ? "unmanaged" : ownership;
}

/** Why a host plugin folder removal was refused. */
export type RefusedHostPluginViewRemoval = {
  path: string;
  /** `folder`: a real folder HarnessTap did not create; `unmanaged`: a file HarnessTap did not write. */
  reason: "folder" | "unmanaged";
};

/**
 * Split host plugin folder paths (inside `hostView`) into those HarnessTap
 * may back up and remove and those it never removes, even with
 * --force-remove: real folders, and files HarnessTap did not write. Every
 * removal in a host plugin folder goes through this check.
 */
export function planHostPluginViewRemovals(input: {
  homeRoot: string;
  hostView: string;
  paths: readonly string[];
}): { allowed: string[]; refused: RefusedHostPluginViewRemoval[] } {
  const recorded = { ...(readHostPluginViewRecord(input.hostView)?.files ?? {}) };
  const allowed: string[] = [];
  const refused: RefusedHostPluginViewRemoval[] = [];
  for (const path of input.paths) {
    let isDirectory = false;
    try {
      isDirectory = lstatSync(join(input.hostView, path)).isDirectory();
    } catch {
      // Missing: nothing to remove, the removal skips it.
      allowed.push(path);
      continue;
    }
    if (isDirectory) {
      refused.push({ path, reason: "folder" });
      continue;
    }
    const ownership = hostViewFileOwnership({ homeRoot: input.homeRoot, hostView: input.hostView, path, recorded });
    if (ownership === "unmanaged") {
      refused.push({ path, reason: "unmanaged" });
      continue;
    }
    allowed.push(path);
  }
  return { allowed, refused };
}
