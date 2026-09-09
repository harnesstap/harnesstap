import { Copy, ExternalLink, FolderOpen } from "lucide-react";
import { useState } from "react";
import { IconActionButton } from "./IconActionButton";

export const COPY_PATH_LABEL = "Copy path";
export const REVEAL_PATH_LABEL = "Reveal in Finder";
export const OPEN_IN_EDITOR_LABEL = "Open this file in the default editor.";

export interface PathAccessActionsProps {
  path: string;
  disabled?: boolean;
  opening?: boolean;
  showEditor?: boolean;
  onReveal: (path: string) => void;
  onOpenEditor?: (path: string) => void;
}

export async function copyTextToClipboard(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export function PathAccessActions({
  path,
  disabled = false,
  opening = false,
  showEditor = false,
  onReveal,
  onOpenEditor,
}: PathAccessActionsProps) {
  const [copying, setCopying] = useState(false);
  const locked = disabled || !path;

  async function copyPath(): Promise<void> {
    if (!path || copying) {
      return;
    }
    setCopying(true);
    try {
      await copyTextToClipboard(path);
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="path-access-actions">
      <IconActionButton
        label={COPY_PATH_LABEL}
        title={COPY_PATH_LABEL}
        disabled={locked || copying}
        onClick={() => void copyPath()}
        icon={<Copy size={14} aria-hidden />}
      />
      <IconActionButton
        label={REVEAL_PATH_LABEL}
        title={REVEAL_PATH_LABEL}
        disabled={locked || opening}
        onClick={() => onReveal(path)}
        icon={<FolderOpen size={14} aria-hidden />}
      />
      {showEditor && onOpenEditor ? (
        <IconActionButton
          label={OPEN_IN_EDITOR_LABEL}
          title={OPEN_IN_EDITOR_LABEL}
          disabled={locked || opening}
          onClick={() => onOpenEditor(path)}
          icon={<ExternalLink size={14} aria-hidden />}
        />
      ) : null}
    </div>
  );
}
