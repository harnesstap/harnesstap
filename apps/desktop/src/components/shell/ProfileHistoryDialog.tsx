import { useEffect, useState } from "react";
import {
  fetchLibraryPluginVersions,
  type LibraryPluginVersionRow,
} from "../../lib/api/library-plugins";
import { ConfirmDialog } from "../ConfirmDialog";
import { PluginVersionHistoryList } from "../PluginVersionHistoryList";

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** The profile's version history, opened from the profile header. */
export function ProfileHistoryDialog({
  open,
  profileName,
  headVersion,
  headDirty,
  baseUrl,
  token,
  onClose,
  onOpenVersion,
}: {
  open: boolean;
  profileName: string;
  headVersion: string;
  headDirty: boolean;
  baseUrl: string | null;
  token: string | null;
  onClose: () => void;
  /** Opens a frozen version read-only in the Library. */
  onOpenVersion: (version: string) => void;
}) {
  const [versions, setVersions] = useState<LibraryPluginVersionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !baseUrl) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchLibraryPluginVersions(baseUrl, token, profileName)
      .then((next) => {
        if (!cancelled) setVersions(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setVersions([]);
          setError(errorText(cause, "Could not load versions"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, baseUrl, token, profileName]);

  return (
    <ConfirmDialog
      open={open}
      title={`${profileName} version history`}
      confirmLabel="Done"
      cancelLabel={null}
      onConfirm={onClose}
      onCancel={onClose}
    >
      <div data-testid="profile-history-dialog">
        {loading && versions.length === 0 && !error ? (
          <p className="muted">Loading versions...</p>
        ) : (
          <PluginVersionHistoryList
            pluginName={profileName}
            headVersion={headVersion}
            headDirty={headDirty}
            versions={versions}
            error={error}
            onSelectHead={onClose}
            onSelectFrozen={(version) => {
              onClose();
              onOpenVersion(version);
            }}
          />
        )}
      </div>
    </ConfirmDialog>
  );
}
