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
import { resourceTypeGlyph } from "../lib/type-glyph";

const ICON_SIZE = 14;

export { resourceTypeGlyph } from "../lib/type-glyph";
export type { TypeGlyph } from "../lib/type-glyph";

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
