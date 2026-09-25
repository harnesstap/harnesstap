import { existsSync } from "node:fs";
import type { ResourceCreateInput } from "../types.js";
import { listCursorPluginInstalls } from "./providers/cursor.js";
import { dedupePluginInstalls, pluginInstallToPinInput } from "./host-plugin-pins.js";

const CURSOR_PLUGINS_SOURCE = "~/.cursor/plugins/";

export function getInstalledCursorPluginInstallPath(
  homeRoot: string,
  ref: string,
): string | null {
  const install = dedupePluginInstalls(listCursorPluginInstalls(homeRoot)).find(
    (row) => row.ref === ref,
  );
  if (!install?.installPath || !existsSync(install.installPath)) {
    return null;
  }
  return install.installPath;
}

export function listCursorPluginPinCreateInputs(
  homeRoot: string,
): ResourceCreateInput[] {
  return dedupePluginInstalls(listCursorPluginInstalls(homeRoot))
    .filter(
      (install) =>
        Boolean(install.installPath) && existsSync(install.installPath as string),
    )
    .map((install) => pluginInstallToPinInput(install, CURSOR_PLUGINS_SOURCE));
}
