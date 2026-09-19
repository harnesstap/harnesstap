import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { InUseMark } from "../InUseMark";
import {
  ResourceRowDescription,
  ResourceRowIdentity,
  ResourceRowLeading,
  ResourceRowRoot,
  ResourceRowScopeChip,
} from "../ui/resource-row";
import {
  LIBRARY_ROW_HEIGHT,
  LIBRARY_ROW_HEIGHT_WITH_SUBTITLE,
  libraryFilterType,
  libraryRowBadge,
  libraryRowHeight,
  libraryRowSelector,
  libraryRowUpdateBadge,
  parseLibraryScopeName,
  scopedCopyHoverText,
  type LibraryListEntry,
  type ScopedLibraryRow,
} from "../../lib/library-list";
import { libraryInUseForEntry, type LibraryInUseMembership } from "../../lib/library-in-use";
import {
  isLibraryListNavKey,
  isLibraryTypeaheadChar,
  LIBRARY_TYPEAHEAD_MS,
  matchLibraryTypeahead,
  nextLibraryListIndex,
} from "../../lib/library-list-nav";
import { hoverModelFromLibraryResource } from "../../lib/resource-hover";
import { resourceDisplayName } from "../../lib/resource-search";

export interface LibraryResourceListProps {
  rows: Array<ScopedLibraryRow<LibraryListEntry>>;
  inUseIndex: Map<string, LibraryInUseMembership>;
  disabled?: boolean;
  lastSelector: string | null;
  enteringIds: ReadonlySet<string>;
  onOpen: (entry: LibraryListEntry) => void;
  onActiveSelectorChange?: (selector: string | null) => void;
}

