import { resolveClaudeEnabledPluginRef } from "../plugins/claude-plugin-ref.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import type { ClaudePluginConfig } from "../types.js";

export interface PluginPinRef {
  ref: string;
  version_constraint: string;
}

/** Build Claude plugin config from native plugin pins when the plugin has no explicit claude block. */
export function claudeConfigFromPluginPins(
  pins: PluginPinRef[],
  homeRoot = resolveHomeRoot(),
): ClaudePluginConfig | undefined {
  if (pins.length === 0) {
    return undefined;
  }

  return {
    plugins: pins.map((pin) => ({
      id: resolveClaudeEnabledPluginRef(pin.ref, homeRoot),
      version: pin.version_constraint,
      enabled: true,
    })),
  };
}
