import type { Plugin } from "../types.js";

export function formatCount(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

export function formatPluginLabel(plugin: Pick<Plugin, "name" | "version">): string {
  return `${plugin.name}@${plugin.version}`;
}
