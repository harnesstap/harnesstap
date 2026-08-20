import { AlignLeft, FileCode2, Package } from "lucide-react";
import type { SourcesHit } from "../lib/sources-search";
import { presenceLabel } from "../lib/sources-search";
import { LibraryDetailChrome } from "./LibraryDetailChrome";
import { LibraryFieldRow } from "./LibraryFieldRow";
import { SourcesSignInPrompt } from "./SourcesListPane";
import {
  SourcesRecordActions,
  type SourcesRecordActionsProps,
} from "./SourcesRecordActions";

export interface SourcesTreeFile {
  path: string;
  label: string;
}

export interface SourcesPluginTreeProps {
  hit: SourcesHit;
  files: SourcesTreeFile[];
  loading: boolean;
  error: string | null;
  authRequired: boolean;
  disabled?: boolean;
  onBack: () => void;
  onOpenFile: (path: string) => void;
  onSignIn?: () => void;
  recordActions?: SourcesRecordActionsProps;
}

export function SourcesPluginTree({
  hit,
  files,
  loading,
  error,
  authRequired,
  disabled = false,
  onBack,
  onOpenFile,
  onSignIn,
  recordActions,
}: SourcesPluginTreeProps) {
  return (
    <LibraryDetailChrome
      titleId="sources-plugin-tree-title"
      title={hit.name}
      typeLabel="plugin"
      onBack={onBack}
      backLabel="Back to sources list"
    >
      <div className="sources-plugin-tree">
        <LibraryFieldRow
          icon={<Package size={16} aria-hidden />}
          fieldName="Source"
          readOnly
          display={hit.sourceLabel}
          editing={false}
          onStartEdit={() => undefined}
        />
        {hit.version ? (
          <LibraryFieldRow
            icon={<AlignLeft size={16} aria-hidden />}
            fieldName="Version"
            readOnly
            mono
            display={hit.version}
            editing={false}
            onStartEdit={() => undefined}
          />
        ) : null}
        <LibraryFieldRow
          icon={<AlignLeft size={16} aria-hidden />}
          fieldName="Presence"
          readOnly
          display={
            <span className="badge" data-testid="sources-presence">
              {presenceLabel(hit.presence)}
            </span>
          }
          editing={false}
          onStartEdit={() => undefined}
        />
        {recordActions ? <SourcesRecordActions {...recordActions} /> : null}
        {authRequired ? (
          <SourcesSignInPrompt onSignIn={onSignIn} disabled={disabled} />
        ) : error ? (
          <div className="banner error" role="alert">
            {error}
          </div>
        ) : null}
        <section className="library-contained-resources" aria-label="Contained files">
          <h3 className="library-contained-heading">Contained files</h3>
          {loading ? (
            <p className="muted">Loading files…</p>
          ) : files.length === 0 && !error && !authRequired ? (
            <p className="muted">No contained files.</p>
          ) : (
            files.map((file) => (
              <div key={file.path} className="library-contained-row">
                <span className="library-contained-type">
                  <FileCode2 size={14} aria-hidden />
                </span>
                <button
                  type="button"
                  className="resource-name-btn sources-tree-file"
                  disabled={disabled}
                  onClick={() => onOpenFile(file.path)}
                >
                  <span className="library-contained-path mono">{file.label}</span>
                </button>
              </div>
            ))
          )}
        </section>
      </div>
    </LibraryDetailChrome>
  );
}
