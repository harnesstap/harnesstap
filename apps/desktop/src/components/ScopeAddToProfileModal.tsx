import { useEffect, useId, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  fetchLibraryPlugins,
  fetchLibraryResources,
} from "../lib/agent-client";
import {
  isCompositionPluginPackage,
  mergeCompositionMembership,
} from "../lib/composition-membership";
import { libraryFilterType } from "../lib/library-list";
import { hoverModelFromLibraryResource } from "../lib/resource-hover";
import {
  filterLibraryResourcesBySearch,
  resourceDisplayName,
} from "../lib/resource-search";
import {
  countResourceTypeTabs,
  resolveResourceTypeTab,
} from "../lib/resource-type-tabs";
import type { LibraryPlugin, LibraryResource } from "../lib/types";
import {
  shouldCloseDialogOnBackdrop,
  useDialogDismiss,
} from "../lib/dialog-dismiss";
import { IconActionButton } from "./IconActionButton";
import { ResourceTypeTabs } from "./ResourceTypeTabs";
import {
  ResourceRowIdentity,
  ResourceRowLeading,
  ResourceRowRoot,
} from "./ui/resource-row";
import { TypeIcon } from "./TypeIcon";

const ICON_SIZE = 14;

export type ScopeLibraryPick = {
  kind: "plugin" | "resource";
  id: string;
  name: string;
  type: string;
};

export function ScopeAddToProfileModal({
  open,
  disabled = false,
  baseUrl,
  token,
  profileKeys,
  onClose,
  onPick,
  onCreate,
}: {
  open: boolean;
  disabled?: boolean;
  baseUrl: string | null;
  token: string | null;
  profileKeys: ReadonlySet<string>;
  onClose: () => void;
  onPick: (item: ScopeLibraryPick) => Promise<void>;
  onCreate: () => void;
}) {
  const titleId = useId();
  const closeRef = useDialogDismiss(open, onClose, disabled);
  const [search, setSearch] = useState("");
  const [typeTab, setTypeTab] = useState<string | null>(null);
  const [resources, setResources] = useState<LibraryResource[]>([]);
  const [plugins, setPlugins] = useState<LibraryPlugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setTypeTab(null);
      setError(null);
      return;
    }
    if (!baseUrl) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      fetchLibraryResources(baseUrl, token),
      fetchLibraryPlugins(baseUrl, token),
    ])
      .then(([nextResources, nextPlugins]) => {
        if (cancelled) {
          return;
        }
        setResources(nextResources);
        setPlugins(nextPlugins);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "Could not load library",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, open, token]);

  const entries = useMemo(
    () => mergeCompositionMembership(resources, plugins),
    [plugins, resources],
  );
  const available = useMemo(
    () =>
      entries.filter((entry) => {
        const type = libraryFilterType(entry);
        const key = `${type}:${entry.name}`;
        return !profileKeys.has(key) && !profileKeys.has(`${type}:${entry.id}`);
      }),
    [entries, profileKeys],
  );
  const searched = useMemo(
    () => filterLibraryResourcesBySearch(available, search),
    [available, search],
  );
  const typeCounts = useMemo(
    () =>
      countResourceTypeTabs(searched.map((entry) => libraryFilterType(entry))),
    [searched],
  );
  const tabOptions = { emptyMode: "disable" as const };
  const resolvedType = resolveResourceTypeTab(typeTab, typeCounts, tabOptions);
  const visible = useMemo(() => {
    const rows =
      resolvedType === null
        ? searched
        : searched.filter((entry) => libraryFilterType(entry) === resolvedType);
    return [...rows].sort((left, right) =>
      resourceDisplayName(left).localeCompare(resourceDisplayName(right)),
    );
  }, [resolvedType, searched]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (shouldCloseDialogOnBackdrop(event.target, event.currentTarget, disabled)) {
          onClose();
        }
      }}
    >
      <div
        className="dialog scope-add-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog-header">
          <h2 id={titleId}>Add to profile</h2>
          <div className="dialog-header-actions">
            <IconActionButton
              primary
              showLabel
              label="Create"
              disabled={disabled}
              onClick={onCreate}
              icon={<Plus size={ICON_SIZE} strokeWidth={2} aria-hidden />}
            />
            <IconActionButton
              label="Close"
              disabled={disabled}
              onClick={onClose}
              icon={<X size={ICON_SIZE} strokeWidth={2} aria-hidden />}
            />
          </div>
          <button
            ref={closeRef}
            type="button"
            className="sr-only"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <label className="list-search">
          <span className="sr-only">Filter library items</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by name"
            aria-label="Filter library items"
            disabled={disabled || loading}
          />
        </label>
        <ResourceTypeTabs
          counts={typeCounts}
          value={resolvedType}
          includeAll
          emptyMode="disable"
          wide
          disabled={disabled || loading}
          onChange={setTypeTab}
        />
        {error ? (
          <p className="banner error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="scope-add-modal-list">
          {loading ? (
            <p className="muted">Loading library…</p>
          ) : visible.length === 0 ? (
            <p className="muted">No matches.</p>
          ) : (
            visible.map((entry) => {
              const type = libraryFilterType(entry);
              const pick: ScopeLibraryPick = isCompositionPluginPackage(entry)
                ? {
                    kind: "plugin",
                    id: entry.id,
                    name: entry.name,
                    type: "plugin",
                  }
                : {
                    kind: "resource",
                    id: entry.id,
                    name: entry.name,
                    type: entry.type,
                  };
              return (
                <ResourceRowRoot
                  key={entry.id}
                  hover={hoverModelFromLibraryResource(entry)}
                  testId={`scope-add-row-${entry.name}`}
                >
                  <ResourceRowLeading>
                    <TypeIcon type={type} />
                  </ResourceRowLeading>
                  <ResourceRowIdentity label={resourceDisplayName(entry)} />
                  <IconActionButton
                    showLabel
                    busy={busyId === entry.id}
                    disabled={disabled}
                    label="Add"
                    onClick={() => {
                      setBusyId(entry.id);
                      void onPick(pick).finally(() => setBusyId(null));
                    }}
                    icon={<Plus size={ICON_SIZE} strokeWidth={2} aria-hidden />}
                  />
                </ResourceRowRoot>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
