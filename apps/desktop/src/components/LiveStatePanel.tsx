import { useState, type ReactNode } from "react";
import {
  Bot,
  ExternalLink,
  FileCode2,
  FileText,
  Layers,
  Package,
  Plug,
  Plus,
  Shield,
  Sparkles,
  Terminal,
  Trash2,
  Variable,
  Webhook,
  Wrench,
} from "lucide-react";
import {
  aggregateInstallGaps,
  diffProfileContents,
  fallbackTypeCounts,
  fileChangeAction,
  orderedTypeCounts,
  typeCountsFromItems,
  type ContentsDiffItem,
} from "../lib/contents-diff";
import { relatedHarnessesForResourceType } from "../lib/harness-meta";
import type {
  DriftFileChange,
  HarnessLiveStatus,
  ProfileApplyPreview,
  ProfileContents,
  ProfileContentsLayer,
  ProfileContentsResource,
  ViewScope,
} from "../lib/types";
import { RelatedHarnessIcons } from "./HarnessIcons";
import {
  ResourceDetailPane,
  type ResourceDetailTarget,
} from "./ResourceDetailPane";

const ICON_SIZE = 14;
const FILE_PREVIEW_LIMIT = 8;

function TypeIcon({ type }: { type: string }): ReactNode {
  switch (type) {
    case "layer":
      return <Layers size={ICON_SIZE} aria-hidden />;
    case "skill":
      return <Sparkles size={ICON_SIZE} aria-hidden />;
    case "mcp_server":
      return <Plug size={ICON_SIZE} aria-hidden />;
    case "instruction":
      return <FileText size={ICON_SIZE} aria-hidden />;
    case "rule":
      return <FileCode2 size={ICON_SIZE} aria-hidden />;
    case "agent":
      return <Bot size={ICON_SIZE} aria-hidden />;
    case "command":
      return <Terminal size={ICON_SIZE} aria-hidden />;
    case "hook":
      return <Webhook size={ICON_SIZE} aria-hidden />;
    case "permission":
      return <Shield size={ICON_SIZE} aria-hidden />;
    case "env_var":
      return <Variable size={ICON_SIZE} aria-hidden />;
    case "model_config":
      return <Wrench size={ICON_SIZE} aria-hidden />;
    case "plugin_pin":
      return <Package size={ICON_SIZE} aria-hidden />;
    default:
      return <Wrench size={ICON_SIZE} aria-hidden />;
  }
}

function resourceDetailTarget(
  resource: Pick<ProfileContentsResource, "id" | "type" | "name" | "source">,
): ResourceDetailTarget {
  return {
    selector: resource.id ?? `${resource.type}:${resource.name}`,
    label: resource.name,
    pathHint: resource.source,
  };
}

function ResourceNameButton({
  label,
  path,
  onOpen,
}: {
  label: string;
  path?: string | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="resource-name-btn enabled-label"
      title={path || undefined}
      onClick={onOpen}
    >
      {label}
    </button>
  );
}

