import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { forkPlugin, PluginForkError } from "../../services/plugin-fork.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { formatCommand } from "../shared.js";

export interface PluginForkOptions {
  as?: string;
  format?: string;
}

export function handlePluginForkCommand(
  selector: string,
  opts: PluginForkOptions = {},
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);

  let result: ReturnType<typeof forkPlugin>;
  try {
    result = forkPlugin(selector, opts.as);
  } catch (error) {
    process.exitCode = 1;
    if (error instanceof PluginForkError) {
      const sourceName = error.sourceName ?? selector;
      if (error.code === "already_authored") {
        ui.danger(error.message, { hints: [formatCommand(["plugin", "edit", sourceName])] });
        return;
      }
      if (error.code === "plugin_exists") {
        ui.danger(error.message, {
          hints: [`${formatCommand(["plugin", "fork", sourceName])} --as <name>`],
        });
        return;
      }
    }
    ui.danger(error instanceof Error ? error.message : String(error));
    return;
  }

  const { plugin, source, forked_from, upstream } = result;
  if (format === "json") {
    printJson({
      name: plugin.name,
      version: plugin.version,
      origin: "authored",
      forked_from,
      upstream,
    });
    return;
  }

  ui.success(
    `Forked ${source.name}@${source.version} into ${ui.theme.accent(plugin.name)}`,
  );
  ui.hint(formatCommand(["plugin", "edit", plugin.name]));
}
