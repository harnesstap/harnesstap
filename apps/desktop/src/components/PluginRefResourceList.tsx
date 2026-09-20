import { RefreshCw } from "lucide-react";
import {
  PLUGIN_REF_EMPTY_RESOURCES_COPY,
  groupContainedResources,
} from "../lib/plugin-ref-detail";
import type { PluginContainedResource } from "../lib/types";
import { IconActionButton } from "./IconActionButton";
import { PathAccessActions } from "./PathAccessActions";
import { TypeIcon } from "./TypeIcon";

export interface PluginRefResourceListProps {
  resources: PluginContainedResource[] | undefined;
  openingPath: string | null;
  disabled?: boolean;
  onReveal: (path: string) => void;
  onOpenEditor: (path: string) => void;
  onSync?: () => void;
  syncBusy?: boolean;
}

export function PluginRefResourceList({
  resources,
  openingPath,
  disabled = false,
  onReveal,
  onOpenEditor,
  onSync,
  syncBusy = false,
}: PluginRefResourceListProps) {
  const rows = resources ?? [];
  const groups = groupContainedResources(rows);

  return (
    <section className="library-contained-resources" aria-label="Content">
      <h3 className="library-contained-heading">Content</h3>
      {groups.length === 0 ? (
        <div className="library-contained-empty">
          <p className="muted">{PLUGIN_REF_EMPTY_RESOURCES_COPY}</p>
          {onSync ? (
            <IconActionButton
              primary
              showLabel
              label="Sync"
              disabled={disabled}
              busy={syncBusy}
              onClick={onSync}
              icon={<RefreshCw size={16} aria-hidden />}
            />
          ) : null}
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.type} className="library-contained-group">
            <div className="library-contained-group-label muted">
              {group.type.replaceAll("_", " ")}
            </div>
            {group.resources.map((entry) => (
              <div key={`${entry.type}:${entry.path}`} className="library-contained-row">
                <span className="library-contained-type">
                  <TypeIcon type={entry.type} />
                </span>
                <span className="library-contained-path mono">{entry.relative_path}</span>
                <PathAccessActions
                  path={entry.path}
                  disabled={disabled}
                  opening={openingPath === entry.path}
                  showEditor
                  onReveal={onReveal}
                  onOpenEditor={onOpenEditor}
                />
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  );
}
