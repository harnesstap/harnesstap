import {
  isUpdateFrequency,
  isUpdateMode,
  loadUpdateSettings,
  saveUpdateSettings,
  type UpdateFrequency,
  type UpdateMode,
  type UpdateSettings,
} from "../../config/settings.js";
import { getHarnesstapDir } from "../../db/connection.js";
import {
  isPromptCancellationError,
  promptForChoice,
} from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";

export const MODE_LABELS: Record<UpdateMode, string> = {
  off: "Off",
  notify: "Notify only",
  install: "Install automatically",
};

export function describeUpdateSettings(settings: UpdateSettings): string {
  if (settings.mode === "off") return "Plugin updates: off (no background checks).";
  const what = settings.mode === "install"
    ? "install minor and patch versions in range automatically, never a major"
    : "notify only";
  return `Plugin updates: ${what}, checked ${settings.frequency}.`;
}

/** `ht plugin auto-update [--mode] [--frequency]`: show or change the updates settings. */
export async function handlePluginAutoUpdateCommand(opts: {
  mode?: string;
  frequency?: string;
  format?: string;
}): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const patch: Partial<UpdateSettings> = {};
  if (opts.mode !== undefined) {
    if (!isUpdateMode(opts.mode)) {
      process.exitCode = 1;
      ui.danger("--mode must be off, notify or install");
      return;
    }
    patch.mode = opts.mode;
  }
  if (opts.frequency !== undefined) {
    if (!isUpdateFrequency(opts.frequency)) {
      process.exitCode = 1;
      ui.danger("--frequency must be hourly, daily or weekly");
      return;
    }
    patch.frequency = opts.frequency;
  }
  const dir = getHarnesstapDir();
  const changed = Object.keys(patch).length > 0;
  const settings = changed ? saveUpdateSettings(dir, { ...patch, prompted: true }) : loadUpdateSettings(dir);
  if (format === "json") {
    printJson(settings);
    return;
  }
  if (changed) ui.success("Saved.");
  ui.info(describeUpdateSettings(settings));
}

export interface KeepUpToDatePromptDeps {
  interactive: boolean;
  choose: <T extends string>(input: {
    message: string;
    choices: Array<{ name: string; value: T }>;
    default?: T;
  }) => Promise<T>;
  harnesstapDir: string;
}

export function canPromptInteractively(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
    && !process.argv.includes("--no-interactive")
    && process.env.HARNESSTAP_NO_INTERACTIVE !== "1";
}

/**
 * After the first successful `ht plugin update --all`, ask once. Only in an
 * interactive terminal; a cancelled prompt also counts as asked.
 */
export async function maybePromptKeepUpToDate(
  deps: KeepUpToDatePromptDeps = {
    interactive: canPromptInteractively(),
    choose: promptForChoice,
    harnesstapDir: getHarnesstapDir(),
  },
): Promise<UpdateSettings | null> {
  if (!deps.interactive) return null;
  const current = loadUpdateSettings(deps.harnesstapDir);
  if (current.prompted) return null;
  try {
    const mode = await deps.choose<UpdateMode>({
      message: "Keep these up to date?",
      default: current.mode,
      choices: [
        { name: "Notify only (default)", value: "notify" },
        { name: "Install automatically (minor and patch in range, never a major)", value: "install" },
        { name: "Off", value: "off" },
      ],
    });
    let frequency: UpdateFrequency = current.frequency;
    if (mode !== "off") {
      frequency = await deps.choose<UpdateFrequency>({
        message: "How often should HarnessTap check?",
        default: current.frequency,
        choices: [
          { name: "Daily (default)", value: "daily" },
          { name: "Hourly", value: "hourly" },
          { name: "Weekly", value: "weekly" },
        ],
      });
    }
    const saved = saveUpdateSettings(deps.harnesstapDir, { mode, frequency, prompted: true });
    ui.info(`${describeUpdateSettings(saved)} Change it with ht plugin auto-update or in Desktop Settings.`);
    return saved;
  } catch (error) {
    if (!isPromptCancellationError(error)) throw error;
    return saveUpdateSettings(deps.harnesstapDir, { prompted: true });
  }
}
