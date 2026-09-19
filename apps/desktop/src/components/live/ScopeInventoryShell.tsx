import { useMemo, useRef, useState, type RefObject } from "react";
import { Plus } from "lucide-react";
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
import { ConfirmDialog } from "../ConfirmDialog";
import { InventorySection } from "./InventorySection";
import { LiveHeader } from "./LiveHeader";
import type { TypeTabAttention } from "../../lib/resource-type-tabs";
import type { ResourceDetailTarget } from "../ResourceDetailPane";

export interface ScopeInventoryShellProps {
  search: string;
  onSearch: (value: string) => void;
  typeCounts: ReadonlyMap<string, number>;
  attention: ReadonlyMap<string, TypeTabAttention>;
  typeTab: string | null;
  onTypeTab: (next: string | null) => void;
  items: ProfileInventoryItem[];
  selectedProfile: string | null;
  selectedIsActive: boolean;
  editMode: boolean;
  railPrimaryIsReapply: boolean;
  inactiveHeaderHint: string | null;
  onAddResource?: (
    resource: ProfileContentsResource,
    profileOverride?: string,
    options?: { skipAutoReapply?: boolean },
  ) => Promise<void>;
  onActivateResources?: (resources: ProfileContentsResource[]) => Promise<void>;
  onAfterAdds?: (addedName: string) => Promise<void>;
  onOpenResource: (target: ResourceDetailTarget) => void;
  onOpenPlugin?: (pluginName: string) => void;
  onDiff?: (item: ProfileInventoryItem) => void;
  onRemoveFromProfile?: (item: ProfileInventoryItem) => Promise<void> | void;
  onOpenAddModal: () => void;
  addingAllResources?: boolean;
  activatingResources?: boolean;
}

function batchLabel(
  verb: "Adding" | "Activating",
  done: number,
  total: number,
): string {
  return `${verb} ${Math.min(done, total)} of ${total}…`;
}

export function ScopeInventoryShell({
  search,
  onSearch,
  typeCounts,
  attention,
  typeTab,
  onTypeTab,
  items,
  selectedProfile,
  selectedIsActive,
  editMode,
  railPrimaryIsReapply,
  inactiveHeaderHint,
  onAddResource,
  onActivateResources,
  onAfterAdds,
  onOpenResource,
  onOpenPlugin,
  onDiff,
  onRemoveFromProfile,
  onOpenAddModal,
  addingAllResources = false,
  activatingResources = false,
}: ScopeInventoryShellProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [moves, setMoves] = useState<Map<string, ProfileInventorySectionId>>(
    () => new Map(),
  );
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set());
  const [addProgress, setAddProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [activateProgress, setActivateProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<ProfileInventoryItem | null>(
    null,
  );

  const displayed = useMemo(
    () => applyOptimisticInventoryMoves(items, moves),
    [items, moves],
  );
  const bySection = useMemo(() => {
    return {
      not_in_profile: displayed.filter((item) => item.section === "not_in_profile"),
      inactive: displayed.filter((item) => item.section === "inactive"),
      active: displayed.filter((item) => item.section === "active"),
    };
  }, [displayed]);

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

  const runRemove = async (item: ProfileInventoryItem) => {
    if (!onRemoveFromProfile) {
      return;
    }
    const key = membershipKey(item.resource);
    const from = item.section;
    markPending(key, "not_in_profile");
    try {
      await onRemoveFromProfile(item);
      clearPending(key);
    } catch {
      clearPending(key, from);
      toast({
        tone: "error",
        title: `Could not remove ${item.label}`,
        action: {
          label: "Retry",
          onClick: () => {
            void runRemove(item);
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
                scrollRef={scrollRef as RefObject<HTMLDivElement | null>}
                editMode={editMode}
                profileName={selectedProfile}
                selectedIsActive={selectedIsActive}
                pendingKeys={pendingKeys}
                batchLabel={
                  section === "not_in_profile" && addProgress
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
                canActivateAll={
                  section === "inactive"
                  && selectedIsActive
                  && Boolean(onActivateResources)
                }
                addAllPrimary={!railPrimaryIsReapply}
                addingAll={addingAllResources || addProgress !== null}
                activatingAll={activatingResources || activateProgress !== null}
                headerHint={hint}
                onAddAll={
                  section === "not_in_profile" ? () => void runAddAll(rows) : undefined
                }
                onActivateAll={
                  section === "inactive" ? () => void runActivateAll(rows) : undefined
                }
                onAdd={onAddResource ? (item) => void runAdd(item) : undefined}
                onActivate={
                  onActivateResources ? (item) => void runActivate(item) : undefined
                }
                onOpenResource={onOpenResource}
                onOpenPlugin={onOpenPlugin}
                onDiff={onDiff}
                onRemoveFromProfile={
                  onRemoveFromProfile ? (item) => setPendingRemove(item) : undefined
                }
              />
            );
          })}
          {displayed.length === 0 ? (
            <p className="muted">No matching resources.</p>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="scope-inventory-fab icon-action primary"
        data-testid="scope-inventory-fab"
        aria-label="Add to profile"
        disabled={!selectedProfile}
        onClick={onOpenAddModal}
      >
        <Plus size={20} strokeWidth={2} aria-hidden />
      </button>
      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remove from profile"
        description={
          pendingRemove
            ? `Remove ${pendingRemove.label} from ${selectedProfile}?`
            : ""
        }
        tone="destructive"
        confirmLabel="Remove"
        cancelLabel="Cancel"
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          if (!pendingRemove) {
            return;
          }
          const item = pendingRemove;
          setPendingRemove(null);
          void runRemove(item);
        }}
      />
    </div>
  );
}
