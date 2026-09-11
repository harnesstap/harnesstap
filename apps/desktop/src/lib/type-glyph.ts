/** Stable glyph ids for tests and TypeIcon. Lucide Sparkles is `sparkles` only. */
export type TypeGlyph =
  | "layers"
  | "package"
  | "sparkles"
  | "plug"
  | "file-text"
  | "file-code"
  | "bot"
  | "terminal"
  | "webhook"
  | "shield"
  | "variable"
  | "wrench";

/** Map a resource/filter type to its type glyph. Sparkles is skill only. */
export function resourceTypeGlyph(type: string): TypeGlyph {
  switch (type) {
    case "plugin":
      return "layers";
    case "plugin_ref":
    case "plugin_pin":
      return "package";
    case "skill":
      return "sparkles";
    case "mcp_server":
      return "plug";
    case "instruction":
      return "file-text";
    case "rule":
      return "file-code";
    case "agent":
      return "bot";
    case "command":
      return "terminal";
    case "hook":
      return "webhook";
    case "permission":
      return "shield";
    case "env_var":
      return "variable";
    case "model_config":
      return "wrench";
    default:
      return "wrench";
  }
}
