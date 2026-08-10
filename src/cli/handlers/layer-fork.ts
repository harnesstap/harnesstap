import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import {
  addResourceToLayer,
  createLayer,
  getLayerByName,
  getLayerResources,
  resolveLayerSelector,
} from "../../models/plugin-model.js";
import { getLayerOrigin } from "../../services/layer-origin.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";

export interface LayerForkOptions {
  as?: string;
  format?: string;
}

export function handleLayerForkCommand(
  selector: string,
  opts: LayerForkOptions = {},
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);

  const source = resolveLayerSelector(selector);
  if (!source) {
    process.exitCode = 1;
    ui.danger(`Layer not found: ${selector}`);
    return;
  }

  if (getLayerOrigin(source.id) === "authored") {
    process.exitCode = 1;
    ui.danger(`${source.name} is already authored; there is nothing to fork.`, {
      hints: [`ht layer edit ${source.name}`],
    });
    return;
  }

  const name = opts.as ?? `${source.name}-fork`;
  if (getLayerByName(name)) {
    process.exitCode = 1;
    ui.danger(`Layer ${name} already exists.`, {
      hints: [`ht layer fork ${source.name} --as <name>`],
    });
    return;
  }

  const fork = createLayer({
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
  for (const resource of getLayerResources(source.id)) {
    addResourceToLayer(fork.id, resource.id);
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
  ui.hint(`ht layer edit ${fork.name}`);
}
