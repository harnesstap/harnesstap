import { FolderOpen } from "lucide-react";

export const CHOOSE_PROJECT_LABEL = "Choose project";

/** Inline secondary action that opens the project folder picker. */
export function ChooseProjectButton({
  onClick,
  disabled,
  testId,
}: {
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className="btn choose-project-button"
      disabled={disabled}
      data-testid={testId}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <FolderOpen size={14} aria-hidden />
      {CHOOSE_PROJECT_LABEL}
    </button>
  );
}
