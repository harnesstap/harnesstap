import { ArrowLeft } from "lucide-react";
import { WORKSPACE_BACK_LABEL } from "../lib/screen-history";
import { IconActionButton } from "./IconActionButton";

export interface WorkspaceBackButtonProps {
  disabled?: boolean;
  /** Hide the control when there is nowhere to go back. */
  hidden?: boolean;
  onClick?: () => void;
}

export function WorkspaceBackButton({
  disabled = false,
  hidden = false,
  onClick,
}: WorkspaceBackButtonProps) {
  if (hidden) {
    return null;
  }
  return (
    <IconActionButton
      data-testid="workspace-back"
      label={WORKSPACE_BACK_LABEL}
      disabled={disabled}
      onClick={onClick}
      icon={<ArrowLeft size={16} aria-hidden />}
    />
  );
}
