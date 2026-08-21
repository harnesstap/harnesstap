import type { SourcesHit, SourcesHitGroup } from "../lib/sources-search";
import { presenceLabel, sourcesHitUpdateBadge } from "../lib/sources-search";
import { TypeIcon } from "./TypeIcon";

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
  disabled?: boolean;
  onOpenHit: (hit: SourcesHit) => void;
  onSignIn?: () => void;
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
        <button
          type="button"
          className="btn primary"
          onClick={onSignIn}
          disabled={disabled}
        >
          Sign in
        </button>
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
  disabled = false,
  onOpenHit,
  onSignIn,
}: SourcesListPaneProps) {
  const visible = groups.filter(
    (group) => group.hits.length > 0 || groupErrors[group.sourceId] !== undefined,
  );

  if (loading && visible.length === 0) {
    return (
      <div className="empty-state">
        <p className="muted">Searching…</p>
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="empty-state">
        <p className="muted">
          {query.trim() ? "No hits yet." : "Search sources"}
        </p>
      </div>
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
              {group.hits.map((hit) => (
                <li className="resources-list-item" key={hit.id}>
                  <button
                    type="button"
                    className="resource-row sources-hit"
                    data-testid={`sources-hit-${hit.id}`}
                    disabled={disabled}
                    onClick={() => onOpenHit(hit)}
                  >
                    <span className="resource-row-identity">
                      <span className="resource-row-identity-main">
                        <TypeIcon
                          type={hit.kind === "plugin" ? "plugin" : hit.typeLabel}
                        />
                        <span className="resource-row-name">{hit.name}</span>
                      </span>
                      <span className="resource-row-desc muted">
                        <span className="badge" data-testid="sources-presence">
                          {presenceLabel(hit.presence)}
                        </span>
                        <SourcesOriginUpdateBadge hit={hit} />
                        {hit.version || hit.typeLabel
                          ? ` · ${hit.version ?? hit.typeLabel}`
                          : null}
                        {hit.description ? ` · ${hit.description}` : null}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
