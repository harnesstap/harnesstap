import { resolve } from "node:path";
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { readLockfile } from "../../services/lockfile.js";
import { resolveComposition } from "../../services/resolve/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { ui } from "../../ui/index.js";

export interface PluginWhyOptions {
  project?: string;
  root?: string;
  format?: string;
}

export function handlePluginWhyCommand(
  target: string,
  opts: PluginWhyOptions = {},
): void {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const projectRoot = resolve(opts.project ?? ".");

  const lock = readLockfile(projectRoot);
  const rootName = opts.root ?? lock?.root;
  if (!rootName) {
    process.exitCode = 1;
    ui.danger("No lockfile found and no --root given.", {
      hints: ["ht apply <plugin>", "ht plugin why <target> --root <plugin>"],
    });
    return;
  }

  const resolution = resolveComposition({ rootSelectors: [rootName] });

  if (target.includes(":")) {
    const decision = resolution.decisions.find((entry) => entry.key === target);
    if (!decision) {
      process.exitCode = 1;
      ui.danger(`No resolved resource named ${target} in ${rootName}.`);
      return;
    }
    if (format === "json") {
      printJson({ kind: "resource", ...decision, root: rootName });
      return;
    }
    console.log(
      `${target} → ${decision.winner.pluginName}@${decision.winner.pluginVersion} (${decision.reason})`,
    );
    for (const loser of decision.losers) {
      console.log(
        ui.theme.muted(
          `  lost: ${loser.pluginName}@${loser.pluginVersion} (depth ${loser.depth})`,
        ),
      );
    }
    return;
  }

  const plugin = resolution.selected.find((entry) => entry.name === target);
  if (!plugin) {
    process.exitCode = 1;
    ui.danger(`${target} is not part of the resolved set for ${rootName}.`);
    return;
  }

  const locked =
    plugin.depth === 0
      ? lock?.root === plugin.name
      : (lock?.plugins.some(
          (entry) => entry.name === plugin.name && entry.version === plugin.version,
        ) ?? false);

  if (format === "json") {
    printJson({
      kind: "plugin",
      name: plugin.name,
      version: plugin.version,
      depth: plugin.depth,
      reason: plugin.reason,
      path: plugin.path,
      constraints: plugin.constraints.map((record) => ({
        requirer: record.requirer,
        constraint: record.constraint,
      })),
      locked,
      root: rootName,
    });
    return;
  }

  console.log(`${plugin.name}@${plugin.version}  ${ui.theme.muted(plugin.reason)}`);
  console.log(ui.theme.muted(`  path: ${plugin.path.join(" → ")}`));
  for (const record of plugin.constraints) {
    console.log(
      ui.theme.muted(
        `  ${record.requirer} → ${plugin.name} ${record.constraint || "*"}`,
      ),
    );
  }
  if (!locked) {
    ui.warn("This selection is not in the lockfile. Run `ht apply` to record it.");
  }
}
