import { useId, useState } from "react";
import { Trash2 } from "lucide-react";
import { AgentApiError } from "../../lib/api/http";
import {
  deleteProfile,
  isBuiltinEmptyProfileName,
  profileDeleteSuccessMessage,
  shouldShowProfileDeleteControls,
  type ProfileDeleteResult,
} from "../../lib/api/profile-delete";
import { ButtonSpinner } from "../ButtonSpinner";
import { ConfirmDialog } from "../ConfirmDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export interface ProfileDeleteControlsProps {
  profileName: string;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  variant?: "labeled" | "icon";
  onDeleted: (result: ProfileDeleteResult, message: string) => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof AgentApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "Could not remove profile";
}

export function ProfileDeleteControls({
  profileName,
  baseUrl,
  token,
  disabled = false,
  variant = "labeled",
  onDeleted,
}: ProfileDeleteControlsProps) {
  const checkboxId = useId();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deletePlugin, setDeletePlugin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const builtinEmpty = isBuiltinEmptyProfileName(profileName);
  const visible = shouldShowProfileDeleteControls({
    disabled,
    baseUrl,
    token,
  });

  if (!visible) {
    return null;
  }

  async function onConfirm() {
    if (!baseUrl || builtinEmpty) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await deleteProfile(
        baseUrl,
        token,
        profileName,
        deletePlugin,
      );
      setConfirmOpen(false);
      setDeletePlugin(false);
      onDeleted(result, profileDeleteSuccessMessage(result));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="profile-delete-control">
        <button
          className={
            variant === "icon"
              ? ["icon-action", busy ? "is-busy" : ""].filter(Boolean).join(" ")
              : ["btn", busy ? "is-busy" : ""].filter(Boolean).join(" ")
          }
          type="button"
          aria-label="Remove profile"
          title="Remove profile"
          disabled={busy || builtinEmpty}
          onClick={() => {
            setDeletePlugin(false);
            setError(null);
            setConfirmOpen(true);
          }}
        >
          {busy ? (
            <ButtonSpinner size={16} />
          ) : variant === "icon" ? (
            <Trash2 size={18} strokeWidth={2} aria-hidden />
          ) : (
            "Remove profile"
          )}
        </button>
      </span>
      <ConfirmDialog
        open={confirmOpen}
        title="Remove this profile?"
        description={`This removes the profile tag from ${profileName}. Harness files already on disk stay until you apply another profile. The plugin stays in the library unless you choose to delete it.`}
        confirmLabel="Remove profile"
        cancelLabel="Cancel"
        confirmBusy={busy}
        onConfirm={() => {
          void onConfirm();
        }}
        onCancel={() => {
          if (!busy) {
            setConfirmOpen(false);
            setDeletePlugin(false);
            setError(null);
          }
        }}
      >
        {error ? (
          <div className="banner error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Checkbox
            id={checkboxId}
            checked={deletePlugin}
            disabled={busy}
            onCheckedChange={(value) => setDeletePlugin(value === true)}
          />
          <Label htmlFor={checkboxId} className="font-normal text-muted-foreground">
            Also delete the plugin from the library
          </Label>
        </div>
      </ConfirmDialog>
    </>
  );
}