export function LibraryResourceList({
  rows,
  inUseIndex,
  disabled = false,
  lastSelector,
  enteringIds,
  onOpen,
  onActiveSelectorChange,
}: LibraryResourceListProps): ReactNode {
  const listId = useId();
  const parentRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef({ buffer: "", timer: 0 });
  const [activeIndex, setActiveIndex] = useState(0);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      return row ? libraryRowHeight(row) : LIBRARY_ROW_HEIGHT;
    },
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  const labels = rows.map((row) => resourceDisplayName(row));
  const activeIndexRef = useRef(0);
  activeIndexRef.current = activeIndex;
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  useEffect(() => {
    if (rows.length === 0) {
      setActiveIndex(0);
      onActiveSelectorChange?.(null);
      return;
    }
    const lastIndex = lastSelector
      ? rows.findIndex((row) => libraryRowSelector(row) === lastSelector)
      : -1;
    const nextIndex = lastIndex >= 0
      ? lastIndex
      : Math.min(activeIndexRef.current, rows.length - 1);
    setActiveIndex(nextIndex);
    const active = rows[nextIndex];
    onActiveSelectorChange?.(active ? libraryRowSelector(active) : null);
    if (lastIndex >= 0) {
      virtualizerRef.current.scrollToIndex(lastIndex, { align: "auto" });
      window.requestAnimationFrame(() => {
        document.getElementById(`${listId}-option-${lastIndex}`)?.focus();
      });
    }
  }, [lastSelector, listId, onActiveSelectorChange, rows]);

  const moveTo = useCallback(
    (index: number) => {
      if (rows.length === 0) {
        return;
      }
      const next = Math.min(Math.max(index, 0), rows.length - 1);
      setActiveIndex(next);
      const row = rows[next];
      onActiveSelectorChange?.(row ? libraryRowSelector(row) : null);
      virtualizer.scrollToIndex(next, { align: "auto" });
      const option = document.getElementById(`${listId}-option-${next}`);
      option?.focus();
    },
    [onActiveSelectorChange, rows, virtualizer],
  );

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (disabled || rows.length === 0) {
      return;
    }
    if (isLibraryListNavKey(event.key)) {
      event.preventDefault();
      moveTo(nextLibraryListIndex(activeIndex, event.key, rows.length));
      return;
    }
    if (event.key === "Enter") {
      const row = rows[activeIndex];
      if (row) {
        event.preventDefault();
        onOpen(row);
      }
      return;
    }
    if (!isLibraryTypeaheadChar(event.key) || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    event.preventDefault();
    window.clearTimeout(typeaheadRef.current.timer);
    typeaheadRef.current.buffer += event.key;
    const match = matchLibraryTypeahead(labels, typeaheadRef.current.buffer, activeIndex);
    if (match >= 0) {
      moveTo(match);
    }
    typeaheadRef.current.timer = window.setTimeout(() => {
      typeaheadRef.current.buffer = "";
    }, LIBRARY_TYPEAHEAD_MS);
  }

  useEffect(() => {
    return () => {
      window.clearTimeout(typeaheadRef.current.timer);
    };
  }, []);

  return (
    <div
      ref={parentRef}
      className="resources-list-viewport"
      role="listbox"
      aria-label="Library resources"
      aria-activedescendant={
        rows[activeIndex] ? `${listId}-option-${activeIndex}` : undefined
      }
      onKeyDown={handleListKeyDown}
    >
      <div
        className="resources-list"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const entry = rows[virtualRow.index];
          if (!entry) {
            return null;
          }
          const label = resourceDisplayName(entry);
          const visibleLabel = entry.scopedProfile
            ? parseLibraryScopeName(label).base
            : label;
          const badge = libraryRowBadge(entry);
          const updateBadge = libraryRowUpdateBadge(entry);
          const filterType = libraryFilterType(entry);
          const inUse = libraryInUseForEntry(entry, inUseIndex);
          const selector = libraryRowSelector(entry);
          const isActive = virtualRow.index === activeIndex;
          const isCurrent = lastSelector === selector;
          const hover = hoverModelFromLibraryResource(entry);
          if (entry.scopedProfile) {
            hover.extra = [
              ...hover.extra,
              { kind: "note", text: scopedCopyHoverText(entry.scopedProfile) },
            ];
          }
          const height = libraryRowHeight(entry);
          return (
            <div
              key={entry.id}
              className="resources-list-virtual-item"
              style={{
                height,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <ResourceRowRoot
                id={`${listId}-option-${virtualRow.index}`}
                role="option"
                tabIndex={isActive ? 0 : -1}
                aria-selected={isActive}
                aria-current={isCurrent ? "true" : undefined}
                hover={hover}
                testId={`resource-row-${label}`}
                disabled={disabled}
                className={[
                  entry.scopedProfile ? "resource-row-scoped" : null,
                  isCurrent ? "is-current" : null,
                  height === LIBRARY_ROW_HEIGHT_WITH_SUBTITLE ? "has-subtitle" : null,
                  enteringIds.has(entry.id) ? "m-fade-in" : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                ariaLabel={label}
                onActivate={() => onOpen(entry)}
                onFocus={() => {
                  setActiveIndex(virtualRow.index);
                  onActiveSelectorChange?.(selector);
                }}
              >
                <ResourceRowLeading>
                  <InUseMark membership={inUse} />
                </ResourceRowLeading>
                <ResourceRowIdentity
                  type={filterType}
                  label={visibleLabel}
                  accessory={
                    entry.scopedProfile ? (
                      <ResourceRowScopeChip profile={entry.scopedProfile} />
                    ) : null
                  }
                >
                  {updateBadge ? (
                    <span className="pill warn">{updateBadge}</span>
                  ) : null}
                  {badge || entry.description ? (
                    <ResourceRowDescription>
                      {badge}
                      {badge && entry.description ? " · " : null}
                      {entry.description}
                    </ResourceRowDescription>
                  ) : null}
                </ResourceRowIdentity>
              </ResourceRowRoot>
            </div>
          );
        })}
      </div>
    </div>
  );
}
