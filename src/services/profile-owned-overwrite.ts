import { resolveHomeRoot } from "../utils/home-root.js";
import {
  planMaterializationConflicts,
  type MaterializationConflict,
} from "./applier.js";
import { applyProfilePlugin, type ApplyProfilePluginOptions } from "./profile-apply.js";

export interface OwnedOverwriteConflictSummary {
  paths: string[];
  conflicts: Array<{
    path: string;
    owners: Array<{
      snapshot_id: string;
      platform_id: string;
      plugin_name: string;
      plugin_version?: string;
    }>;
  }>;
}

function summarizeOwnedConflicts(
  conflicts: MaterializationConflict[],
): OwnedOverwriteConflictSummary {
  const owned = conflicts.filter((conflict) => conflict.owners.length > 0);
  return {
    paths: owned.map((conflict) => conflict.path),
    conflicts: owned.map((conflict) => ({
      path: conflict.path,
      owners: conflict.owners.map((owner) => ({
        snapshot_id: owner.snapshot_id,
        platform_id: owner.platform_id,
        plugin_name: owner.plugin_name,
        ...(owner.plugin_version ? { plugin_version: owner.plugin_version } : {}),
      })),
    })),
  };
}

export async function detectProfileOwnedOverwriteConflicts(
  selector: string,
  options: Pick<ApplyProfilePluginOptions, "harness" | "pull"> = {},
): Promise<OwnedOverwriteConflictSummary> {
  const preview = await applyProfilePlugin(selector, {
    ...options,
    dryRun: true,
    conflictPolicy: "prompt",
    pull: options.pull ?? false,
  });

  if (!preview.expected_files || preview.expected_files.length === 0) {
    return { paths: [], conflicts: [] };
  }

  const homeRoot = resolveHomeRoot();
  const planned = await planMaterializationConflicts(
    preview.expected_files.map((file) => ({
      path: file.path,
      content: file.content,
    })),
    homeRoot,
  );

  return summarizeOwnedConflicts(planned);
}
