import {
  type KeptHostPluginViewFiles,
  replaceKeptHostPluginViewFiles,
  takeKeptHostPluginViewFiles,
} from "../../services/package-cache/host-plugin.js";
import { promptForConfirmation } from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { shortenHomePath } from "../../utils/home-path.js";
import { formatCount } from "../formatting.js";
import { canPromptInteractively } from "./plugin-auto-update.js";

const LISTED_FILES = 5;

export interface SettleKeptHostPluginViewDeps {
  interactive: boolean;
  confirm: (input: { message: string; default?: boolean }) => Promise<boolean>;
  take: () => KeptHostPluginViewFiles[];
  replace: (entry: KeptHostPluginViewFiles) => string[];
}

function defaultDeps(): SettleKeptHostPluginViewDeps {
  return {
    interactive: canPromptInteractively(),
    confirm: promptForConfirmation,
    take: takeKeptHostPluginViewFiles,
    replace: replaceKeptHostPluginViewFiles,
  };
}

function describeFiles(entry: KeptHostPluginViewFiles): string {
  const listed = entry.files.slice(0, LISTED_FILES).map((file) =>
    `${file.path} (${file.reason === "modified" ? "changed since HarnessTap wrote it" : "not written by HarnessTap"})`,
  );
  const more = entry.files.length - listed.length;
  return more > 0 ? `${listed.join(", ")}, and ${more} more` : listed.join(", ");
}

/**
 * A host plugin refresh keeps files in `~/.claude/plugins/cache/...` that
 * HarnessTap did not write or that changed since. Ask before replacing them
 * in a terminal; otherwise say they were kept and how to replace them.
 */
export async function settleKeptHostPluginViewFiles(
  options: { json?: boolean } = {},
  deps: SettleKeptHostPluginViewDeps = defaultDeps(),
): Promise<void> {
  for (const entry of deps.take()) {
    const where = shortenHomePath(entry.hostView);
    const count = formatCount(entry.files.length, "file");
    if (deps.interactive && !options.json) {
      ui.warn(`${where}: the plugin update would replace ${count}: ${describeFiles(entry)}.`);
      const confirmed = await deps.confirm({
        message: `Back up and replace ${count} in ${where} with the plugin's files?`,
        default: false,
      });
      if (confirmed) {
        deps.replace(entry);
        ui.success(`Replaced ${count} in ${where}. The old files are in the HarnessTap trash.`);
        continue;
      }
    }
    // stderr, so --format json output stays clean.
    console.error(
      `Kept ${count} in ${where} that the plugin update would replace: ${describeFiles(entry)}. To back them up and replace them, run the command again with --force-remove.`,
    );
  }
}
