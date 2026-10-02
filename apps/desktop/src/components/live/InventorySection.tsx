import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CirclePause,
  ListPlus,
  ListX,
  Pencil,
  Power,
} from "lucide-react";
import {
  INVENTORY_CHIP_HEIGHT_PX,
  INVENTORY_CHIP_VIRTUALIZE_MIN_ITEMS,
  groupProfileInventoryByType,
  type ProfileInventoryItem,
  type ProfileInventorySectionId,
  type ProfileInventoryTypeGroup,
} from "../../lib/profile-inventory";
import { listScrollMargin, resourceRowVirtualStyle } from "../../lib/resource-row-virtual";
import { resourceTypeTabLabel } from "../../lib/resource-type-tabs";
import { IconActionButton } from "../IconActionButton";
import { TypeIcon } from "../TypeIcon";
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

function estimateTypeGroupSize(
  group: ProfileInventoryTypeGroup,
  showTypeHeaders: boolean,
): number {
  const header = showTypeHeaders ? 28 : 0;
  const rows = Math.max(1, Math.ceil(group.items.length / 4));
  return header + 6 + rows * INVENTORY_CHIP_HEIGHT_PX;
}

export interface InventorySectionProps {
  section: ProfileInventorySectionId;
  rows: ProfileInventoryItem[];
  typeTab: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  editMode: boolean;
  profileName: string | null;
  selectedIsActive: boolean;
  pendingKeys: ReadonlySet<string>;
  batchLabel: string | null;
  canAddAll: boolean;
  canDiscardAll: boolean;
  canActivateAll: boolean;
  addAllPrimary: boolean;
  addingAll: boolean;
  addingAllDisabled?: boolean;
  discardingAll: boolean;
  activatingAll: boolean;
  headerHint?: string | null;
  onAddAll?: () => void;
  onDiscardAll?: () => void;
  onActivateAll?: () => void;
  onToggleEdit?: () => void;
  onAdd?: (item: ProfileInventoryItem) => void;
  onDiscard?: (item: ProfileInventoryItem) => void;
  onActivate?: (item: ProfileInventoryItem) => void;
  onOpenResource: (target: ResourceDetailTarget) => void;
  onOpenPlugin?: (pluginName: string) => void;
  onDiff?: (item: ProfileInventoryItem) => void;
  selectedIds?: ReadonlySet<string>;
  onToggleSelected?: (item: ProfileInventoryItem) => void;
}

