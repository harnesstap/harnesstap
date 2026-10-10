import type { Plugin } from "../types.js";

export { formatCount, pluralNoun } from "../copy/plurals.js";

export function formatPluginLabel(plugin: Pick<Plugin, "name" | "version">): string {
  return `${plugin.name}@${plugin.version}`;
}
