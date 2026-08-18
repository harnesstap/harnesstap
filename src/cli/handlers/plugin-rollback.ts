import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { resolvePluginSelector } from "../../models/plugin-model.js";
import { PluginProvenanceError } from "../../services/plugin-origin.js";
import {
  formatPluginRollbackConfirmMessage,
  PluginVersionError,
  rollbackPluginVersion,
} from "../../services/plugin-versioning.js";
import {
  isPromptCancellationError,
  promptForConfirmation,
} from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";

function rollbackConfirmMode(yes?: boolean): "skip" | "prompt" | "require-yes" {
  if (yes) {
    return "skip";
  }
  if (
    process.argv.includes("--no-interactive")
    || process.env.HARNESSTAP_NO_INTERACTIVE === "1"
  ) {
    return "require-yes";
  }
  const ciValue = process.env.CI?.trim().toLowerCase();
  const ciEnabled = Boolean(
    ciValue && ciValue !== "0" && ciValue !== "false" && ciValue !== "no",
  );
  if (ciEnabled) {
    return "require-yes";
  }
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return "prompt";
  }
  return "require-yes";
}

export async function handlePluginRollbackCommand(
  selector: string,
  opts: { to: string; yes?: boolean; format?: string },
): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const head = resolvePluginSelector(selector);
  if (!head) {
    process.exitCode = 1;
    ui.danger(`Plugin not found: ${selector}`);
    return;
  }

  const mode = rollbackConfirmMode(opts.yes);
  const message = formatPluginRollbackConfirmMessage({
    headVersion: head.version,
    frozenVersion: opts.to,
    dirty: head.dirty,
  });
  if (mode === "require-yes") {
    process.exitCode = 1;
    ui.danger("Pass --yes to restore without a prompt.");
    return;
  }
  if (mode === "prompt") {
    try {
      const confirmed = await promptForConfirmation({ message, default: false });
      if (!confirmed) {
        ui.info("Operation cancelled.");
        return;
      }
    } catch (error) {
      if (isPromptCancellationError(error)) {
        ui.info("Operation cancelled.");
        return;
      }
      throw error;
    }
  }

  try {
    const rolled = rollbackPluginVersion({
      selector,
      toVersion: opts.to,
    });
    if (format === "json") {
      printJson(rolled);
      return;
    }
    ui.success(
      `Restored ${rolled.name}@${opts.to} onto ${rolled.version}${rolled.dirty ? "*" : ""}`,
    );
  } catch (err) {
    process.exitCode = 1;
    if (err instanceof PluginProvenanceError) {
      ui.danger(err.message, { hints: err.hints });
      return;
    }
    if (err instanceof PluginVersionError) {
      ui.danger(err.message);
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}
