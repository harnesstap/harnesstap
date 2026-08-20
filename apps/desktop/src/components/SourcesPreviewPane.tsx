import { AlignLeft, FileCode2, Folder, Package } from "lucide-react";
import type { SourcesHit } from "../lib/sources-search";
import { presenceLabel } from "../lib/sources-search";
import { LibraryDetailChrome } from "./LibraryDetailChrome";
import { LibraryFieldRow } from "./LibraryFieldRow";
import { SourcesSignInPrompt } from "./SourcesListPane";
import {
  SourcesRecordActions,
  type SourcesRecordActionsProps,
} from "./SourcesRecordActions";

export interface SourcesPreviewPaneProps {
  hit: SourcesHit;
  filePath?: string;
  content: string | null;
  loading: boolean;
  error: string | null;
  authRequired: boolean;
  disabled?: boolean;
  onBack: () => void;
  onSignIn?: () => void;
  recordActions?: SourcesRecordActionsProps;
}

export function SourcesPreviewPane({
  hit,
  filePath,
  content,
  loading,
  error,
  authRequired,
  disabled = false,
  onBack,
  onSignIn,
  recordActions,
}: SourcesPreviewPaneProps) {
  const fromPlugin = filePath !== undefined;
  return (
    <LibraryDetailChrome
      titleId="sources-preview-title"
      title={filePath ?? hit.name}
      typeLabel={hit.typeLabel}
      onBack={onBack}
      backLabel={fromPlugin ? "Back to plugin" : "Back to sources list"}
    >
      <div className="sources-preview">
        <LibraryFieldRow
          icon={<Package size={16} aria-hidden />}
          fieldName="Source"
          readOnly
          display={hit.sourceLabel}
          editing={false}
          onStartEdit={() => undefined}
        />
        <LibraryFieldRow
          icon={<AlignLeft size={16} aria-hidden />}
          fieldName="Name"
          readOnly
          display={hit.name}
          editing={false}
          onStartEdit={() => undefined}
        />
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
        {filePath ? (
          <LibraryFieldRow
            icon={<Folder size={16} aria-hidden />}
            fieldName="Path"
            readOnly
            mono
            display={filePath}
            editing={false}
            onStartEdit={() => undefined}
          />
        ) : null}
        {authRequired ? (
          <SourcesSignInPrompt onSignIn={onSignIn} disabled={disabled} />
        ) : error ? (
          <div className="banner error" role="alert">
            {error}
          </div>
        ) : null}
        {loading ? (
          <p className="muted">Loading preview…</p>
        ) : (
          <LibraryFieldRow
            icon={<FileCode2 size={16} aria-hidden />}
            fieldName="Content"
            readOnly
            mono
            display={content ?? ""}
            placeholder="No content"
            editing={false}
            onStartEdit={() => undefined}
          />
        )}
      </div>
    </LibraryDetailChrome>
  );
}
