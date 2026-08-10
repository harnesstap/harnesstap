import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  getPluginResources,
  resolvePluginSelector,
} from "../../models/plugin-model.js";
import { getPluginOrigin } from "../../services/plugin-origin.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";

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

  const source = resolvePluginSelector(selector);
  if (!source) {
    process.exitCode = 1;
    ui.danger(`Plugin not found: ${selector}`);
    return;
  }

  if (getPluginOrigin(source.id) === "authored") {
    process.exitCode = 1;
    ui.danger(`${source.name} is already authored; there is nothing to fork.`, {
      hints: [`ht plugin edit ${source.name}`],
    });
    return;
  }

  const name = opts.as ?? `${source.name}-fork`;
  if (getPluginByName(name)) {
    process.exitCode = 1;
    ui.danger(`Plugin ${name} already exists.`, {
      hints: [`ht plugin fork ${source.name} --as <name>`],
    });
    return;
  }

  const fork = createPlugin({
    name,
    version: source.version,
    description: source.description || `Fork of ${source.name}@${source.version}`,
    tags: source.tags,
    ...(source.claude ? { claude: source.claude } : {}),
    ...(source.needs ? { needs: source.needs } : {}),
    origin: "authored",
  });

  // Resource rows are shared, not copied: a fork diverges by attaching and
  // detaching, and editing a resource is a separate, explicit operation.
  for (const resource of getPluginResources(source.id)) {
    addResourceToPlugin(fork.id, resource.id);
  }

  if (format === "json") {
    printJson({
      name: fork.name,
      version: fork.version,
      origin: "authored",
      forked_from: `${source.name}@${source.version}`,
    });
    return;
  }

  ui.success(
    `Forked ${source.name}@${source.version} into ${ui.theme.accent(fork.name)}`,
  );
  ui.hint(`ht plugin edit ${fork.name}`);
}
