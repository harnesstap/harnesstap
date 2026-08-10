#!/usr/bin/env bun
/**
 * Throwaway codemod for the layer → plugin rename. Deleted at the end of the
 * rename stage. Run against one directory at a time and review the diff.
 *
 *   bun scripts/rename-layer-to-plugin.ts src/models
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Glob } from "bun";

const SKIP_PATH = [
  "node_modules",
  "dist",
  ".git",
  "apps/desktop/src-tauri/target",
  "apps/desktop/src-tauri/gen",
  "bun.lock",
  "Cargo.lock",
  "CHANGELOG.md",
  ".changes/v0.1.0.md",
];

/**
 * Ordered: longer and more specific patterns first, so `layerId` is not first
 * mangled into `layer Id` by a bare-word rule.
 */
const RULES: Array<[RegExp, string]> = [
  [/layer_resources/g, "plugin_resources"],
  [/layer_working_snapshots/g, "plugin_working_snapshots"],
  [/layer_ids/g, "plugin_ids"],
  [/layer_id/g, "plugin_id"],
  [/layerIds/g, "pluginIds"],
  [/layerId/g, "pluginId"],
  [/LayerId/g, "PluginId"],
  [/layerName/g, "pluginName"],
  [/LayerName/g, "PluginName"],
  [/layerSelector/g, "pluginSelector"],
  [/LayerSelector/g, "PluginSelector"],
  [/LAYER_/g, "PLUGIN_"],
  [/_LAYER/g, "_PLUGIN"],
  [/Layers/g, "Plugins"],
  [/Layer/g, "Plugin"],
  [/layers/g, "plugins"],
  [/layer/g, "plugin"],
  [/LAYERS/g, "PLUGINS"],
  [/LAYER/g, "PLUGIN"],
];

/** Substrings that must survive untouched; restored after substitution. */
const PRESERVE = ["IPC plugin", "presentation plugin", "transport plugin"];

function transform(source: string): string {
  let output = source;
  for (const [pattern, replacement] of RULES) {
    output = output.replace(pattern, replacement);
  }
  for (const phrase of PRESERVE) {
    output = output.replaceAll(phrase, phrase.replace("plugin", "layer"));
  }
  return output;
}

const root = process.argv[2];
if (!root) {
  console.error("usage: bun scripts/rename-layer-to-plugin.ts <dir>");
  process.exit(1);
}

let changed = 0;
for await (const file of new Glob("**/*.{ts,tsx,md,json,yaml,yml,tape,css}").scan({
  cwd: root,
  absolute: true,
})) {
  if (SKIP_PATH.some((skip) => file.includes(skip))) continue;
  const before = readFileSync(file, "utf8");
  const after = transform(before);
  if (before !== after) {
    writeFileSync(file, after, "utf8");
    changed += 1;
  }
}
console.log(`rewrote ${changed} files under ${root}`);
