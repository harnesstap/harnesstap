import { ArrowLeft } from "lucide-react";
import { WORKSPACE_BACK_LABEL } from "../lib/screen-history";

export interface WorkspaceBackButtonProps {
  disabled?: boolean;
  onClick?: () => void;
}

export function WorkspaceBackButton({
  disabled = false,
  onClick,
}: WorkspaceBackButtonProps) {
  return (
    <button
      type="button"
      className="icon-action"
      data-testid="workspace-back"
      aria-label={WORKSPACE_BACK_LABEL}
      title={WORKSPACE_BACK_LABEL}
      disabled={disabled}
      onClick={onClick}
    >
      <ArrowLeft size={16} aria-hidden />
    </button>
  );
}
