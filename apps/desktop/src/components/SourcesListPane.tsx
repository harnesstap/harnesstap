import {
  ResourceRowDescription,
  ResourceRowIdentity,
  ResourceRowLeading,
  ResourceRowRoot,
  ResourceRowTrailing,
} from "@/components/ui/resource-row";
import {
  discoverListEmptyCopy,
  hoverModelFromSourcesHit,
  presenceLabel,
  sourcesHitUpdateBadge,
  type SourcesHit,
  type SourcesHitGroup,
} from "../lib/sources-search";
import { FilterX, Library, LogIn } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { InUseMark } from "./InUseMark";
import { IconActionButton } from "./IconActionButton";
import { Skeleton } from "./shell/Skeleton";
import {
  SourcesRecordActions,
  type SourcesRecordActionsProps,
} from "./SourcesRecordActions";

export const CLOUD_SIGN_IN_HINT = "Sign in from the Cloud account control";

export interface SourcesGroupError {
  message: string;
  authRequired: boolean;
}

export interface SourcesListPaneProps {
  groups: SourcesHitGroup[];
  groupErrors: Record<string, SourcesGroupError>;
  loading: boolean;
  query: string;
  showInLibrary?: boolean;
  disabled?: boolean;
  onOpenHit: (hit: SourcesHit) => void;
  onSignIn?: () => void;
  onClearSearch?: () => void;
  onClearQuery?: () => void;
  onShowInLibrary?: () => void;
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

export function SourcesListPane({
  groups,
  groupErrors,
  loading,
  query,
  showInLibrary = false,
  disabled = false,
  onOpenHit,
  onSignIn,
  onClearSearch,
  onClearQuery,
  onShowInLibrary,
  recordActions,
}: SourcesListPaneProps) {
  const visible = groups.filter(
    (group) => group.hits.length > 0 || groupErrors[group.sourceId] !== undefined,
  );

  if (loading && visible.length === 0) {
    return <Skeleton lines={4} />;
  }

  if (visible.length === 0) {
    const empty = discoverListEmptyCopy({ query, showInLibrary });
    const clearSearch = onClearQuery ?? onClearSearch;
    const action =
      empty.action === "clear-search" && clearSearch
        ? {
            label: "Clear search",
            onClick: clearSearch,
            icon: <FilterX size={16} aria-hidden />,
          }
        : empty.action === "show-library" && onShowInLibrary
          ? {
              label: "Show in library",
              onClick: onShowInLibrary,
              icon: <Library size={16} aria-hidden />,
            }
          : undefined;
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
    <div className="sources-list" data-testid="sources-list">
      {visible.map((group) => {
        const groupError = groupErrors[group.sourceId];
        return (
          <section
            className="resources-type-group"
            key={group.sourceId}
            aria-label={group.sourceLabel}
          >
            <h3 className="resources-type-heading">
              <span>{group.sourceLabel}</span>
              <span className="muted">{group.hits.length}</span>
            </h3>
            {groupError ? (
              groupError.authRequired ? (
                <SourcesSignInPrompt onSignIn={onSignIn} disabled={disabled} />
              ) : (
                <div className="banner error" role="alert">
                  {groupError.message}
                </div>
              )
            ) : null}
            <ul className="resources-list">
              {group.hits.map((hit) => {
                const inLibrary = hit.presence === "in_library";
                const actions = recordActions?.(hit);
                return (
                  <li className="resources-list-item" key={hit.id}>
                    <ResourceRowRoot
                      hover={hoverModelFromSourcesHit(hit)}
                      testId={`sources-hit-${hit.id}`}
                      className="sources-hit"
                      disabled={disabled}
                      onActivate={() => onOpenHit(hit)}
                    >
                      {inLibrary ? (
                        <ResourceRowLeading>
                          <InUseMark
                            membership={{ onGlobal: false, projectCount: 0 }}
                          />
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
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
