import { useId, useState } from "react";
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
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="profile-delete-footer"
      style={{
        marginTop: "1rem",
        paddingTop: "0.75rem",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      {error ? (
        <div className="banner error" role="alert">
          {error}
        </div>
      ) : null}
      <button
        className={["btn", "danger", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
        type="button"
        aria-label={`Remove profile ${profileName}`}
        disabled={busy || builtinEmpty}
        onClick={() => {
          setDeletePlugin(false);
          setConfirmOpen(true);
        }}
        style={{
          background: "var(--destructive)",
          color: "var(--destructive-foreground)",
          borderColor: "transparent",
        }}
      >
        {busy ? <ButtonSpinner size={16} /> : null}
        Remove profile
      </button>
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
          }
        }}
      >
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
    </div>
  );
}
