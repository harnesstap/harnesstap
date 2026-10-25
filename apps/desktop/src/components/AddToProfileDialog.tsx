import { useId } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export interface AddToProfileDialogProps {
  open: boolean;
  itemName: string;
  profileNames: readonly string[];
  profileName: string | null;
  busy?: boolean;
  onProfileChange: (name: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Discover picks the target profile before adding. Nothing is applied here. */
export function AddToProfileDialog({
  open,
  itemName,
  profileNames,
  profileName,
  busy = false,
  onProfileChange,
  onConfirm,
  onCancel,
}: AddToProfileDialogProps) {
  const selectId = useId();
  return (
    <ConfirmDialog
      open={open}
      title={`Add ${itemName} to a profile`}
      description="It is added to the profile only. Apply from the sidebar when you want it written to your harnesses."
      confirmLabel="Add to profile"
      confirmBusy={busy}
      confirmDisabled={!profileName || busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <div className="form-field" data-testid="add-to-profile-dialog">
        <label htmlFor={selectId}>Profile</label>
        <Select
          value={profileName ?? undefined}
          disabled={busy}
          onValueChange={onProfileChange}
        >
          <SelectTrigger id={selectId} className="w-full" data-testid="add-to-profile-select">
            <SelectValue placeholder="Choose a profile" />
          </SelectTrigger>
          <SelectContent>
            {profileNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </ConfirmDialog>
  );
}
