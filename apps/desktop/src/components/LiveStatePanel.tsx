import type { ReactNode } from "react";
import {
  Bot,
  FileCode2,
  FileText,
  Layers,
  Package,
  Plug,
  Shield,
  Sparkles,
  Terminal,
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
  ViewScope,
} from "../lib/types";
import { RelatedHarnessIcons } from "./HarnessIcons";

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

function DiffRow({ item, tone }: { item: ContentsDiffItem; tone: "add" | "remove" }) {
  return (
    <div className={`diff-row ${tone}`}>
      <span className="diff-mark" aria-hidden>
        {tone === "add" ? "+" : "−"}
      </span>
      <span className="diff-body">
        <TypeIcon type={item.iconType} />
        <span className="diff-label">{item.label}</span>
        {item.detail ? <span className="diff-detail muted">{item.detail}</span> : null}
        <RelatedHarnessIcons
          harnessIds={relatedHarnessesForResourceType(item.iconType)}
        />
      </span>
    </div>
  );
}

function EnabledResourceRow({ item }: { item: ContentsDiffItem }) {
  return (
    <div className="enabled-row">
      <span className="enabled-type">
        <TypeIcon type={item.iconType} />
      </span>
      <span className="enabled-label">{item.label}</span>
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
}: {
  layer: ProfileContents["layers"][number];
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
          (layer.resources ?? []).map((resource) => (
            <div
              className="enabled-row enabled-nested-row"
              key={`${resource.type}:${resource.name}`}
            >
              <span className="enabled-type">
                <TypeIcon type={resource.type} />
              </span>
              <span className="enabled-label">{resource.name}</span>
              <span className="enabled-trailing">
                <RelatedHarnessIcons
                  harnessIds={relatedHarnessesForResourceType(resource.type)}
                />
                <span className="enabled-detail muted">
                  {resource.type.replaceAll("_", " ")}
                </span>
              </span>
            </div>
          ))
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
}: LiveStatePanelProps) {
  const targetContents = applyPreview?.contents ?? null;
  const relativeToActive = applyPreview?.relative_to_active ?? false;
  const diff = diffProfileContents(targetContents, liveContents);

  const enabledItems =
    !selectedProfile || relativeToActive
      ? allItemsFromContents(liveContents)
      : diff.unchanged;

  const enabledKeys = new Set(enabledItems.map((item) => item.key));
  const enabledSourceContents =
    !selectedProfile || relativeToActive ? liveContents : targetContents;
  const enabledLayers = (enabledSourceContents?.layers ?? []).filter((layer) =>
    enabledKeys.has(layerIdentityKey(layer)),
  );
  const enabledPins = (enabledSourceContents?.plugin_pins ?? []).filter((pin) =>
    enabledKeys.has(pinIdentityKey(pin)),
  );
  const hasEnabledList = enabledLayers.length > 0 || enabledPins.length > 0;

  const previewHarnesses = applyPreview?.harnesses ?? liveHarnesses;
  const installGaps = aggregateInstallGaps(
    view === "home" ? previewHarnesses : undefined,
  );
  const showTargetDiff = Boolean(selectedProfile)
    && !relativeToActive
    && (diff.added.length > 0 || diff.removed.length > 0);

  return (
    <>
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
            ) : applyPreviewError && !applyPreview ? (
              <div className="banner error">
                <div>{applyPreviewError}</div>
              </div>
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

                {showTargetDiff ? (
                  <details className="diff-section" open>
                    <summary className="compare-title">Stack changes</summary>
                    {diff.added.map((item) => (
                      <DiffRow key={`add-${item.key}`} item={item} tone="add" />
                    ))}
                    {diff.removed.map((item) => (
                      <DiffRow key={`rm-${item.key}`} item={item} tone="remove" />
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
                    <summary className="compare-title">Install gaps</summary>
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
                    {applyPreview.files.expected_count > 0
                      ? ` · ${applyPreview.files.changes.length} of ${applyPreview.files.expected_count}`
                      : applyPreview.files.changes.length > 0
                        ? ` · ${applyPreview.files.changes.length}`
                        : ""}
                  </summary>
                  {applyPreview.warning ? (
                    <p className="muted">{applyPreview.warning}</p>
                  ) : null}
                  <FileChangeRows changes={applyPreview.files.changes} />
                </details>
              </div>
            ) : (
              <p className="muted">No preview available.</p>
            )}
          </div>
        </details>
      ) : null}

      <details
        className="contents-block"
        open
        aria-label="Enabled resources"
      >
        <summary className="contents-header">Enabled resources</summary>
        <div className="contents-body">
          {!activeProfile && !selectedProfile ? (
            <p className="muted">No active profile to inspect.</p>
          ) : !liveContents && enabledItems.length === 0 ? (
            <p className="muted">
              {activeProfile
                ? "Could not resolve active profile contents."
                : "No enabled resources yet."}
            </p>
          ) : (
            <>
              <ResourceSummaryStrip
                counts={
                  !selectedProfile || relativeToActive
                    ? fallbackTypeCounts(liveContents)
                    : typeCountsFromItems(enabledItems)
                }
                label="Enabled resource summary"
              />
              {enabledItems.length === 0 || !hasEnabledList ? (
                <p className="muted">
                  {selectedProfile && !relativeToActive
                    ? "Nothing overlaps with the active stack — see Target preview for adds."
                    : "No resources in the current stack."}
                </p>
              ) : (
                <div className="enabled-list">
                  {enabledLayers.map((layer) => (
                    <EnabledLayerGroup key={layer.id} layer={layer} />
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
              )}
            </>
          )}
        </div>
      </details>
    </>
  );
}
