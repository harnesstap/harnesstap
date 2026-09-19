import { ExternalLink, RefreshCw } from "lucide-react";
import {
  PLUGIN_REF_EMPTY_RESOURCES_COPY,
  groupContainedResources,
} from "../lib/plugin-ref-detail";
import type { PluginContainedResource } from "../lib/types";
import { IconActionButton } from "./IconActionButton";
import { TypeIcon } from "./TypeIcon";

const OPEN_LABEL = "Open this file in the default editor.";

export interface PluginRefResourceListProps {
  resources: PluginContainedResource[] | undefined;
  openingPath: string | null;
  disabled?: boolean;
  onOpen: (path: string) => void;
  onSync?: () => void;
  syncBusy?: boolean;
}

export function PluginRefResourceList({
  resources,
  openingPath,
  disabled = false,
  onOpen,
  onSync,
  syncBusy = false,
}: PluginRefResourceListProps) {
  const rows = resources ?? [];
  const groups = groupContainedResources(rows);

  return (
    <section className="library-contained-resources" aria-label="Resources">
      <h3 className="library-contained-heading">Resources</h3>
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
                <button
                  type="button"
                  className="icon-action"
                  title={OPEN_LABEL}
                  aria-label={OPEN_LABEL}
                  disabled={disabled || openingPath === entry.path}
                  onClick={() => onOpen(entry.path)}
                >
                  <ExternalLink size={14} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  );
}
