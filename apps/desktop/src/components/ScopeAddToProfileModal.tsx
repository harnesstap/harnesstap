import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Plus, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
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
import { resourceRowVirtualStyle } from "../lib/resource-row-virtual";
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
import { noResultsTitle } from "../lib/empty-copy";
import { ButtonSpinner } from "./ButtonSpinner";
import { IconActionButton } from "./IconActionButton";
import { Presence } from "./motion/Presence";
import { motionClass } from "./motion/motion-utils";
import { ResourceTypeTabs } from "./ResourceTypeTabs";
import {
  ResourceRowIdentity,
  ResourceRowLeading,
  ResourceRowRoot,
} from "./ui/resource-row";

const ICON_SIZE = 14;

export type ScopeLibraryPick = {
  kind: "plugin" | "resource";
  id: string;
  name: string;
  type: string;
};

function pickFromEntry(entry: LibraryResource): ScopeLibraryPick {
  return isCompositionPluginPackage(entry)
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
}

export function ScopeAddToProfileModal({
  open,
  disabled = false,
  baseUrl,
  token,
  profileKeys,
  title = "Add to profile",
  addErrorFallback = "Could not add to profile",
  onClose,
  onAdd,
  onCreate,
  excludeProfileName = null,
}: {
  open: boolean;
  disabled?: boolean;
  baseUrl: string | null;
  token: string | null;
  profileKeys: ReadonlySet<string>;
  title?: string;
  addErrorFallback?: string;
  onClose: () => void;
  onAdd: (items: ScopeLibraryPick[]) => Promise<void>;
  onCreate?: () => void;
  excludeProfileName?: string | null;
}) {
  const titleId = useId();
  const closeRef = useDialogDismiss(open, onClose, disabled);
  const [search, setSearch] = useState("");
  const [typeTab, setTypeTab] = useState<string | null>(null);
  const [resources, setResources] = useState<LibraryResource[]>([]);
  const [plugins, setPlugins] = useState<LibraryPlugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setTypeTab(null);
      setError(null);
      setSelectedIds(new Set());
      setAdding(false);
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
        if (
          excludeProfileName
          && (entry.name === excludeProfileName || entry.id === excludeProfileName)
        ) {
          return false;
        }
        const type = libraryFilterType(entry);
        const key = `${type}:${entry.name}`;
        return !profileKeys.has(key) && !profileKeys.has(`${type}:${entry.id}`);
      }),
    [entries, excludeProfileName, profileKeys],
  );
  const searched = useMemo(
    () => filterLibraryResourcesBySearch(available, deferredSearch),
    [available, deferredSearch],
  );
  const typeCounts = useMemo(
    () =>
      countResourceTypeTabs(searched.map((entry) => libraryFilterType(entry))),
    [searched],
  );
  const tabOptions = { emptyMode: "hide" as const };
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

  const selectedCount = visible.filter((entry) => selectedIds.has(entry.id)).length;
  const controlsDisabled = disabled || adding;
  const listVirtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 40,
    overscan: 8,
  });

  return (
    <Presence
      open={open}
      enter="m-scrim-in"
      exit="m-scrim-out"
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (shouldCloseDialogOnBackdrop(event.target, event.currentTarget, controlsDisabled)) {
          onClose();
        }
      }}
    >
      {(state) => (
        <div
          className={motionClass("dialog scope-add-modal", "m-rise", state)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <div className="dialog-header">
            <h2 id={titleId}>{title}</h2>
            <div className="dialog-header-actions">
              {onCreate ? (
                <IconActionButton
                  primary
                  showLabel
                  label="Create"
                  disabled={controlsDisabled}
                  onClick={onCreate}
                  icon={<Plus size={ICON_SIZE} strokeWidth={2} aria-hidden />}
                />
              ) : null}
              <IconActionButton
                label="Close"
                disabled={controlsDisabled}
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
              disabled={controlsDisabled || loading}
            />
          </label>
          <ResourceTypeTabs
            counts={typeCounts}
            value={resolvedType}
            includeAll
            emptyMode="hide"
            overflow="collapse"
            disabled={controlsDisabled || loading}
            onChange={setTypeTab}
          />
          {error ? (
            <p className="banner error" role="alert">
              {error}
            </p>
          ) : null}
          <div ref={listRef} className="scope-add-modal-list">
            {loading ? (
              <p className="muted">Loading library…</p>
            ) : visible.length === 0 ? (
              <p className="muted">{noResultsTitle(search)}</p>
            ) : (
              <div
                className="scope-add-modal-virtual"
                style={{ height: `${listVirtualizer.getTotalSize()}px` }}
              >
                {listVirtualizer.getVirtualItems().map((virtualRow) => {
                  const entry = visible[virtualRow.index];
                  if (!entry) {
                    return null;
                  }
                  const type = libraryFilterType(entry);
                  const checkboxId = `scope-add-${entry.id}`;
                  const checked = selectedIds.has(entry.id);
                  return (
                    <div
                      key={entry.id}
                      className="scope-add-virtual-row"
                      data-index={virtualRow.index}
                      ref={listVirtualizer.measureElement}
                      style={resourceRowVirtualStyle(virtualRow.start)}
                    >
                      <ResourceRowRoot
                        hover={hoverModelFromLibraryResource(entry)}
                        testId={`scope-add-row-${entry.name}`}
                      >
                        <ResourceRowLeading>
                          <span className="resource-row-checkbox">
                            <Checkbox
                              id={checkboxId}
                              checked={checked}
                              disabled={controlsDisabled}
                              onCheckedChange={() => {
                                setSelectedIds((current) => {
                                  const next = new Set(current);
                                  if (next.has(entry.id)) {
                                    next.delete(entry.id);
                                  } else {
                                    next.add(entry.id);
                                  }
                                  return next;
                                });
                              }}
                            />
                          </span>
                        </ResourceRowLeading>
                        <ResourceRowIdentity
                          type={type}
                          label={resourceDisplayName(entry)}
                          htmlFor={checkboxId}
                        />
                      </ResourceRowRoot>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="dialog-actions">
            <button
              className="btn"
              type="button"
              onClick={onClose}
              disabled={adding}
            >
              <X size={16} aria-hidden />
              Cancel
            </button>
            <button
              className={["btn", "primary", adding ? "is-busy" : ""].filter(Boolean).join(" ")}
              type="button"
              disabled={controlsDisabled || selectedCount < 1}
              aria-busy={adding}
              onClick={() => {
                const picks = visible
                  .filter((entry) => selectedIds.has(entry.id))
                  .map(pickFromEntry);
                if (picks.length < 1) {
                  return;
                }
                setAdding(true);
                void onAdd(picks)
                  .then(() => {
                    onClose();
                  })
                  .catch((caught) => {
                    setError(
                      caught instanceof Error ? caught.message : addErrorFallback,
                    );
                  })
                  .finally(() => {
                    setAdding(false);
                  });
              }}
            >
              {adding ? <ButtonSpinner size={16} /> : <Check size={16} aria-hidden />}
              Add
            </button>
          </div>
        </div>
      )}
    </Presence>
  );
}
