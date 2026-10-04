import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ResourceRowDescription,
  ResourceRowIdentity,
  ResourceRowLeading,
  ResourceRowRoot,
  ResourceRowTrailing,
} from "@/components/ui/resource-row";
import {
  discoverListEmptyCopy,
  discoverListItemEstimateSize,
  flattenDiscoverListItems,
  hoverModelFromSourcesHit,
  presenceLabel,
  sourcesHitUpdateBadge,
  DISCOVER_LIST_ROW_HEIGHT,
  type DiscoverListGroupError,
  type DiscoverListVirtualItem,
  type SourcesHit,
  type SourcesHitGroup,
} from "../lib/sources-search";
import { resourceRowVirtualStyle } from "../lib/resource-row-virtual";
import { FilterX, LogIn } from "lucide-react";
import { EmptyState, type EmptyStateAction } from "./EmptyState";
import { InUseMark } from "./InUseMark";
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
      const inLibrary = hit.presence === "in_library";
      const actions = recordActions?.(hit);
      return (
        <div className="resources-list-item">
          <ResourceRowRoot
            hover={hoverModelFromSourcesHit(hit)}
            testId={`sources-hit-${hit.id}`}
            className="sources-hit"
            disabled={disabled}
            onActivate={() => onOpenHit(hit)}
          >
            {inLibrary ? (
              <ResourceRowLeading>
                <InUseMark membership={{ onGlobal: false, projectCount: 0 }} />
              </ResourceRowLeading>
            ) : null}
            <ResourceRowIdentity
              type={hit.kind === "plugin" ? "plugin" : hit.typeLabel}
              label={hit.name}
              onOpen={() => onOpenHit(hit)}
            >
              <ResourceRowDescription>
                <span className="badge" data-testid="sources-presence">
                  {presenceLabel(hit.presence)}
                </span>
                <SourcesOriginUpdateBadge hit={hit} />
                {hit.version || hit.typeLabel
                  ? ` · ${hit.version ?? hit.typeLabel}`
                  : null}
                {hit.description ? ` · ${hit.description}` : null}
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
    const empty = discoverListEmptyCopy({ query, notInLibrary });
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
