import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadInstalled, parsePluginRef } from "../plugins/claude-installed.js";
import { findInstalledRefForCatalogPin } from "../plugins/claude-plugin-ref.js";
import { listCursorNativeMcpPluginNames } from "../plugins/cursor-enablement.js";
import { listCursorPluginInstalls } from "../plugins/providers/cursor.js";
import { parseMcpServersDocument } from "./mcp-config-bridge.js";

const PLUGIN_MCP_FILES = ["mcp.json", ".mcp.json"] as const;

function mcpNamesFromInstallPath(installPath: string): string[] {
  const names: string[] = [];
  for (const fileName of PLUGIN_MCP_FILES) {
    const fullPath = join(installPath, fileName);
    if (!existsSync(fullPath)) {
      continue;
    }
    try {
      const document = JSON.parse(readFileSync(fullPath, "utf-8")) as unknown;
      names.push(...Object.keys(parseMcpServersDocument(document)));
    } catch {
      // skip invalid plugin MCP payloads
    }
  }
  return names;
}

/**
 * MCP server names provided by the host harness (Cursor/Claude plugin MCP),
 * not by HarnessTap-managed `mcp.json`.
 */
export function listHostNativeMcpNames(
  homeRoot: string,
  harnessId: string,
): Set<string> {
  const names = new Set<string>();
  switch (harnessId) {
    case "cursor": {
      for (const name of listCursorNativeMcpPluginNames(homeRoot)) {
        names.add(name);
      }
      for (const install of listCursorPluginInstalls(homeRoot)) {
        if (!install.installPath) {
          continue;
        }
        for (const name of mcpNamesFromInstallPath(install.installPath)) {
          names.add(name);
        }
      }
      break;
    }
    case "claude-code": {
      for (const install of loadInstalled(homeRoot)) {
        if (!install.installPath) {
          continue;
        }
        for (const name of mcpNamesFromInstallPath(install.installPath)) {
          names.add(name);
        }
      }
      break;
    }
    default:
      break;
  }
  return names;
}

export function hostPluginPinIsInstalled(homeRoot: string, pinRef: string): boolean {
  if (findInstalledRefForCatalogPin(pinRef, homeRoot)) {
    return true;
  }
  const { name } = parsePluginRef(pinRef);
  return listCursorPluginInstalls(homeRoot).some(
    (row) => row.ref === pinRef || row.name === name,
  );
}
