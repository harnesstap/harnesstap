import type { ApplyPluginScope } from "./api/apply-plugin";

export function applyPluginDialogTitle(pluginName: string): string {
  return `Apply ${pluginName}`;
}

export function applyPluginHelperCopy(): string {
  return "Apply this plugin without switching the active profile.";
}

export function applyPluginProfileGlobalWarning(
  isProfile: boolean,
  scope: ApplyPluginScope,
): string | null {
  if (!isProfile || scope !== "home") {
    return null;
  }
  return "This plugin is tagged profile. Global apply records it as the active profile.";
}

export function applyPluginProjectMissing(
  scope: ApplyPluginScope,
  projectPath: string | null | undefined,
): boolean {
  return scope === "project" && !projectPath?.trim();
}
