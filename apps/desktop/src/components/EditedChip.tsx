import { ChromeTooltip } from "./ChromeTooltip";

/** Tooltip on the Edited chip: what changed and how to keep it. */
export function editedTooltip(version: string): string {
  return `Changed since ${version} was tagged. Tag a version to keep these changes.`;
}

/** Replaces the old `*` after a version: says in words that the head has untagged edits. */
export function EditedChip({ version }: { version: string }) {
  return (
    <ChromeTooltip content={editedTooltip(version)}>
      <span className="meta-chip edited-chip" tabIndex={0} data-testid="edited-chip">
        Edited
      </span>
    </ChromeTooltip>
  );
}
