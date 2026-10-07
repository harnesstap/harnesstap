import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ResourceRowDescription,
  ResourceRowIdentity,
  ResourceRowRoot,
  ResourceRowTrailing,
} from "@/components/ui/resource-row";
import {
  discoverListEmptyCopy,
  discoverListItemEstimateSize,
  flattenDiscoverListItems,
  hoverModelFromSourcesHit,
  presenceLabel,
  sourcesHitRowDetail,
  sourcesHitUpdateBadge,
  DISCOVER_LIST_ROW_HEIGHT,
  type DiscoverListGroupError,
  type DiscoverListVirtualItem,
  type Presence,
  type SourcesHit,
  type SourcesHitGroup,
} from "../lib/sources-search";
import { resourceRowVirtualStyle } from "../lib/resource-row-virtual";
import { Cloud, FilterX, Library, LogIn } from "lucide-react";
import { ChromeTooltip } from "./ChromeTooltip";
import { EmptyState, type EmptyStateAction } from "./EmptyState";
import { IconActionButton } from "./IconActionButton";
import { Skeleton } from "./shell/Skeleton";
import {
  SourcesRecordActions,
  type SourcesRecordActionsProps,
} from "./SourcesRecordActions";

export const CLOUD_SIGN_IN_HINT = "Sign in from the Cloud account control";

export type SourcesGroupError = DiscoverListGroupError;

export interface SourcesListPaneProps {
  groups: SourcesHitGroup[];
  groupErrors: Record<string, SourcesGroupError>;
  loading: boolean;
  query: string;
  notInLibrary?: boolean;
  unfilteredCount?: number;
  disabled?: boolean;
  onOpenHit: (hit: SourcesHit) => void;
  onSignIn?: () => void;
  onClearSearch?: () => void;
  onClearQuery?: () => void;
  onClearFilters?: () => void;
  recordActions?: (hit: SourcesHit) => SourcesRecordActionsProps;
}

export function SourcesOriginUpdateBadge({ hit }: { hit: SourcesHit }) {
  const label = sourcesHitUpdateBadge(hit);
  if (!label) {
    return null;
  }
  return (
    <span className="pill warn" data-testid="sources-origin-update">
      Update available
    </span>
  );
}

export function SourcesSignInPrompt({
  onSignIn,
  disabled = false,
}: {
  onSignIn?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="banner" role="status">
      <p>Cloud sign-in required</p>
      {onSignIn ? (
        <IconActionButton
          primary
          showLabel
          label="Sign in"
          onClick={onSignIn}
          disabled={disabled}
          icon={<LogIn size={16} aria-hidden />}
        />
      ) : (
        <p className="muted">{CLOUD_SIGN_IN_HINT}</p>
      )}
    </div>
  );
}

const PRESENCE_ICON_SIZE = 14;

function presenceGlyph(presence: Presence): ReactNode {
  switch (presence) {
    case "in_library":
      return <Library size={PRESENCE_ICON_SIZE} aria-hidden />;
    case "remote_only":
      return <Cloud size={PRESENCE_ICON_SIZE} aria-hidden />;
    default: {
      const neverPresence: never = presence;
      return neverPresence;
    }
  }
}

export function SourcesPresenceIcon({ presence }: { presence: Presence }) {
  const label = presenceLabel(presence);
  return (
    <ChromeTooltip content={label}>
      <span
        className="sources-presence"
        data-testid="sources-presence"
        role="img"
        aria-label={label}
      >
        {presenceGlyph(presence)}
      </span>
    </ChromeTooltip>
  );
}

function DiscoverListItem({
  item,
  disabled,
  onOpenHit,
  onSignIn,
  recordActions,
}: {
  item: DiscoverListVirtualItem;
  disabled: boolean;
  onOpenHit: (hit: SourcesHit) => void;
  onSignIn?: () => void;
  recordActions?: (hit: SourcesHit) => SourcesRecordActionsProps;
}) {
  switch (item.kind) {
    case "heading":
      return (
        <h3 className="resources-type-heading">
          <span>{item.sourceLabel}</span>
          <span className="muted">{item.count}</span>
        </h3>
      );
    case "error":
      return item.error.authRequired ? (
        <SourcesSignInPrompt onSignIn={onSignIn} disabled={disabled} />
      ) : (
        <div className="banner error" role="alert">
          {item.error.message}
        </div>
      );
    case "hit": {
      const hit = item.hit;
      const actions = recordActions?.(hit);
      const detail = sourcesHitRowDetail(hit);
      return (
        <div className="resources-list-item">
          <ResourceRowRoot
            hover={hoverModelFromSourcesHit(hit)}
            testId={`sources-hit-${hit.id}`}
            className="sources-hit"
            disabled={disabled}
            onActivate={() => onOpenHit(hit)}
          >
            <ResourceRowIdentity
              type={hit.kind === "plugin" ? "plugin" : hit.typeLabel}
              label={hit.name}
              onOpen={() => onOpenHit(hit)}
            >
              <ResourceRowDescription className="sources-hit-summary">
                <SourcesPresenceIcon presence={hit.presence} />
                <SourcesOriginUpdateBadge hit={hit} />
                {detail ? (
                  <span className="sources-hit-summary-text">{detail}</span>
                ) : null}
              </ResourceRowDescription>
            </ResourceRowIdentity>
            {actions ? (
              <ResourceRowTrailing>
                <SourcesRecordActions {...actions} variant="list" />
              </ResourceRowTrailing>
            ) : null}
          </ResourceRowRoot>
        </div>
      );
    }
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

export function SourcesListPane({
  groups,
  groupErrors,
  loading,
  query,
  notInLibrary = false,
  unfilteredCount,
  disabled = false,
  onOpenHit,
  onSignIn,
  onClearSearch,
  onClearQuery,
  onClearFilters,
  recordActions,
}: SourcesListPaneProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const items = flattenDiscoverListItems({ groups, groupErrors });

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const item = items[index];
      return item ? discoverListItemEstimateSize(item) : DISCOVER_LIST_ROW_HEIGHT;
    },
    overscan: 8,
    getItemKey: (index) => items[index]?.key ?? index,
  });

  if (loading && items.length === 0) {
    return <Skeleton lines={4} />;
  }

  if (items.length === 0) {
    const empty = discoverListEmptyCopy({ query, notInLibrary, unfilteredCount });
    const clearSearch = onClearQuery ?? onClearSearch;
    let action: EmptyStateAction | undefined;
    switch (empty.action) {
      case "clear-search":
        if (clearSearch) {
          action = {
            label: "Clear search",
            onClick: clearSearch,
            icon: <FilterX size={16} aria-hidden />,
          };
        }
        break;
      case "clear-filters":
        if (onClearFilters) {
          action = {
            label: "Clear filters",
            onClick: onClearFilters,
            icon: <FilterX size={16} aria-hidden />,
          };
        }
        break;
      case null:
        break;
      default: {
        const neverAction: never = empty.action;
        return neverAction;
      }
    }
    return (
      <EmptyState
        className="discover-empty"
        testId="discover-empty"
        title={empty.message}
        body={empty.hint}
        action={action}
      />
    );
  }

  return (
    <div
      ref={parentRef}
      className="sources-list"
      data-testid="sources-list"
    >
      <div
        className="resources-list sources-list-virtual"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          if (!item) {
            return null;
          }
          return (
            <div
              key={item.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="resources-list-virtual-item"
              style={resourceRowVirtualStyle(virtualRow.start)}
            >
              <DiscoverListItem
                item={item}
                disabled={disabled}
                onOpenHit={onOpenHit}
                onSignIn={onSignIn}
                recordActions={recordActions}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
