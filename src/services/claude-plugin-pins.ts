import { resolveClaudeEnabledPluginRef } from "../plugins/claude-plugin-ref.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import type { ClaudeLayerConfig } from "../types.js";

export interface PluginPinRef {
  ref: string;
  version_constraint: string;
}

/** Build Claude layer config from native plugin pins when the layer has no explicit claude block. */
export function claudeConfigFromPluginPins(
  pins: PluginPinRef[],
  homeRoot = resolveHomeRoot(),
): ClaudeLayerConfig | undefined {
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
