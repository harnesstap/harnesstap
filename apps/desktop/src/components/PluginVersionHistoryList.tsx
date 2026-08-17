import type { LibraryPluginVersionRow } from "../lib/api/library-plugins";
import { formatLibraryTimestamp } from "../lib/library-timestamp";

export interface PluginVersionHistoryListProps {
  pluginName: string;
  headVersion: string;
  headDirty: boolean;
  versions: LibraryPluginVersionRow[];
  error: string | null;
  onSelectHead: () => void;
  onSelectFrozen: (version: string) => void;
}

export function PluginVersionHistoryList({
  pluginName,
  headVersion,
  headDirty,
  versions,
  error,
  onSelectHead,
  onSelectFrozen,
}: PluginVersionHistoryListProps) {
  const onlyHead =
    versions.length === 1 && (versions[0]?.is_head ?? false);

  return (
    <div className="plugin-version-history">
      {error ? (
        <div className="banner error" role="alert">
          {error}
        </div>
      ) : null}
      <ul className="plugin-version-history-list" aria-label={`${pluginName}@${headVersion} versions`}>
        {versions.map((row) => {
          const isHead = row.is_head;
          const dirty = isHead ? headDirty : row.dirty;
          const versionLabel = `${row.version}${dirty ? "*" : ""}`;
          const meta = isHead
            ? "Working head"
            : row.frozen_at
              ? formatLibraryTimestamp(row.frozen_at)
              : "Frozen";
          return (
            <li key={row.id}>
              <button
                type="button"
                className="plugin-version-history-row"
                aria-current={isHead ? true : undefined}
                onClick={() => {
                  if (isHead) {
                    onSelectHead();
                    return;
                  }
                  onSelectFrozen(row.version);
                }}
              >
                <span className="mono plugin-version-history-version">
                  {versionLabel}
                </span>
                <span className="plugin-version-history-meta">{meta}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {onlyHead ? (
        <p className="muted">
          No frozen versions yet. Cut version to freeze the current head.
        </p>
      ) : null}
    </div>
  );
}
