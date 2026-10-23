import { relative, sep } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import { parsePluginRef } from "../plugins/claude-installed.js";
import { parseDependencyRef } from "./plugin-dependency.js";
import { peekMarketplacePinSource } from "./marketplace-pin-cache.js";
import { planHostPluginViewMirror } from "./package-cache/host-plugin.js";
import { recordBlockedHostPluginViewFiles } from "./package-cache/host-plugin-view-policy.js";
import type { SafeRemovalSkip } from "./safe-file-removal.js";

/** What an apply would change in the host plugin cache folders of its marketplace pins. Paths are relative to the home folder. */
export interface HostPluginFoldersPlan {
  write: string[];
  remove: string[];
  kept: SafeRemovalSkip[];
}

/**
 * Plan the host plugin cache folder writes the real apply makes while it
 * installs the pinned marketplace plugins, without changing anything. It
 * follows the same plan as the install (`planHostPluginViewMirror`) for each
 * pin the stored marketplace catalog and checkout can answer, and records the
 * files it could not write like the real apply, so a dry run reports the same
 * blocked paths and exits the same way. Pins that need a download are left
 * out: what they bring is not known before they are fetched.
 */
export function planHostPluginFoldersForPins(input: {
  homeRoot: string;
  pins: ReadonlyArray<{ ref: string; version_constraint: string }>;
  harnesstapDir?: string;
}): HostPluginFoldersPlan {
  const harnesstapDir = input.harnesstapDir ?? getHarnesstapDir();
  const plan: HostPluginFoldersPlan = { write: [], remove: [], kept: [] };
  for (const pin of input.pins) {
    if (parseDependencyRef(pin.ref).source_kind !== "marketplace") continue;
    const { name, marketplace } = parsePluginRef(pin.ref);
    if (!marketplace) continue;
    const source = peekMarketplacePinSource({
      originRef: pin.ref,
      versionConstraint: pin.version_constraint,
      harnesstapDir,
    });
    if (!source) continue;
    const { version, canonicalDir } = source;
    const mirror = planHostPluginViewMirror({
      homeRoot: input.homeRoot,
      marketplace,
      pluginName: name,
      version,
      canonicalDir,
    });
    if (!mirror) continue;
    const fromHome = (path: string) =>
      relative(input.homeRoot, `${mirror.hostView}${sep}${path}`).split(sep).join("/");
    plan.write.push(...mirror.add.map(fromHome), ...mirror.replace.map(fromHome));
    plan.remove.push(...mirror.remove.map(fromHome));
    for (const file of mirror.kept) {
      const path = fromHome(file.path);
      plan.kept.push({
        path,
        reason: file.reason,
        message: `Kept ${path} (${file.reason === "modified" ? "changed since HarnessTap wrote it" : "not made by HarnessTap"}).`,
      });
    }
    recordBlockedHostPluginViewFiles({ hostView: mirror.hostView, files: mirror.blocked });
  }
  return plan;
}
