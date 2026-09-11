import type { ReactNode } from "react";
import {
  Bot,
  FileCode2,
  FileText,
  Layers,
  Package,
  Plug,
  Shield,
  Sparkles,
  Terminal,
  Variable,
  Webhook,
  Wrench,
} from "lucide-react";

const ICON_SIZE = 14;

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

export function TypeIcon({ type }: { type: string }): ReactNode {
  const glyph = resourceTypeGlyph(type);
  switch (glyph) {
    case "layers":
      return <Layers size={ICON_SIZE} aria-hidden />;
    case "package":
      return <Package size={ICON_SIZE} aria-hidden />;
    case "sparkles":
      // Sparkles is the skill type glyph only — not status, not gaps, not agents.
      return <Sparkles size={ICON_SIZE} aria-hidden />;
    case "plug":
      return <Plug size={ICON_SIZE} aria-hidden />;
    case "file-text":
      return <FileText size={ICON_SIZE} aria-hidden />;
    case "file-code":
      return <FileCode2 size={ICON_SIZE} aria-hidden />;
    case "bot":
      return <Bot size={ICON_SIZE} aria-hidden />;
    case "terminal":
      return <Terminal size={ICON_SIZE} aria-hidden />;
    case "webhook":
      return <Webhook size={ICON_SIZE} aria-hidden />;
    case "shield":
      return <Shield size={ICON_SIZE} aria-hidden />;
    case "variable":
      return <Variable size={ICON_SIZE} aria-hidden />;
    case "wrench":
      return <Wrench size={ICON_SIZE} aria-hidden />;
    default: {
      const neverGlyph: never = glyph;
      return neverGlyph;
    }
  }
}
