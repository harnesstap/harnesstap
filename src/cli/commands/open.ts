import type { Command } from "commander";
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { missingRequiredArg } from "../../services/cli-errors.js";
import {
  COMMAND_HELP_REGISTRY,
} from "../../services/cli-help-registry.js";
import * as openPath from "../../services/open-path.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { ui } from "../../ui/index.js";
import { renderCliError } from "../runtime.js";

export function registerOpenCommand(root: Command): void {
  COMMAND_HELP_REGISTRY.open = {
    description: "Open a file or directory in your system editor",
    examples: [
      "open ~/.claude/CLAUDE.md",
      "open .",
      "open --format json ./AGENTS.md",
    ],
  };

  root
    .command("open")
    .argument("[path]", "File or directory to open")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Open a file or directory in your system editor")
    .action(async (path: string | undefined, opts: { format?: string }) => {
      if (!path?.trim()) {
        process.exitCode = 1;
        renderCliError(missingRequiredArg("path", "open"));
        return;
      }

      const db = getDb();
      initializeSchema(db);

      try {
        const resolvedPath = openPath.resolveOpenableFilesystemPath(path);
        openPath.openPathInSystemEditor(resolvedPath);
        if (parseOutputFormat(opts.format) === "json") {
          printJson({ path: resolvedPath });
          return;
        }
        ui.success(`Opened ${resolvedPath}`);
      } catch (error) {
        process.exitCode = 1;
        ui.danger(error instanceof Error ? error.message : String(error));
      }
    });
}
