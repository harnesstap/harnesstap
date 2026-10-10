import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { FilterX, Plus, Trash2 } from "lucide-react";
import {
  MUTATION_CHUNK_SIZE,
  PROFILE_INVENTORY_SECTION_ORDER,
  applyOptimisticInventoryMoves,
  membershipKey,
  settleInChunks,
  type ProfileInventoryItem,
  type ProfileInventorySectionId,
} from "../../lib/profile-inventory";
import type { ProfileContentsResource } from "../../lib/types";
import { toast } from "../../state/toast-store";
import { catalogListEmptyKind, noResultsTitle } from "../../lib/empty-copy";
import {
  collectDiscardPathRows,
  discardAllDescription,
  discardAllTitle,
  discardResourceDescription,
  discardResourceTitle,
} from "../../lib/scope-inventory-discard";
import {
  LIBRARY_BULK_DELETE_PREVIEW,
  libraryBulkDeleteLine,
  libraryBulkDeleteShowAllLabel,
  libraryBulkDeleteVisibleCount,
  pruneSelectedIds,
} from "../../lib/library-bulk-edit";
import { resourceTypeTabLabel, type TypeTabAttention } from "../../lib/resource-type-tabs";
import type { TypeTabEmptySurface } from "../../lib/ui-copy";
import { ChromeTooltip } from "../ChromeTooltip";
import { ConfirmDialog } from "../ConfirmDialog";
import { EmptyState } from "../EmptyState";
import type { ResourceDetailTarget } from "../ResourceDetailPane";
import { DiscardPathList } from "./DiscardPathList";
import { InventorySection } from "./InventorySection";
import { LiveHeader } from "./LiveHeader";
import type { HarnessScope, SerializerTarget } from "../../lib/harness-scope-ui";

export interface ScopeInventoryShellProps {
  search: string;
  onSearch: (value: string) => void;
  typeCounts: ReadonlyMap<string, number>;
  attention: ReadonlyMap<string, TypeTabAttention>;
  typeTab: string | null;
  onTypeTab: (next: string | null) => void;
  emptySurface?: TypeTabEmptySurface;
  items: ProfileInventoryItem[];
  /** Unfiltered inventory size (All count before search and type). */
  catalogCount: number;
  selectedProfile: string | null;
  selectedIsActive: boolean;
  editMode: boolean;
  onToggleEditMode?: () => void;
  railPrimaryIsReapply: boolean;
  inactiveHeaderHint: string | null;
  onAddResource?: (
    resource: ProfileContentsResource,
    profileOverride?: string,
    options?: { skipAutoReapply?: boolean },
  ) => Promise<void>;
  onDiscardResource?: (resource: ProfileContentsResource) => Promise<void>;
  onDiscardAllResources?: (resources: ProfileContentsResource[]) => Promise<void>;
  onActivateResources?: (resources: ProfileContentsResource[]) => Promise<void>;
  onAfterAdds?: (addedName: string) => Promise<void>;
  onOpenResource: (target: ResourceDetailTarget) => void;
  onOpenPlugin?: (pluginName: string) => void;
  onDiff?: (item: ProfileInventoryItem) => void;
  onRemoveFromProfile?: (
    item: ProfileInventoryItem,
    options?: { skipAutoReapply?: boolean },
  ) => Promise<void> | void;
  onAfterRemoves?: () => Promise<void>;
  onOpenAddModal: () => void;
  addingAllResources?: boolean;
  activatingResources?: boolean;
  registeredHarnesses?: readonly string[];
  harnessNames?: Readonly<Record<string, string>>;
  scopeTarget?: SerializerTarget;
  onHarnessScopeChange?: (item: ProfileInventoryItem, scope: HarnessScope) => void;
}

function batchLabel(
  verb: "Adding" | "Activating" | "Discarding",
  done: number,
  total: number,
): string {
  if (verb === "Discarding" && done <= 0) {
    return `${verb} ${total}…`;
  }
  return `${verb} ${Math.min(done, total)} of ${total}…`;
}

