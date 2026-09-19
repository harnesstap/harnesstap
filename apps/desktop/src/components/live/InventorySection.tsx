import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleCheck, CircleDashed, CirclePause, ListPlus, Power } from "lucide-react";
import {
  INVENTORY_ROW_HEIGHT_PX,
  type ProfileInventoryItem,
  type ProfileInventorySectionId,
} from "../../lib/profile-inventory";
import { resourceRowVirtualStyle } from "../../lib/resource-row-virtual";
import { IconActionButton } from "../IconActionButton";
import { Collapse } from "../motion/Collapse";
import type { ResourceDetailTarget } from "../ResourceDetailPane";
import { InventoryRow } from "./InventoryRow";
import { ICON_SIZE } from "./shared";

export function inventorySectionTitle(section: ProfileInventorySectionId): string {
  switch (section) {
    case "not_in_profile":
      return "Not in profile";
    case "inactive":
      return "Inactive";
    case "active":
      return "Active";
    default: {
      const neverSection: never = section;
      return neverSection;
    }
  }
}

function inventorySectionGlyph(section: ProfileInventorySectionId): ReactNode {
  switch (section) {
    case "not_in_profile":
      return <CircleDashed size={ICON_SIZE} strokeWidth={2} aria-hidden />;
    case "inactive":
      return <CirclePause size={ICON_SIZE} strokeWidth={2} aria-hidden />;
    case "active":
      return <CircleCheck size={ICON_SIZE} strokeWidth={2} aria-hidden />;
    default: {
      const neverSection: never = section;
      return neverSection;
    }
  }
}

export interface InventorySectionProps {
  section: ProfileInventorySectionId;
  rows: ProfileInventoryItem[];
  scrollRef: RefObject<HTMLDivElement | null>;
  editMode: boolean;
  profileName: string | null;
  selectedIsActive: boolean;
  pendingKeys: ReadonlySet<string>;
  batchLabel: string | null;
  canAddAll: boolean;
  canActivateAll: boolean;
  addAllPrimary: boolean;
  addingAll: boolean;
  activatingAll: boolean;
  headerHint?: string | null;
  onAddAll?: () => void;
  onActivateAll?: () => void;
  onAdd?: (item: ProfileInventoryItem) => void;
  onActivate?: (item: ProfileInventoryItem) => void;
  onOpenResource: (target: ResourceDetailTarget) => void;
  onOpenPlugin?: (pluginName: string) => void;
  onDiff?: (item: ProfileInventoryItem) => void;
  onRemoveFromProfile?: (item: ProfileInventoryItem) => void;
}

export function InventorySection({
  section,
  rows,
  scrollRef,
  editMode,
  profileName,
  selectedIsActive,
  pendingKeys,
  batchLabel,
  canAddAll,
  canActivateAll,
  addAllPrimary,
  addingAll,
  activatingAll,
  headerHint,
  onAddAll,
  onActivateAll,
  onAdd,
  onActivate,
  onOpenResource,
  onOpenPlugin,
  onDiff,
  onRemoveFromProfile,
}: InventorySectionProps) {
  const title = inventorySectionTitle(section);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      const list = listRef.current;
      const scroll = scrollRef.current;
      if (!list || !scroll) {
        return;
      }
      const next =
        list.getBoundingClientRect().top
        - scroll.getBoundingClientRect().top
        + scroll.scrollTop;
      setScrollMargin(next);
    };
    measure();
    const scroll = scrollRef.current;
    scroll?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      scroll?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [rows.length, scrollRef]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => INVENTORY_ROW_HEIGHT_PX,
    overscan: 10,
    scrollMargin,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const skipCollapse = rows.length > 50;

  if (rows.length === 0 && !headerHint) {
    return null;
  }

  return (
    <section className="contents-block inventory-section" aria-label={title}>
      <header className="contents-header">
        <span className="contents-header-title inventory-section-label">
          <span className="inventory-status-glyph" aria-hidden>
            {inventorySectionGlyph(section)}
          </span>
          <span>{title}</span>
          <span className="inventory-section-count">{rows.length}</span>
        </span>
        {batchLabel ? (
          <span className="muted inventory-batch-progress">{batchLabel}</span>
        ) : null}
        {!editMode && canAddAll && onAddAll ? (
          <span className="contents-header-toolbar">
            <IconActionButton
              primary={addAllPrimary}
              showLabel
              iconAfterLabel
              busy={addingAll}
              spinnerSize={ICON_SIZE}
              label="Add all"
              title={`Add all ${rows.length} items to ${profileName}`}
              onClick={onAddAll}
              icon={<ListPlus size={ICON_SIZE} strokeWidth={2} aria-hidden />}
            />
          </span>
        ) : null}
        {!editMode && canActivateAll && onActivateAll ? (
          <span className="contents-header-toolbar">
            <IconActionButton
              showLabel
              iconAfterLabel
              busy={activatingAll}
              spinnerSize={ICON_SIZE}
              label="Activate all"
              title={`Activate ${rows.length} items`}
              onClick={onActivateAll}
              icon={<Power size={ICON_SIZE} strokeWidth={2} aria-hidden />}
            />
          </span>
        ) : null}
      </header>
      {headerHint ? <p className="muted inventory-section-hint">{headerHint}</p> : null}
      <Collapse open={rows.length > 0} skipAnimation={skipCollapse}>
        <div
          ref={listRef}
          className="contents-body inventory-section-virtual"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualRows.map((virtualRow) => {
            const item = rows[virtualRow.index];
            if (!item) {
              return null;
            }
            const key = `${item.resource.type}:${item.resource.name}`;
            return (
              <div
                key={item.key}
                className="inventory-virtual-row m-fade-in"
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={resourceRowVirtualStyle(virtualRow.start, scrollMargin)}
              >
                <InventoryRow
                  item={item}
                  editMode={editMode}
                  profileName={profileName}
                  pending={pendingKeys.has(key)}
                  selectedIsActive={selectedIsActive}
                  onAdd={onAdd ? () => onAdd(item) : undefined}
                  onActivate={onActivate ? () => onActivate(item) : undefined}
                  onOpenResource={onOpenResource}
                  onOpenPlugin={onOpenPlugin}
                  onDiff={onDiff ? () => onDiff(item) : undefined}
                  onRemoveFromProfile={
                    onRemoveFromProfile ? () => onRemoveFromProfile(item) : undefined
                  }
                />
              </div>
            );
          })}
        </div>
      </Collapse>
    </section>
  );
}
