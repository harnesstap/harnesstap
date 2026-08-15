import type { ApplyPluginScope } from "./api/apply-plugin";

export function applyPluginDialogTitle(pluginName: string): string {
  return `Apply ${pluginName}`;
}

export function applyPluginHelperCopy(): string {
  return "Materialize a library plugin graph without switching the active profile. Profile switch stays on Apply in the profiles list.";
}

export function applyPluginProfileGlobalWarning(
  isProfile: boolean,
  scope: ApplyPluginScope,
): string | null {
  if (!isProfile || scope !== "home") {
    return null;
  }
  return "This plugin is tagged profile. Applying it to Global records it as the active profile (same as CLI ht apply --global). Everyday switches belong on Apply in the Global/Project rail.";
}

export function applyPluginProjectMissing(
  scope: ApplyPluginScope,
  projectPath: string | null | undefined,
): boolean {
  return scope === "project" && !projectPath?.trim();
}
