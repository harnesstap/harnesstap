import type { ReactNode } from "react";
import type { LibraryResource } from "../../lib/types";
import { ResourceSelectionList, type InheritedRowsInput } from "../CompositionPickers";

export interface PluginCompositionFieldsProps {
  libraryLoading: boolean;
  libraryError: string | null;
  resources: LibraryResource[];
  resourceFilter: string;
  onResourceFilter: (value: string) => void;
  selectedIds: string[];
  onToggleResource: (id: string) => void;
  onInspectResource?: (resource: LibraryResource) => void;
  disabled: boolean;
  emptyUnfilteredLabel?: string;
  footer?: ReactNode;
  /** Parent items of a kept-in-sync profile, listed inline first. */
  inherited?: InheritedRowsInput;
  /** Shown under the Composition heading, e.g. a missing parent. */
  notice?: ReactNode;
}

export function PluginCompositionFields({
  libraryLoading,
  libraryError,
  resources,
  resourceFilter,
  onResourceFilter,
  selectedIds,
  onToggleResource,
  onInspectResource,
  disabled,
  emptyUnfilteredLabel = "No library items available.",
  footer,
  inherited,
  notice,
}: PluginCompositionFieldsProps) {
  return (
    <section className="edit-profile-section" aria-label="Composition">
      <h3>Composition</h3>
      {notice}
      <div className="plugin-composition-pane">
        <div className="compose-library compose-library-unified">
          {libraryLoading ? (
            <p className="muted">Loading local library...</p>
          ) : libraryError ? (
            <div className="banner error">{libraryError}</div>
          ) : (
            <ResourceSelectionList
              resources={resources}
              filter={resourceFilter}
              onFilterChange={onResourceFilter}
              selectedIds={selectedIds}
              disabled={disabled}
              onToggle={onToggleResource}
              onInspect={onInspectResource}
              emptyUnfilteredLabel={emptyUnfilteredLabel}
              inherited={inherited}
            />
          )}
        </div>
        {footer}
      </div>
    </section>
  );
}