export function ScopeInventoryShell({
  search,
  onSearch,
  typeCounts,
  attention,
  typeTab,
  onTypeTab,
  emptySurface = "profile",
  items,
  catalogCount,
  selectedProfile,
  selectedIsActive,
  editMode,
  onToggleEditMode,
  railPrimaryIsReapply,
  inactiveHeaderHint,
  onAddResource,
  onDiscardResource,
  onDiscardAllResources,
  onActivateResources,
  onAfterAdds,
  onOpenResource,
  onOpenPlugin,
  onDiff,
  onRemoveFromProfile,
  onAfterRemoves,
  onOpenAddModal,
  addingAllResources = false,
  activatingResources = false,
  registeredHarnesses,
  harnessNames,
  scopeTarget,
  onHarnessScopeChange,
}: ScopeInventoryShellProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [moves, setMoves] = useState<Map<string, ProfileInventorySectionId>>(
    () => new Map(),
  );
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set());
  const [addProgress, setAddProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [discardProgress, setDiscardProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [activateProgress, setActivateProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);
  const [bulkRemoveBusy, setBulkRemoveBusy] = useState(false);
  const [bulkRemoveRevealed, setBulkRemoveRevealed] = useState(
    LIBRARY_BULK_DELETE_PREVIEW,
  );
  const [pendingRemoveRows, setPendingRemoveRows] = useState<ProfileInventoryItem[]>(
    [],
  );
  const [pendingDiscard, setPendingDiscard] = useState<ProfileInventoryItem | null>(
    null,
  );
  const [pendingDiscardAll, setPendingDiscardAll] = useState<
    ProfileInventoryItem[] | null
  >(null);

  const displayed = useMemo(() => {
    const moved = applyOptimisticInventoryMoves(items, moves);
    return moved.filter((item) => !hiddenKeys.has(membershipKey(item.resource)));
  }, [hiddenKeys, items, moves]);
  const bySection = useMemo(() => {
    return {
      not_in_profile: displayed.filter((item) => item.section === "not_in_profile"),
      inactive: displayed.filter((item) => item.section === "inactive"),
      active: displayed.filter((item) => item.section === "active"),
    };
  }, [displayed]);
  const selectableItems = useMemo(
    () => displayed.filter((item) => item.section !== "not_in_profile"),
    [displayed],
  );
  const knownSelectableIds = useMemo(
    () => new Set(selectableItems.map((item) => item.key)),
    [selectableItems],
  );

  useEffect(() => {
    if (!editMode) {
      setSelectedIds(new Set());
      setBulkRemoveOpen(false);
      setBulkRemoveRevealed(LIBRARY_BULK_DELETE_PREVIEW);
      setBulkRemoveBusy(false);
      setPendingRemoveRows([]);
    }
  }, [editMode]);

  useEffect(() => {
    if (bulkRemoveBusy) {
      return;
    }
    setSelectedIds((current) => pruneSelectedIds(current, knownSelectableIds));
  }, [bulkRemoveBusy, knownSelectableIds]);

  const selectedItems = useMemo(
    () => selectableItems.filter((item) => selectedIds.has(item.key)),
    [selectableItems, selectedIds],
  );
  const bulkRemoveSource = bulkRemoveOpen ? pendingRemoveRows : selectedItems;
  const bulkRemoveLines = bulkRemoveSource.map((item) => ({
    id: item.key,
    line: libraryBulkDeleteLine(resourceTypeTabLabel(item.type), item.label),
  }));
  const bulkRemoveVisibleCount = libraryBulkDeleteVisibleCount(
    bulkRemoveLines.length,
    bulkRemoveRevealed,
  );

  const toggleSelected = (item: ProfileInventoryItem) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(item.key)) {
        next.delete(item.key);
      } else {
        next.add(item.key);
      }
      return next;
    });
  };

  const markPending = (key: string, section: ProfileInventorySectionId) => {
    setMoves((current) => {
      const next = new Map(current);
      next.set(key, section);
      return next;
    });
    setPendingKeys((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
  };
  const clearPending = (key: string, restore?: ProfileInventorySectionId) => {
    setPendingKeys((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setMoves((current) => {
      const next = new Map(current);
      if (restore) {
        next.set(key, restore);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const runAdd = async (item: ProfileInventoryItem) => {
    if (!onAddResource) {
      return;
    }
    const key = membershipKey(item.resource);
    const from = item.section;
    markPending(key, "inactive");
    try {
      await onAddResource(item.resource);
      clearPending(key);
    } catch {
      clearPending(key, from);
      toast({
        tone: "error",
        title: `Could not add ${item.label}`,
        action: {
          label: "Retry",
          onClick: () => {
            void runAdd(item);
          },
        },
      });
    }
  };

  const runActivate = async (item: ProfileInventoryItem) => {
    if (!onActivateResources) {
      return;
    }
    const key = membershipKey(item.resource);
    const from = item.section;
    markPending(key, "active");
    try {
      await onActivateResources([item.resource]);
      clearPending(key);
    } catch {
      clearPending(key, from);
      toast({
        tone: "error",
        title: `Could not activate ${item.label}`,
        action: {
          label: "Retry",
          onClick: () => {
            void runActivate(item);
          },
        },
      });
    }
  };

  const runDiscard = async (item: ProfileInventoryItem) => {
    if (!onDiscardResource) {
      return;
    }
    const key = membershipKey(item.resource);
    setHiddenKeys((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    setPendingKeys((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    try {
      await onDiscardResource(item.resource);
      setPendingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    } catch {
      setHiddenKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setPendingKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      toast({
        tone: "error",
        title: `Could not discard ${item.label}`,
        action: {
          label: "Retry",
          onClick: () => {
            void runDiscard(item);
          },
        },
      });
    }
  };

  const runDiscardAll = async (rows: ProfileInventoryItem[]) => {
    if (!onDiscardAllResources || rows.length === 0) {
      return;
    }
    const keys = rows.map((row) => membershipKey(row.resource));
    setHiddenKeys((current) => {
      const next = new Set(current);
      for (const key of keys) {
        next.add(key);
      }
      return next;
    });
    setPendingKeys((current) => {
      const next = new Set(current);
      for (const key of keys) {
        next.add(key);
      }
      return next;
    });
    setDiscardProgress({ done: 0, total: rows.length });
    try {
      await onDiscardAllResources(rows.map((row) => row.resource));
      setPendingKeys((current) => {
        const next = new Set(current);
        for (const key of keys) {
          next.delete(key);
        }
        return next;
      });
      setDiscardProgress({ done: rows.length, total: rows.length });
    } catch {
      setHiddenKeys((current) => {
        const next = new Set(current);
        for (const key of keys) {
          next.delete(key);
        }
        return next;
      });
      setPendingKeys((current) => {
        const next = new Set(current);
        for (const key of keys) {
          next.delete(key);
        }
        return next;
      });
      toast({
        tone: "error",
        title: "Could not discard live resources",
        action: {
          label: "Retry",
          onClick: () => {
            void runDiscardAll(rows);
          },
        },
      });
    } finally {
      setDiscardProgress(null);
    }
  };

  const runAddAll = async (rows: ProfileInventoryItem[]) => {
    if (!onAddResource || rows.length === 0) {
      return;
    }
    for (const row of rows) {
      markPending(membershipKey(row.resource), "inactive");
    }
    setAddProgress({ done: 0, total: rows.length });
    const results = await settleInChunks(
      rows,
      MUTATION_CHUNK_SIZE,
      async (row) => {
        const key = membershipKey(row.resource);
        try {
          await onAddResource(row.resource, undefined, { skipAutoReapply: true });
          clearPending(key);
        } catch (error) {
          clearPending(key, "not_in_profile");
          throw error;
        }
      },
      (done, total) => setAddProgress({ done, total }),
    );
    setAddProgress(null);
    const failed = results.flatMap((result, index) =>
      result.status === "rejected" && rows[index] ? [rows[index]] : [],
    );
    const firstOk = rows.find((_, index) => results[index]?.status === "fulfilled");
    if (firstOk && onAfterAdds) {
      await onAfterAdds(firstOk.label);
    }
    if (failed[0]) {
      toast({
        tone: "error",
        title: `Could not add ${failed[0].label}`,
        action: {
          label: "Retry",
          onClick: () => {
            void runAddAll(failed);
          },
        },
      });
    }
  };

  const runActivateAll = async (rows: ProfileInventoryItem[]) => {
    if (!onActivateResources || rows.length === 0) {
      return;
    }
    for (const row of rows) {
      markPending(membershipKey(row.resource), "active");
    }
    setActivateProgress({ done: 0, total: rows.length });
    try {
      await onActivateResources(rows.map((row) => row.resource));
      setActivateProgress({ done: rows.length, total: rows.length });
      for (const row of rows) {
        clearPending(membershipKey(row.resource));
      }
    } catch {
      for (const row of rows) {
        clearPending(membershipKey(row.resource), "inactive");
      }
      toast({
        tone: "error",
        title: "Could not activate resources",
        action: {
          label: "Retry",
          onClick: () => {
            void runActivateAll(rows);
          },
        },
      });
    } finally {
      setActivateProgress(null);
    }
  };

  const runRemoveAll = async (rows: ProfileInventoryItem[]) => {
    if (!onRemoveFromProfile || rows.length === 0 || bulkRemoveBusy) {
      return;
    }
    setBulkRemoveBusy(true);
    for (const row of rows) {
      markPending(membershipKey(row.resource), "not_in_profile");
    }
    const results: PromiseSettledResult<void>[] = [];
    for (const row of rows) {
      const key = membershipKey(row.resource);
      const from = row.section;
      try {
        await onRemoveFromProfile(row, { skipAutoReapply: true });
        clearPending(key);
        results.push({ status: "fulfilled", value: undefined });
      } catch (error) {
        clearPending(key, from);
        results.push({
          status: "rejected",
          reason: error,
        });
      }
    }
    const succeeded = rows.filter((_, index) => results[index]?.status === "fulfilled");
    const failed = rows.filter((_, index) => results[index]?.status === "rejected");
    if (succeeded.length > 0) {
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const row of succeeded) {
          next.delete(row.key);
        }
        return next;
      });
      if (onAfterRemoves) {
        try {
          await onAfterRemoves();
        } catch {
          // Inventory already dropped the memberships; apply can retry from the rail.
        }
      }
    }
    setBulkRemoveBusy(false);
    setBulkRemoveOpen(false);
    setBulkRemoveRevealed(LIBRARY_BULK_DELETE_PREVIEW);
    setPendingRemoveRows([]);
    if (failed[0]) {
      toast({
        tone: "error",
        title: `Could not remove ${failed[0].label}`,
        action: {
          label: "Retry",
          onClick: () => {
            void runRemoveAll(failed);
          },
        },
      });
    }
  };

  return (
    <div className="scope-inventory-pane">
      <div ref={scrollRef} className="scope-inventory-scroll">
        <LiveHeader
          search={search}
          onSearch={onSearch}
          typeCounts={typeCounts}
          attention={attention}
          typeTab={typeTab}
          onTypeTab={onTypeTab}
          emptySurface={emptySurface}
        />
        <div className="enabled-list scope-inventory-list">
          {PROFILE_INVENTORY_SECTION_ORDER.map((section) => {
            const rows = bySection[section];
            const hint =
              section === "inactive" && rows.length > 0 ? inactiveHeaderHint : null;
            return (
              <InventorySection
                key={section}
                section={section}
                rows={rows}
                typeTab={typeTab}
                scrollRef={scrollRef as RefObject<HTMLDivElement | null>}
                editMode={editMode}
                profileName={selectedProfile}
                selectedIsActive={selectedIsActive}
                pendingKeys={pendingKeys}
                batchLabel={
                  section === "not_in_profile" && discardProgress
                    ? batchLabel(
                        "Discarding",
                        discardProgress.done,
                        discardProgress.total,
                      )
                    : section === "not_in_profile" && addProgress
                    ? batchLabel("Adding", addProgress.done, addProgress.total)
                    : section === "inactive" && activateProgress
                      ? batchLabel(
                          "Activating",
                          activateProgress.done,
                          activateProgress.total,
                        )
                      : null
                }
                canAddAll={section === "not_in_profile" && Boolean(onAddResource)}
                canDiscardAll={
                  section === "not_in_profile" && Boolean(onDiscardAllResources)
                }
                canActivateAll={
                  section === "inactive"
                  && selectedIsActive
                  && Boolean(onActivateResources)
                }
                addAllPrimary={!railPrimaryIsReapply}
                addingAll={addingAllResources || addProgress !== null}
                discardingAll={discardProgress !== null}
                activatingAll={activatingResources || activateProgress !== null}
                headerHint={hint}
                onAddAll={
                  section === "not_in_profile" ? () => void runAddAll(rows) : undefined
                }
                addingAllDisabled={discardProgress !== null}
                onDiscardAll={
                  section === "not_in_profile"
                    ? () => setPendingDiscardAll(rows)
                    : undefined
                }
                onActivateAll={
                  section === "inactive" ? () => void runActivateAll(rows) : undefined
                }
                onToggleEdit={section === "active" ? onToggleEditMode : undefined}
                onAdd={onAddResource ? (item) => void runAdd(item) : undefined}
                onDiscard={
                  onDiscardResource ? (item) => setPendingDiscard(item) : undefined
                }
                onActivate={
                  onActivateResources ? (item) => void runActivate(item) : undefined
                }
                onOpenResource={onOpenResource}
                onOpenPlugin={onOpenPlugin}
                onDiff={onDiff}
                selectedIds={editMode ? selectedIds : undefined}
                onToggleSelected={
                  editMode && onRemoveFromProfile ? toggleSelected : undefined
                }
                registeredHarnesses={registeredHarnesses}
                harnessNames={harnessNames}
                scopeTarget={scopeTarget}
                onHarnessScopeChange={onHarnessScopeChange}
              />
            );
          })}
          {displayed.length === 0 && !discardProgress && !addProgress ? (
            catalogListEmptyKind({
              unfilteredCount: catalogCount,
              visibleCount: displayed.length,
              filterActive: search.trim().length > 0 || typeTab !== null,
            }) === "filter-empty" ? (
              <EmptyState
                title={noResultsTitle(search)}
                body="Clear the filter to see every resource."
                action={
                  search.trim()
                    ? {
                        label: "Clear filter",
                        onClick: () => onSearch(""),
                        icon: <FilterX size={16} aria-hidden />,
                      }
                    : undefined
                }
              />
            ) : (
              <EmptyState
                title="No resources yet"
                body="Add something to this profile."
                testId="scope-inventory-empty"
              />
            )
          ) : null}
        </div>
      </div>
      <ChromeTooltip
        content={editMode ? "Delete selected" : "Add to profile"}
      >
        <button
          type="button"
          className={[
            "scope-inventory-fab",
            "icon-action",
            editMode ? "destructive" : "primary",
          ].join(" ")}
          data-testid="scope-inventory-fab"
          aria-label={editMode ? "Delete selected" : "Add to profile"}
          disabled={
            !selectedProfile
            || bulkRemoveBusy
            || (editMode && selectedItems.length === 0)
          }
          onClick={() => {
            if (editMode) {
              if (selectedItems.length === 0 || bulkRemoveBusy) {
                return;
              }
              setBulkRemoveRevealed(LIBRARY_BULK_DELETE_PREVIEW);
              setPendingRemoveRows(selectedItems);
              setBulkRemoveOpen(true);
              return;
            }
            onOpenAddModal();
          }}
        >
          {editMode ? (
            <Trash2 size={20} strokeWidth={2} aria-hidden />
          ) : (
            <Plus size={20} strokeWidth={2} aria-hidden />
          )}
        </button>
      </ChromeTooltip>
      <ConfirmDialog
        open={pendingDiscard !== null}
        title={pendingDiscard ? discardResourceTitle(pendingDiscard) : ""}
        description={pendingDiscard ? discardResourceDescription() : ""}
        tone="destructive"
        confirmLabel="Discard"
        cancelLabel="Cancel"
        onCancel={() => setPendingDiscard(null)}
        onConfirm={() => {
          if (!pendingDiscard) {
            return;
          }
          const item = pendingDiscard;
          setPendingDiscard(null);
          void runDiscard(item);
        }}
      >
        {pendingDiscard ? (
          <DiscardPathList
            key={pendingDiscard.key}
            rows={collectDiscardPathRows([pendingDiscard])}
            showLabels={false}
          />
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={pendingDiscardAll !== null && pendingDiscardAll.length > 0}
        title={
          pendingDiscardAll ? discardAllTitle(pendingDiscardAll.length) : ""
        }
        description={
          pendingDiscardAll ? discardAllDescription(pendingDiscardAll.length) : ""
        }
        tone="destructive"
        confirmLabel="Discard all"
        cancelLabel="Cancel"
        onCancel={() => setPendingDiscardAll(null)}
        onConfirm={() => {
          if (!pendingDiscardAll || pendingDiscardAll.length === 0) {
            return;
          }
          const rows = pendingDiscardAll;
          setPendingDiscardAll(null);
          void runDiscardAll(rows);
        }}
      >
        {pendingDiscardAll ? (
          <DiscardPathList
            key={`discard-all-${pendingDiscardAll.length}`}
            rows={collectDiscardPathRows(pendingDiscardAll)}
            showLabels
          />
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={bulkRemoveOpen}
        title="Remove from profile?"
        description={
          <>
            <p className="muted">
              These items will be removed from the profile.
            </p>
            <ul className="library-bulk-delete-list">
              {bulkRemoveLines.slice(0, bulkRemoveVisibleCount).map((item) => (
                <li key={item.id}>{item.line}</li>
              ))}
            </ul>
            {bulkRemoveVisibleCount < bulkRemoveLines.length ? (
              <div className="library-contained-more">
                <button
                  type="button"
                  className="link-btn"
                  disabled={bulkRemoveBusy}
                  onClick={() => {
                    setBulkRemoveRevealed(
                      (current) => current + LIBRARY_BULK_DELETE_PREVIEW,
                    );
                  }}
                >
                  Show more
                </button>
                <button
                  type="button"
                  className="link-btn"
                  disabled={bulkRemoveBusy}
                  onClick={() => {
                    setBulkRemoveRevealed(bulkRemoveLines.length);
                  }}
                >
                  {libraryBulkDeleteShowAllLabel(bulkRemoveLines.length)}
                </button>
              </div>
            ) : null}
          </>
        }
        tone="destructive"
        confirmLabel="Remove"
        confirmBusy={bulkRemoveBusy}
        confirmDisabled={bulkRemoveLines.length === 0}
        onConfirm={() => {
          void runRemoveAll(pendingRemoveRows);
        }}
        onCancel={() => {
          if (!bulkRemoveBusy) {
            setBulkRemoveOpen(false);
            setBulkRemoveRevealed(LIBRARY_BULK_DELETE_PREVIEW);
            setPendingRemoveRows([]);
          }
        }}
      />
    </div>
  );
}
