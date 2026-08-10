import { getPlugin } from "../../models/plugin-model.js";
import type { Plugin } from "../../types.js";
import type { ResourceType } from "../../types.js";
import { buildPluginEditCandidates, type PluginEditRow } from "../plugin-edit.js";
import { promptForInteractivePluginEdit } from "./interactive-plugin-edit.js";

function formatPluginLabel(plugin: Pick<Plugin, "name" | "version">): string {
  return `${plugin.name}@${plugin.version}`;
}

export async function runPluginEditWizard(input: {
  plugin: Plugin;
  typeFilter?: ResourceType;
  search?: string;
  showId?: boolean;
  showAll?: boolean;
}): Promise<PluginEditRow[] | undefined> {
  const initial = buildPluginEditCandidates(input.plugin);
  const result = await promptForInteractivePluginEdit({
    message: `Edit plugin ${formatPluginLabel(input.plugin)}`,
    rows: initial,
    typeFilter: input.typeFilter,
    initialQuery: input.search,
    showId: input.showId,
    showAll: input.showAll,
  });
  return result.rows;
}

export type { PluginEditRow } from "../plugin-edit.js";

export function buildPluginEditSnapshot(pluginName: string): PluginEditRow[] {
  const plugin = getPlugin(pluginName);
  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginName}`);
  }
  return buildPluginEditCandidates(plugin);
}