function ProfileResourceActions({
  resource,
  layerId,
  profileName,
  removing,
  onOpenInEditor,
  onRemoveFromProfile,
}: {
  resource: ProfileContentsResource;
  layerId?: string;
  profileName: string | null;
  removing: boolean;
  onOpenInEditor?: (resource: ProfileContentsResource) => void;
  onRemoveFromProfile?: (
    resource: ProfileContentsResource,
    layerId?: string,
  ) => void;
}) {
  const canOpen = Boolean(onOpenInEditor);
  const canRemove = Boolean(profileName && onRemoveFromProfile);
  if (!canOpen && !canRemove) {
    return null;
  }

  return (
    <span className="enabled-row-actions">
      {canOpen && onOpenInEditor ? (
        <button
          type="button"
          className="icon-action profile-resource-open-btn"
          aria-label={`Open ${resource.name} in editor`}
          title="Open in default editor"
          onClick={() => onOpenInEditor(resource)}
        >
          <ExternalLink size={ICON_SIZE} strokeWidth={2} aria-hidden />
        </button>
      ) : null}
      {canRemove && onRemoveFromProfile ? (
        <button
          type="button"
          className="icon-action profile-resource-remove-btn"
          aria-label={`Remove ${resource.name} from ${profileName}`}
          title="Remove from profile"
          disabled={removing}
          onClick={() => onRemoveFromProfile(resource, layerId)}
        >
          <Trash2 size={ICON_SIZE} strokeWidth={2} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

type ProfileStackEmptyVariant = "no-overlap" | "empty";

type ProfileStackEmptyStateProps = {
  variant: ProfileStackEmptyVariant;
  onBrowseResources: () => void;
};

const PROFILE_STACK_EMPTY_COPY: Record<
  ProfileStackEmptyVariant,
  { title: string; body: string }
> = {
  "no-overlap": {
    title: "Nothing shared with active",
    body:
      "This profile’s stack is entirely new — see Target preview for what would be added.",
  },
  empty: {
    title: "No resources yet",
    body: "Add layers or resources from your library to build this profile’s stack.",
  },
};

function ProfileStackEmptyState({
  variant,
  onBrowseResources,
}: ProfileStackEmptyStateProps) {
  const copy = PROFILE_STACK_EMPTY_COPY[variant];
  return (
    <div
      className="empty-state profile-stack-empty"
      role="status"
      aria-label={copy.title}
    >
      <div className="profile-stack-empty-heading">
        <Layers size={ICON_SIZE} className="profile-stack-empty-icon" aria-hidden />
        <h2>{copy.title}</h2>
      </div>
      <p className="muted">{copy.body}</p>
      <button
        className="btn primary"
        type="button"
        onClick={onBrowseResources}
      >
        Browse resources
      </button>
    </div>
  );
}

function ResourceSummaryStrip({
  counts,
  label,
}: {
  counts: Record<string, number>;
  label: string;
}) {
  const rows = orderedTypeCounts(counts);
  if (rows.length === 0) {
    return (
      <div className="resource-summary" aria-label={label}>
        <span className="muted">Empty stack</span>
      </div>
    );
  }
  return (
    <div className="resource-summary" aria-label={label}>
      {rows.map((row) => (
        <span className="resource-stat" key={row.type} title={`${row.count} ${row.label}`}>
          <TypeIcon type={row.type} />
          <strong>{row.count}</strong>
          <span>{row.label}</span>
        </span>
      ))}
    </div>
  );
}

function DiffRow({
  item,
  tone,
  onOpenResource,
}: {
  item: ContentsDiffItem;
  tone: "add" | "remove";
  onOpenResource?: (target: ResourceDetailTarget) => void;
}) {
  const selector = item.selector;
  const canOpen =
    item.category === "resource" && Boolean(selector) && Boolean(onOpenResource);
  return (
    <div className={`diff-row ${tone}`}>
      <span className="diff-mark" aria-hidden>
        {tone === "add" ? "+" : "−"}
      </span>
      <span className="diff-body">
        <TypeIcon type={item.iconType} />
        {canOpen && selector && onOpenResource ? (
          <ResourceNameButton
            label={item.label}
            path={item.path}
            onOpen={() =>
              onOpenResource({
                selector,
                label: item.label,
                pathHint: item.path,
              })
            }
          />
        ) : (
          <span className="diff-label" title={item.path || undefined}>
            {item.label}
          </span>
        )}
        {item.detail ? <span className="diff-detail muted">{item.detail}</span> : null}
        <RelatedHarnessIcons
          harnessIds={relatedHarnessesForResourceType(item.iconType)}
        />
      </span>
    </div>
  );
}

function UntrackedResourceRow({
  resource,
  adding,
  onAdd,
  onOpenResource,
}: {
  resource: ProfileContentsResource;
  adding: boolean;
  onAdd: () => void;
  onOpenResource?: (target: ResourceDetailTarget) => void;
}) {
  const selector = resource.id ?? `${resource.type}:${resource.name}`;
  const canOpen = Boolean(onOpenResource);
  return (
    <div className="enabled-row untracked-row">
      <span className="enabled-type">
        <TypeIcon type={resource.type} />
      </span>
      {canOpen && onOpenResource ? (
        <ResourceNameButton
          label={resource.name}
          path={resource.source}
          onOpen={() =>
            onOpenResource({
              selector,
              label: resource.name,
              pathHint: resource.source,
            })
          }
        />
      ) : (
        <span className="enabled-label" title={resource.source || undefined}>
          {resource.name}
        </span>
      )}
      <span className="enabled-trailing">
        <RelatedHarnessIcons
          harnessIds={relatedHarnessesForResourceType(resource.type)}
        />
        <button
          type="button"
          className="icon-action untracked-add-btn"
          aria-label={`Add ${resource.name} to profile`}
          title={`Add ${resource.name} to profile`}
          disabled={adding}
          onClick={onAdd}
        >
          <Plus size={ICON_SIZE} strokeWidth={2} aria-hidden />
        </button>
      </span>
    </div>
  );
}

function EnabledResourceRow({
  item,
  onOpenResource,
}: {
  item: ContentsDiffItem;
  onOpenResource?: (target: ResourceDetailTarget) => void;
}) {
  const selector = item.selector;
  const canOpen =
    item.category === "resource" && Boolean(selector) && Boolean(onOpenResource);
  return (
    <div className="enabled-row">
      <span className="enabled-type">
        <TypeIcon type={item.iconType} />
      </span>
      {canOpen && selector && onOpenResource ? (
        <ResourceNameButton
          label={item.label}
          path={item.path}
          onOpen={() =>
            onOpenResource({
              selector,
              label: item.label,
              pathHint: item.path,
            })
          }
        />
      ) : (
        <span className="enabled-label" title={item.path || undefined}>
          {item.label}
        </span>
      )}
      <span className="enabled-trailing">
        <RelatedHarnessIcons
          harnessIds={relatedHarnessesForResourceType(item.iconType)}
        />
        {item.detail ? <span className="enabled-detail muted">{item.detail}</span> : null}
      </span>
    </div>
  );
}

function EnabledLayerGroup({
  layer,
  profileName,
  removingResourceKey,
  onOpenResource,
  onOpenInEditor,
  onRemoveFromProfile,
}: {
  layer: ProfileContentsLayer;
  profileName: string | null;
  removingResourceKey: string | null;
  onOpenResource: (target: ResourceDetailTarget) => void;
  onOpenInEditor?: (resource: ProfileContentsResource) => void;
  onRemoveFromProfile?: (
    resource: ProfileContentsResource,
    layerId?: string,
  ) => void;
}) {
  const resourceCount = layer.resources?.length ?? 0;
  return (
    <details className="enabled-layer">
      <summary className="enabled-layer-summary">
        <span className="enabled-type">
          <TypeIcon type="layer" />
        </span>
        <span className="enabled-label">{layer.name}</span>
        <span className="enabled-trailing">
          <RelatedHarnessIcons
            harnessIds={relatedHarnessesForResourceType("layer")}
          />
          <span className="enabled-detail muted">
            @{layer.version}
            {resourceCount > 0
              ? ` · ${resourceCount} resource${resourceCount === 1 ? "" : "s"}`
              : ""}
          </span>
        </span>
      </summary>
      <div className="enabled-layer-body">
        {resourceCount === 0 ? (
          <div className="muted enabled-layer-empty">No resources in this layer</div>
        ) : (
          (layer.resources ?? []).map((resource) => {
            const resourceKey = `${resource.type}:${resource.name}`;
            return (
              <div
                className="enabled-row enabled-nested-row"
                key={resourceKey}
              >
                <span className="enabled-type">
                  <TypeIcon type={resource.type} />
                </span>
                <ResourceNameButton
                  label={resource.name}
                  path={resource.source}
                  onOpen={() => onOpenResource(resourceDetailTarget(resource))}
                />
                <span className="enabled-trailing">
                  <RelatedHarnessIcons
                    harnessIds={relatedHarnessesForResourceType(resource.type)}
                  />
                  <ProfileResourceActions
                    resource={resource}
                    layerId={layer.id}
                    profileName={profileName}
                    removing={removingResourceKey === resourceKey}
                    onOpenInEditor={onOpenInEditor}
                    onRemoveFromProfile={onRemoveFromProfile}
                  />
                  <span className="enabled-detail muted">
                    {resource.type.replaceAll("_", " ")}
                  </span>
                </span>
              </div>
            );
          })
        )}
      </div>
    </details>
  );
}

function layerIdentityKey(layer: {
  id: string;
  name: string;
  version: string;
}): string {
  return `layer:${layer.id}:${layer.name}@${layer.version}`;
}

function pinIdentityKey(pin: { ref: string }): string {
  return `pin:${pin.ref}`;
}

function FileChangeRows({ changes }: { changes: DriftFileChange[] }) {
  if (changes.length === 0) {
    return <div className="muted">No file changes vs live target</div>;
  }

  const visible = changes.slice(0, FILE_PREVIEW_LIMIT);
  return (
    <>
      {visible.map((change) => {
        const mapped = fileChangeAction(change);
        return (
          <div
            className={`diff-row ${mapped.action === "add" ? "add" : mapped.action === "remove" ? "remove" : "update"}`}
            key={`${change.type}-${change.path}`}
          >
            <span className="diff-mark" aria-hidden>
              {mapped.action === "add" ? "+" : mapped.action === "remove" ? "−" : "~"}
            </span>
            <span className="diff-body">
              <span className="diff-label mono">{change.path}</span>
              <span className="diff-detail muted">{mapped.label}</span>
              {change.platform ? (
                <RelatedHarnessIcons harnessIds={[change.platform]} />
              ) : null}
            </span>
          </div>
        );
      })}
      {changes.length > FILE_PREVIEW_LIMIT ? (
        <div className="muted">
          {changes.length - FILE_PREVIEW_LIMIT} more…
        </div>
      ) : null}
    </>
  );
}

function allItemsFromContents(
  contents: ProfileContents | null | undefined,
): ContentsDiffItem[] {
  return diffProfileContents(contents, null).added.map((item) => ({
    ...item,
    kind: "unchanged" as const,
  }));
}

/** Mirrors `previewProjectApply` when project drift is `na`. */
const PROJECT_NOT_TRACKED_WARNING =
  "Project is not tracked yet — bootstrap or apply to create a snapshot";

export interface LiveStatePanelProps {
  view: ViewScope;
  formatView: (view: ViewScope) => string;
  selectedProfile: string | null;
  activeProfile: string | null;
  liveContents: ProfileContents | null | undefined;
  applyPreview: ProfileApplyPreview | null;
  applyPreviewLoading: boolean;
  applyPreviewError: string | null;
  liveHarnesses: Record<string, HarnessLiveStatus> | null | undefined;
  hasFullHarnessSnapshot: boolean;
  baseUrl: string | null;
  token: string | null;
  bootstrapBusy?: boolean;
  onBootstrap?: () => void;
  onCreateProfileFromProject?: () => void;
  onBrowseResources?: () => void;
  onAddResource?: (resource: ProfileContentsResource) => Promise<void>;
  addingResourceKey?: string | null;
  onOpenResourceInEditor?: (resource: ProfileContentsResource) => Promise<void>;
  onRemoveResourceFromProfile?: (
    resource: ProfileContentsResource,
    layerId?: string,
  ) => Promise<void>;
  removingResourceKey?: string | null;
}

export function LiveStatePanel({
  view,
  formatView,
  selectedProfile,
  activeProfile,
  liveContents,
  applyPreview,
  applyPreviewLoading,
  applyPreviewError,
  liveHarnesses,
  hasFullHarnessSnapshot,
  baseUrl,
  token,
  bootstrapBusy = false,
  onBootstrap,
  onCreateProfileFromProject,
  onBrowseResources,
  onAddResource,
  addingResourceKey = null,
  onOpenResourceInEditor,
  onRemoveResourceFromProfile,
  removingResourceKey = null,
}: LiveStatePanelProps) {
  const [detailTarget, setDetailTarget] = useState<ResourceDetailTarget | null>(
    null,
  );
  const openResource = (target: ResourceDetailTarget) => {
    setDetailTarget(target);
  };
  const closeResource = () => {
    setDetailTarget(null);
  };

  const targetContents = applyPreview?.contents ?? null;
  const relativeToActive = applyPreview?.relative_to_active ?? false;
  const previewMatchesSelection =
    Boolean(selectedProfile)
    && applyPreview?.profile === selectedProfile
    && !applyPreviewLoading;
  const diff = diffProfileContents(targetContents, liveContents);

  // Until apply-preview resolves for the selected profile, diffing against a null
  // target would blank the stack — keep showing live contents while loading.
  const useLiveEnabledStack =
    !selectedProfile || relativeToActive || !previewMatchesSelection;

  const enabledItems = useLiveEnabledStack
    ? allItemsFromContents(liveContents)
    : diff.unchanged;

  const enabledKeys = new Set(enabledItems.map((item) => item.key));
  const enabledSourceContents = useLiveEnabledStack ? liveContents : targetContents;
  const enabledLayers = (enabledSourceContents?.layers ?? []).filter((layer) =>
    enabledKeys.has(layerIdentityKey(layer)),
  );
  const enabledPins = (enabledSourceContents?.plugin_pins ?? []).filter((pin) =>
    enabledKeys.has(pinIdentityKey(pin)),
  );
  const hasEnabledList = enabledLayers.length > 0 || enabledPins.length > 0;
  const profileStackEmpty =
    previewMatchesSelection && (enabledItems.length === 0 || !hasEnabledList);
  const profileStackEmptyVariant: ProfileStackEmptyVariant =
    selectedProfile && !relativeToActive ? "no-overlap" : "empty";

  const profileNameForActions = selectedProfile ?? activeProfile;

  const previewHarnesses = applyPreview?.harnesses ?? liveHarnesses;
  const installGaps = aggregateInstallGaps(
    view === "home" ? previewHarnesses : undefined,
  ).filter((row) => row.kind === "missing");
  const untrackedResources = applyPreview?.untracked_resources ?? [];
  const showTargetDiff = Boolean(selectedProfile)
    && !relativeToActive
    && (diff.added.length > 0 || diff.removed.length > 0);

  const previewWarning = applyPreview?.warning ?? null;
  const showPreviewError = Boolean(selectedProfile && applyPreviewError && !applyPreview);
  const showNotTrackedActions =
    previewWarning === PROJECT_NOT_TRACKED_WARNING
    && Boolean(onBootstrap || onCreateProfileFromProject);

  return (
    <>
      {showPreviewError ? (
        <div className="banner error" role="alert">
          <div>{applyPreviewError}</div>
        </div>
      ) : null}
      {previewWarning ? (
        <div className="banner" role="status">
          <div>{previewWarning}</div>
          {showNotTrackedActions ? (
            <div className="banner-actions">
              {onBootstrap ? (
                <button
                  className="btn"
                  type="button"
                  onClick={onBootstrap}
                  disabled={bootstrapBusy}
                >
                  {bootstrapBusy ? "Bootstrapping…" : "Bootstrap"}
                </button>
              ) : null}
              {onCreateProfileFromProject ? (
                <button
                  className="btn primary"
                  type="button"
                  onClick={onCreateProfileFromProject}
                  disabled={bootstrapBusy}
                >
                  Create profile from project
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="live-state-columns">
        <div className="live-state-left-stack">
        <details
          className="contents-block"
          open
          aria-label="Profile resources"
        >
          <summary className="contents-header">
            <span>Profile resources</span>
            {selectedProfile && onBrowseResources ? (
              <button
                type="button"
                className="icon-action contents-header-action"
                aria-label="Add resources"
                title="Browse resources to add to profile"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onBrowseResources();
                }}
              >
                <Plus size={ICON_SIZE} strokeWidth={2} aria-hidden />
              </button>
            ) : null}
          </summary>
          <div className="contents-body">
            {!activeProfile && !selectedProfile ? (
              <p className="muted">No active profile to inspect.</p>
            ) : !liveContents && enabledItems.length === 0 ? (
              <p className="muted">
                {selectedProfile && applyPreviewLoading && !previewMatchesSelection
                  ? "Loading profile resources…"
                  : activeProfile
                    ? "Could not resolve active profile contents."
                    : "No profile resources yet."}
              </p>
            ) : profileStackEmpty ? (
              onBrowseResources ? (
                <ProfileStackEmptyState
                  variant={profileStackEmptyVariant}
                  onBrowseResources={onBrowseResources}
                />
              ) : (
                <p className="muted">
                  {profileStackEmptyVariant === "no-overlap"
                    ? PROFILE_STACK_EMPTY_COPY["no-overlap"].body
                    : PROFILE_STACK_EMPTY_COPY.empty.body}
                </p>
              )
            ) : (
              <>
                <ResourceSummaryStrip
                  counts={
                    useLiveEnabledStack
                      ? fallbackTypeCounts(liveContents)
                      : typeCountsFromItems(enabledItems)
                  }
                  label="Profile resource summary"
                />
                <div className="enabled-list">
                  {enabledLayers.map((layer) => (
                    <EnabledLayerGroup
                      key={layer.id}
                      layer={layer}
                      profileName={profileNameForActions}
                      removingResourceKey={removingResourceKey}
                      onOpenResource={openResource}
                      onOpenInEditor={
                        onOpenResourceInEditor
                          ? (resource) => {
                              void onOpenResourceInEditor(resource);
                            }
                          : undefined
                      }
                      onRemoveFromProfile={
                        onRemoveResourceFromProfile
                          ? (resource, layerId) => {
                              void onRemoveResourceFromProfile(resource, layerId);
                            }
                          : undefined
                      }
                    />
                  ))}
                  {enabledPins.map((pin) => (
                    <EnabledResourceRow
                      key={pinIdentityKey(pin)}
                      item={{
                        key: pinIdentityKey(pin),
                        kind: "unchanged",
                        category: "plugin_pin",
                        iconType: "plugin_pin",
                        label: pin.ref,
                        detail: pin.version_constraint
                          ? `@${pin.version_constraint}`
                          : undefined,
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </details>

        {selectedProfile && untrackedResources.length > 0 ? (
          <details
            className="contents-block"
            open
            aria-label="Untracked resources"
          >
            <summary className="contents-header">
              <span>Untracked resources</span>
              <span className="contents-header-meta muted">
                {untrackedResources.length} on disk
              </span>
            </summary>
            <div className="contents-body">
              <p className="muted untracked-hint">
                Found on disk but not in this profile — add to include them on apply.
              </p>
              <div className="enabled-list">
                {untrackedResources.map((resource) => {
                  const key = `${resource.type}:${resource.name}`;
                  return (
                    <UntrackedResourceRow
                      key={key}
                      resource={resource}
                      adding={addingResourceKey === key}
                      onAdd={() => {
                        if (onAddResource) {
                          void onAddResource(resource);
                        }
                      }}
                      onOpenResource={openResource}
                    />
                  );
                })}
              </div>
            </div>
          </details>
        ) : null}
        </div>

        {selectedProfile ? (
          <details
            className="contents-block"
            open
            aria-label="Target preview"
          >
            <summary className="contents-header">
              <span>Target preview</span>
              <span className="contents-header-meta muted">
                {selectedProfile}
                {relativeToActive ? " · already active" : ""}
              </span>
            </summary>
            <div className="contents-body">
              {applyPreviewLoading && !applyPreview ? (
                <p className="muted">
                  Comparing {selectedProfile} to live {formatView(view).toLowerCase()} state…
                </p>
              ) : applyPreview ? (
                <div className="compare-grid">
                  {targetContents ? (
                    <ResourceSummaryStrip
                      counts={fallbackTypeCounts(targetContents)}
                      label="Target stack summary"
                    />
                  ) : (
                    <p className="muted">Could not resolve target profile contents.</p>
                  )}

                  {applyPreview.files?.expected_count === 0
                    && (applyPreview.files?.changes?.length ?? 0) === 0
                    && diff.added.length === 0 ? (
                    <p className="muted">
                      This profile has no resources yet — apply will record it as
                      applied with no file writes.
                    </p>
                  ) : showTargetDiff ? (
                    <details className="diff-section" open>
                      <summary className="compare-title">Stack changes</summary>
                      {diff.added.map((item) => (
                        <DiffRow
                          key={`add-${item.key}`}
                          item={item}
                          tone="add"
                          onOpenResource={openResource}
                        />
                      ))}
                      {diff.removed.map((item) => (
                        <DiffRow
                          key={`rm-${item.key}`}
                          item={item}
                          tone="remove"
                          onOpenResource={openResource}
                        />
                      ))}
                    </details>
                  ) : (
                    <p className="muted">
                      {relativeToActive
                        ? "Same stack as the active profile — only live file/install gaps below would change."
                        : "No stack add/remove vs the active profile."}
                    </p>
                  )}

                  {view === "home" && installGaps.length > 0 ? (
                    <details className="diff-section" open>
                      <summary className="compare-title">Install gaps (in profile)</summary>
                      {!hasFullHarnessSnapshot && !applyPreview.harnesses ? (
                        <div className="muted">Checking live installs…</div>
                      ) : (
                        installGaps.map((row) => (
                          <div
                            className={`diff-row ${row.kind === "missing" ? "update" : "remove"}`}
                            key={row.key}
                          >
                            <span className="diff-mark" aria-hidden>
                              {row.kind === "missing" ? "!" : "·"}
                            </span>
                            <span className="diff-body">
                              <span className="diff-label">{row.label}</span>
                              <span className="diff-detail muted">
                                {row.kind === "missing"
                                  ? "not installed"
                                  : "outside profile"}
                              </span>
                              <RelatedHarnessIcons harnessIds={row.harnesses} />
                            </span>
                          </div>
                        ))
                      )}
                    </details>
                  ) : null}

                  <details className="diff-section" open>
                    <summary className="compare-title">
                      File changes
                      {(applyPreview.files?.expected_count ?? 0) > 0
                        ? ` · ${applyPreview.files?.changes?.length ?? 0} of ${applyPreview.files?.expected_count ?? 0}`
                        : (applyPreview.files?.changes?.length ?? 0) > 0
                          ? ` · ${applyPreview.files?.changes?.length ?? 0}`
                          : ""}
                    </summary>
                    <FileChangeRows changes={applyPreview.files?.changes ?? []} />
                  </details>
                </div>
              ) : (
                <p className="muted">No preview available.</p>
              )}
            </div>
          </details>
        ) : null}
      </div>

      <ResourceDetailPane
        open={detailTarget !== null}
        target={detailTarget}
        baseUrl={baseUrl}
        token={token}
        onClose={closeResource}
      />
    </>
  );
}