export function InventorySection({
  section,
  rows,
  typeTab,
  scrollRef,
  editMode,
  profileName,
  selectedIsActive,
  pendingKeys,
  batchLabel,
  canAddAll,
  canDiscardAll,
  canActivateAll,
  addAllPrimary,
  addingAll,
  addingAllDisabled = false,
  discardingAll,
  activatingAll,
  headerHint,
  onAddAll,
  onDiscardAll,
  onActivateAll,
  onToggleEdit,
  onAdd,
  onDiscard,
  onActivate,
  onOpenResource,
  onOpenPlugin,
  onDiff,
  selectedIds,
  onToggleSelected,
}: InventorySectionProps) {
  const title = inventorySectionTitle(section);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const toggleExpanded = () => {
    setExpanded((current) => !current);
  };
  const showTypeHeaders = typeTab === null;
  const groups = useMemo(
    () => (showTypeHeaders ? groupProfileInventoryByType(rows) : rows.length > 0
      ? [{ type: typeTab ?? rows[0]?.type ?? "", items: rows }]
      : []),
    [rows, showTypeHeaders, typeTab],
  );
  const virtualizeGroups = rows.length >= INVENTORY_CHIP_VIRTUALIZE_MIN_ITEMS;

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !virtualizeGroups) {
      return;
    }
    const measure = () => {
      const list = listRef.current;
      if (!list) {
        return;
      }
      const next = listScrollMargin(list, scroll);
      setScrollMargin((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    for (const child of scroll.children) {
      observer.observe(child);
    }
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [expanded, groups.length, scrollRef, virtualizeGroups]);

  const virtualizer = useVirtualizer({
    count: virtualizeGroups ? groups.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const group = groups[index];
      return group ? estimateTypeGroupSize(group, showTypeHeaders) : INVENTORY_CHIP_HEIGHT_PX;
    },
    overscan: 4,
    scrollMargin,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const skipCollapse = rows.length > 50;
  const keepEmptyDuringBatch =
    Boolean(batchLabel) || discardingAll || addingAll || activatingAll;

  if (
    rows.length === 0
    && !headerHint
    && !(editMode && onToggleEdit)
    && !keepEmptyDuringBatch
  ) {
    return null;
  }

  const renderChip = (item: ProfileInventoryItem) => {
    const key = `${item.resource.type}:${item.resource.name}`;
    return (
      <InventoryRow
        key={item.key}
        item={item}
        editMode={editMode}
        profileName={profileName}
        pending={pendingKeys.has(key)}
        selectedIsActive={selectedIsActive}
        onAdd={onAdd ? () => onAdd(item) : undefined}
        onDiscard={onDiscard ? () => onDiscard(item) : undefined}
        onActivate={onActivate ? () => onActivate(item) : undefined}
        onOpenResource={onOpenResource}
        onOpenPlugin={onOpenPlugin}
        onDiff={onDiff ? () => onDiff(item) : undefined}
        selected={selectedIds?.has(item.key) ?? false}
        onToggleSelected={
          onToggleSelected ? () => onToggleSelected(item) : undefined
        }
      />
    );
  };

  const renderTypeGroup = (group: ProfileInventoryTypeGroup) => (
    <div
      className="inventory-type-group"
      data-testid="inventory-type-group"
      data-type={group.type}
      aria-label={showTypeHeaders ? resourceTypeTabLabel(group.type) : undefined}
    >
      {showTypeHeaders ? (
        <h3 className="inventory-type-heading">
          <TypeIcon type={group.type} />
          <span>{resourceTypeTabLabel(group.type)}</span>
        </h3>
      ) : null}
      <div className="inventory-chip-cluster">{group.items.map(renderChip)}</div>
    </div>
  );

  return (
    <section
      className="contents-block inventory-section"
      aria-label={title}
      data-state={expanded ? "open" : "closed"}
    >
      <header className="contents-header" onClick={toggleExpanded}>
        <button
          type="button"
          className="contents-header-title inventory-section-label inventory-section-toggle"
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            toggleExpanded();
          }}
        >
          <span className="inventory-section-caret" aria-hidden>
            {expanded ? (
              <ChevronDown size={ICON_SIZE} strokeWidth={2} />
            ) : (
              <ChevronRight size={ICON_SIZE} strokeWidth={2} />
            )}
          </span>
          <span className="inventory-status-glyph" aria-hidden>
            {inventorySectionGlyph(section)}
          </span>
          <span>{title}</span>
          <span className="badge pill inventory-section-count">{rows.length}</span>
        </button>
        {!editMode && (canAddAll || canDiscardAll) ? (
          <span
            className="contents-header-toolbar"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            {batchLabel ? (
              <span className="muted inventory-batch-progress">{batchLabel}</span>
            ) : null}
            {canAddAll && onAddAll ? (
              <IconActionButton
                primary={addAllPrimary}
                showLabel
                iconAfterLabel
                busy={addingAll}
                spinnerSize={ICON_SIZE}
                label="Add all"
                title={`Add all ${rows.length} items to ${profileName}`}
                onClick={onAddAll}
                disabled={addingAllDisabled}
                icon={<ListPlus size={ICON_SIZE} strokeWidth={2} aria-hidden />}
              />
            ) : null}
            {canDiscardAll && onDiscardAll ? (
              <IconActionButton
                className="profile-remove-action"
                showLabel
                iconAfterLabel
                busy={discardingAll}
                spinnerSize={ICON_SIZE}
                label="Discard all"
                title={`Discard ${rows.length} live resources`}
                onClick={onDiscardAll}
                disabled={rows.length === 0}
                icon={<ListX size={ICON_SIZE} strokeWidth={2} aria-hidden />}
              />
            ) : null}
          </span>
        ) : null}
        {!editMode && canActivateAll && onActivateAll ? (
          <span
            className="contents-header-toolbar"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            {batchLabel ? (
              <span className="muted inventory-batch-progress">{batchLabel}</span>
            ) : null}
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
        {onToggleEdit ? (
          <span
            className="contents-header-toolbar"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <IconActionButton
              showLabel
              iconAfterLabel
              data-testid="inventory-active-edit"
              label={editMode ? "Done" : "Edit"}
              title={editMode ? "Done" : "Edit"}
              onClick={onToggleEdit}
              icon={
                editMode ? (
                  <Check size={ICON_SIZE} strokeWidth={2} aria-hidden />
                ) : (
                  <Pencil size={ICON_SIZE} strokeWidth={2} aria-hidden />
                )
              }
            />
          </span>
        ) : null}
      </header>
      <Collapse
        open={expanded}
        skipAnimation={skipCollapse}
        className="inventory-section-collapse"
      >
        {headerHint ? <p className="muted inventory-section-hint">{headerHint}</p> : null}
        {rows.length > 0 && virtualizeGroups ? (
          <div
            ref={listRef}
            className="contents-body inventory-section-virtual"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualRows.map((virtualRow) => {
              const group = groups[virtualRow.index];
              if (!group) {
                return null;
              }
              return (
                <div
                  key={group.type}
                  className="inventory-virtual-group m-fade-in"
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={resourceRowVirtualStyle(virtualRow.start, scrollMargin)}
                >
                  {renderTypeGroup(group)}
                </div>
              );
            })}
          </div>
        ) : rows.length > 0 ? (
          <div className="contents-body inventory-section-chips">
            {groups.map((group) => (
              <div key={group.type}>{renderTypeGroup(group)}</div>
            ))}
          </div>
        ) : null}
      </Collapse>
    </section>
  );
}
