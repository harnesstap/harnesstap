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

export function TypeIcon({ type }: { type: string }): ReactNode {
  switch (type) {
    case "plugin":
      return <Layers size={ICON_SIZE} aria-hidden />;
    case "skill":
      return <Sparkles size={ICON_SIZE} aria-hidden />;
    case "mcp_server":
      return <Plug size={ICON_SIZE} aria-hidden />;
    case "instruction":
      return <FileText size={ICON_SIZE} aria-hidden />;
    case "rule":
      return <FileCode2 size={ICON_SIZE} aria-hidden />;
    case "agent":
      return <Bot size={ICON_SIZE} aria-hidden />;
    case "command":
      return <Terminal size={ICON_SIZE} aria-hidden />;
    case "hook":
      return <Webhook size={ICON_SIZE} aria-hidden />;
    case "permission":
      return <Shield size={ICON_SIZE} aria-hidden />;
    case "env_var":
      return <Variable size={ICON_SIZE} aria-hidden />;
    case "model_config":
      return <Wrench size={ICON_SIZE} aria-hidden />;
    case "plugin_pin":
      return <Package size={ICON_SIZE} aria-hidden />;
    default:
      return <Wrench size={ICON_SIZE} aria-hidden />;
  }
}
