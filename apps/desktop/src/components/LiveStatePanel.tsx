import { useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Diff,
  ExternalLink,
  FileCode2,
  FileText,
  Folder,
  Layers,
  Minus,
  Package,
  Pencil,
  Plug,
  Plus,
  Shield,
  Sparkles,
  Store,
  Terminal,
  Trash2,
  Variable,
  Webhook,
  Wrench,
} from "lucide-react";
import { ButtonSpinner } from "./ButtonSpinner";
import {
  aggregateInstallGaps,
  countFileChangeKindResources,
  diffProfileContents,
  fallbackTypeCounts,
  fileChangeAction,
  fileChangeGroupHoverRows,
  fileChangeGroupHoverTitle,
  filterFileChangeGroups,
  groupFileChangesByResource,
  orderedTypeCounts,
  summarizeStackChanges,
  typeCountsFromItems,
  type ContentsDiffItem,
  type FileChangeHoverRow,
  type FileChangeKind,
  type FileChangeResourceGroup,
  type StackChangeSummaryRow,
  type StackChangeTone,
} from "../lib/contents-diff";
import { fileChangeRowActions } from "../lib/file-change-actions";
import { relatedHarnessesForResourceType } from "../lib/harness-meta";
import {
  filterContentsResourcesBySearch,
  LIST_PAGE_SIZE,
  nextVisibleCount,
} from "../lib/resource-search";
import type {
  DriftFileChange,
  HarnessLiveStatus,
  ProfileApplyPreview,
  ProfileContents,
  ProfileContentsPlugin,
  ProfileContentsResource,
  RecoveryAction,
  ViewScope,
} from "../lib/types";
import { RelatedHarnessIcons } from "./HarnessIcons";
import {
  ResourceDetailPane,
  type ResourceDetailTarget,
} from "./ResourceDetailPane";

const ICON_SIZE = 14;

function ListSearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className="list-search">
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
    </label>
  );
}

function ListTruncationControls({
  visible,
  total,
  onMore,
  onShowAll,
}: {
  visible: number;
  total: number;
  onMore: () => void;
  onShowAll: () => void;
}) {
  if (visible >= total) {
    return null;
  }
  return (
    <div className="list-truncation-controls muted">
      <span>
        Showing {visible} of {total}
      </span>
      <span aria-hidden className="list-truncation-sep">
        |
      </span>
      <button type="button" className="link-btn" onClick={onMore}>
        More
      </button>
      <span aria-hidden className="list-truncation-sep">
        |
      </span>
      <button type="button" className="link-btn" onClick={onShowAll}>
        Show all
      </button>
    </div>
  );
}

function TypeIcon({ type }: { type: string }): ReactNode {
  switch (type) {
    case "plugin":
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
  className,
  onOpen,
}: {
  label: string;
  path?: string | null;
  className?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={["resource-name-btn", "enabled-label", className]
        .filter(Boolean)
        .join(" ")}
      title={path || undefined}
      onClick={onOpen}
    >
      {label}
    </button>
  );
}

function ProfileResourceActions({
  resource,
  pluginId,
  profileName,
  removing,
  onOpenInEditor,
  onRemoveFromProfile,
}: {
  resource: ProfileContentsResource;
  pluginId?: string;
  profileName: string | null;
  removing: boolean;
  onOpenInEditor?: (resource: ProfileContentsResource) => void;
  onRemoveFromProfile?: (
    resource: ProfileContentsResource,
    pluginId?: string,
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
          className={[
            "icon-action",
            "profile-resource-remove-btn",
            removing ? "is-busy" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label={`Remove ${resource.name} from ${profileName}`}
          title="Remove from profile"
          disabled={removing}
          aria-busy={removing}
          onClick={() => onRemoveFromProfile(resource, pluginId)}
        >
          {removing ? (
            <ButtonSpinner size={ICON_SIZE} />
          ) : (
            <Trash2 size={ICON_SIZE} strokeWidth={2} aria-hidden />
          )}
        </button>
      ) : null}
    </span>
  );
}

type ProfileStackEmptyStateProps = {
  onEditProfile: () => void;
};

function ProfileStackEmptyState({
  onEditProfile,
}: ProfileStackEmptyStateProps) {
  return (
    <div
      className="empty-state profile-stack-empty"
      role="status"
      aria-label="No resources yet"
    >
      <div className="profile-stack-empty-heading">
        <Layers size={ICON_SIZE} className="profile-stack-empty-icon" aria-hidden />
        <h2>No resources yet</h2>
      </div>
      <p className="muted">Add plugins or resources by editing this profile.</p>
      <button
        className="btn primary"
        type="button"
        onClick={onEditProfile}
      >
        Edit profile
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

function stackChangeToneIcon(tone: StackChangeTone): ReactNode {
  switch (tone) {
    case "add":
      return <Plus size={ICON_SIZE} strokeWidth={2.25} aria-hidden />;
    case "remove":
      return <Minus size={ICON_SIZE} strokeWidth={2.25} aria-hidden />;
    case "mixed":
      return <Diff size={ICON_SIZE} strokeWidth={2.25} aria-hidden />;
    default: {
      const neverTone: never = tone;
      return neverTone;
    }
  }
}

function stackChangeToneTitle(row: StackChangeSummaryRow): string {
  switch (row.tone) {
    case "add":
      return `${row.added} ${row.label} added`;
    case "remove":
      return `${row.removed} ${row.label} removed`;
    case "mixed":
      return `${row.added} added, ${row.removed} removed`;
    default: {
      const neverTone: never = row.tone;
      return neverTone;
    }
  }
}

function StackChangeSummary({
  rows,
}: {
  rows: StackChangeSummaryRow[];
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <span className="stack-change-summary" aria-label="Stack change summary">
      {rows.map((row) => (
        <span
          className={`stack-change-stat tone-${row.tone}`}
          key={row.type}
          title={stackChangeToneTitle(row)}
        >
          <span className="stack-change-tone" aria-hidden>
            {stackChangeToneIcon(row.tone)}
          </span>
          <TypeIcon type={row.type} />
          <strong>{row.count}</strong>
          <span>{row.label}</span>
        </span>
      ))}
    </span>
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
    <div
      className="enabled-row untracked-row"
      data-testid={`resource-row-${resource.name}`}
    >
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
          className={[
            "icon-action",
            "untracked-add-btn",
            adding ? "is-busy" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label={`Commit ${resource.name} into profile`}
          title={`Commit ${resource.name} into profile`}
          disabled={adding}
          aria-busy={adding}
          onClick={onAdd}
        >
          {adding ? (
            <ButtonSpinner size={ICON_SIZE} />
          ) : (
            <Plus size={ICON_SIZE} strokeWidth={2} aria-hidden />
          )}
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
    <div className="enabled-row" data-testid={`resource-row-${item.label}`}>
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

function EnabledPluginGroup({
  plugin,
  profileName,
  removingResourceKey,
  onOpenResource,
  onOpenInEditor,
  onRemoveFromProfile,
}: {
  plugin: ProfileContentsPlugin;
  profileName: string | null;
  removingResourceKey: string | null;
  onOpenResource: (target: ResourceDetailTarget) => void;
  onOpenInEditor?: (resource: ProfileContentsResource) => void;
  onRemoveFromProfile?: (
    resource: ProfileContentsResource,
    pluginId?: string,
  ) => void;
}) {
  const resourceCount = plugin.resources?.length ?? 0;
  return (
    <details className="enabled-plugin">
      <summary className="enabled-plugin-summary">
        <span className="enabled-type">
          <TypeIcon type="plugin" />
        </span>
        <span className="enabled-label">{plugin.name}</span>
        <span className="enabled-trailing">
          <RelatedHarnessIcons
            harnessIds={relatedHarnessesForResourceType("plugin")}
          />
          <span className="enabled-detail muted">
            @{plugin.version}
            {resourceCount > 0
              ? ` · ${resourceCount} resource${resourceCount === 1 ? "" : "s"}`
              : ""}
          </span>
        </span>
      </summary>
      <div className="enabled-plugin-body">
        {resourceCount === 0 ? (
          <div className="muted enabled-plugin-empty">No resources in this plugin</div>
        ) : (
          (plugin.resources ?? []).map((resource) => {
            const resourceKey = `${resource.type}:${resource.name}`;
            return (
              <div
                className="enabled-row enabled-nested-row"
                key={resourceKey}
                data-testid={`resource-row-${resource.name}`}
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
                    pluginId={plugin.id}
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

function pluginIdentityKey(plugin: {
  id: string;
  name: string;
  version: string;
}): string {
  return `plugin:${plugin.id}:${plugin.name}@${plugin.version}`;
}

function pinIdentityKey(pin: { ref: string }): string {
  return `pin:${pin.ref}`;
}

function dedupeContentsResources(
  resources: ProfileContentsResource[],
): ProfileContentsResource[] {
  const seen = new Set<string>();
  const deduped: ProfileContentsResource[] = [];
  for (const resource of resources) {
    const key = `${resource.type}:${resource.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(resource);
  }
  return deduped;
}

function matchesPluginSearch(
  plugin: ProfileContentsPlugin,
  search: string,
): boolean {
  if (!search.trim()) {
    return true;
  }
  return filterContentsResourcesBySearch(
    [
      {
        id: plugin.id,
        type: "plugin",
        name: plugin.name,
        source: plugin.id,
      },
    ],
    search,
  ).length > 0;
}

function matchesPinSearch(
  pin: { ref: string; version_constraint?: string },
  search: string,
): boolean {
  if (!search.trim()) {
    return true;
  }
  return filterContentsResourcesBySearch(
    [
      {
        id: pin.ref,
        type: "plugin_pin",
        name: pin.ref,
        source: pin.version_constraint ?? "",
      },
    ],
    search,
  ).length > 0;
}

function OriginHoverIcon({ originKind }: { originKind: string }): ReactNode {
  switch (originKind) {
    case "marketplace_link":
      return <Store size={ICON_SIZE} aria-hidden />;
    case "local_snapshot":
      return <Folder size={ICON_SIZE} aria-hidden />;
    case "manual":
      return <Pencil size={ICON_SIZE} aria-hidden />;
    default:
      return <Package size={ICON_SIZE} aria-hidden />;
  }
}

function FileChangeHoverTooltip({
  rows,
}: {
  rows: FileChangeHoverRow[];
}): ReactNode {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="file-change-tooltip" role="tooltip">
      {rows.map((row) => {
        let icon: ReactNode;
        switch (row.kind) {
          case "path":
            icon = <FileText size={ICON_SIZE} aria-hidden />;
            break;
          case "type":
            icon = <TypeIcon type={row.type} />;
            break;
          case "origin":
            icon = <OriginHoverIcon originKind={row.originKind} />;
            break;
          case "destinations":
            icon = <Folder size={ICON_SIZE} aria-hidden />;
            break;
          default: {
            const neverKind: never = row;
            return neverKind;
          }
        }
        return (
          <div className="file-change-tooltip-row" key={`${row.kind}-${row.text}`}>
            <span className="file-change-tooltip-icon">{icon}</span>
            <span
              className={
                row.kind === "path" ? "mono file-change-tooltip-path" : undefined
              }
            >
              {row.kind === "path" ? row.text.replaceAll("/", "/\u200b") : row.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FileChangeRowActions({
  change,
  row,
  busy,
  busyAction,
  onOpenFileChange,
  onDiffFileChange,
  onAddFileChange,
  onDropFileChange,
}: {
  change: DriftFileChange;
  row: ReturnType<typeof fileChangeRowActions>;
  busy: boolean;
  busyAction: "open" | "add" | "drop" | null;
  onOpenFileChange?: (change: DriftFileChange, absolutePath: string) => Promise<void>;
  onDiffFileChange?: (change: DriftFileChange) => void;
  onAddFileChange?: (change: DriftFileChange) => Promise<void>;
  onDropFileChange?: (change: DriftFileChange) => Promise<void>;
}) {
  const absolutePath = row.absolutePath;
  const canOpen = row.canOpen && Boolean(onOpenFileChange && absolutePath);
  const canDiff = row.canDiff && Boolean(onDiffFileChange);
  const canAdd = row.canAdd && Boolean(onAddFileChange);
  const canDrop = row.canDrop && Boolean(onDropFileChange);
  if (!canOpen && !canDiff && !canAdd && !canDrop) {
    return null;
  }

  const openBusy = busy && busyAction === "open";
  const addBusy = busy && busyAction === "add";
  const dropBusy = busy && busyAction === "drop";

  return (
    <span className="diff-row-actions">
      {canOpen && onOpenFileChange && absolutePath ? (
        <button
          type="button"
          className={[
            "icon-action",
            "profile-resource-open-btn",
            openBusy ? "is-busy" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label={
            change.type === "deleted"
              ? `Open ${change.resource?.name ?? change.path} in editor`
              : `Open ${change.path} in editor`
          }
          title={
            change.type === "deleted"
              ? "Open resource in default editor"
              : "Open in default editor"
          }
          disabled={busy}
          aria-busy={openBusy}
          onClick={() => void onOpenFileChange(change, absolutePath)}
        >
          {openBusy ? (
            <ButtonSpinner size={ICON_SIZE} />
          ) : (
            <ExternalLink size={ICON_SIZE} strokeWidth={2} aria-hidden />
          )}
        </button>
      ) : null}
      {canDiff && onDiffFileChange ? (
        <button
          type="button"
          className="icon-action file-change-diff-btn"
          aria-label={`Show diff for ${change.path}`}
          title="Show diff vs snapshot"
          disabled={busy}
          onClick={() => onDiffFileChange(change)}
        >
          <Diff size={ICON_SIZE} strokeWidth={2} aria-hidden />
        </button>
      ) : null}
      {canAdd && onAddFileChange ? (
        <button
          type="button"
          className={[
            "icon-action",
            "untracked-add-btn",
            addBusy ? "is-busy" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label={`Commit ${change.path} into profile`}
          title="Commit live changes into profile"
          disabled={busy}
          aria-busy={addBusy}
          onClick={() => void onAddFileChange(change)}
        >
          {addBusy ? (
            <ButtonSpinner size={ICON_SIZE} />
          ) : (
            <Plus size={ICON_SIZE} strokeWidth={2} aria-hidden />
          )}
        </button>
      ) : null}
      {canDrop && onDropFileChange ? (
        <button
          type="button"
          className={[
            "icon-action",
            "profile-resource-remove-btn",
            dropBusy ? "is-busy" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label={
            row.action === "update"
              ? `Restore profile version of ${change.path}`
              : `Remove ${change.path} from profile`
          }
          title={row.action === "update" ? "Restore profile version" : "Remove from profile"}
          disabled={busy}
          aria-busy={dropBusy}
          onClick={() => void onDropFileChange(change)}
        >
          {dropBusy ? (
            <ButtonSpinner size={ICON_SIZE} />
          ) : (
            <Trash2 size={ICON_SIZE} strokeWidth={2} aria-hidden />
          )}
        </button>
      ) : null}
    </span>
  );
}

const FILE_CHANGE_KIND_BADGES: Array<{
  kind: FileChangeKind;
  label: string;
  Icon: typeof Plus;
}> = [
  { kind: "add", label: "Added", Icon: Plus },
  { kind: "remove", label: "Removed", Icon: Minus },
  { kind: "update", label: "Modified", Icon: Pencil },
];

function fileChangeKindClass(kind: FileChangeKind): FileChangeKind {
  switch (kind) {
    case "add":
    case "remove":
    case "update":
      return kind;
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

function fileChangeKindMark(kind: FileChangeKind): string {
  switch (kind) {
    case "add":
      return "+";
    case "remove":
      return "−";
    case "update":
      return "~";
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

function groupKindCounts(
  group: FileChangeResourceGroup,
): Record<FileChangeKind, number> {
  const counts: Record<FileChangeKind, number> = {
    add: 0,
    remove: 0,
    update: 0,
  };
  for (const change of group.changes) {
    counts[fileChangeAction(change).action] += 1;
  }
  return counts;
}

function FileChangeGroupCounts({
  group,
}: {
  group: FileChangeResourceGroup;
}): ReactNode {
  const counts = groupKindCounts(group);
  return (
    <span className="file-change-group-counts" aria-hidden>
      {FILE_CHANGE_KIND_BADGES.map(({ kind, Icon }) => {
        const count = counts[kind];
        if (count === 0) {
          return null;
        }
        return (
          <span key={kind} className={`file-change-group-count ${kind}`}>
            <Icon size={ICON_SIZE} strokeWidth={2} />
            <span>{count}</span>
          </span>
        );
      })}
    </span>
  );
}

function FileChangeRows({
  changes,
  filesRootPath,
  profileResourceKeys,
  fileChangeBusyPath = null,
  fileChangeBusyAction = null,
  onOpenFileChange,
  onDiffFileChange,
  onAddFileChange,
  onDropFileChange,
  onOpenResource,
}: {
  changes: DriftFileChange[];
  filesRootPath?: string | null;
  profileResourceKeys: Set<string>;
  fileChangeBusyPath?: string | null;
  fileChangeBusyAction?: "open" | "add" | "drop" | null;
  onOpenFileChange?: (change: DriftFileChange, absolutePath: string) => Promise<void>;
  onDiffFileChange?: (change: DriftFileChange) => void;
  onAddFileChange?: (change: DriftFileChange) => Promise<void>;
  onDropFileChange?: (change: DriftFileChange) => Promise<void>;
  onOpenResource?: (target: ResourceDetailTarget) => void;
}) {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<Set<FileChangeKind>>(
    () => new Set(),
  );
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());

  const groups = groupFileChangesByResource(changes);
  const kindCounts = countFileChangeKindResources(
    groups.flatMap((group) => group.changes),
  );

  if (groups.length === 0) {
    return <div className="muted">No file changes vs live target</div>;
  }

  const filteredGroups = filterFileChangeGroups(groups, kindFilter, search);
  const visible = filteredGroups.slice(0, visibleCount);

  const rowForChange = (change: DriftFileChange) => {
    const profileHasResource = change.resource
      ? profileResourceKeys.has(`${change.resource.type}:${change.resource.name}`)
      : false;
    return fileChangeRowActions(change, {
      rootPath: filesRootPath ?? null,
      profileHasResource,
    });
  };

  return (
    <div className="file-change-list">
      <div className="file-change-filters">
        <div
          className="file-change-kind-badges"
          role="group"
          aria-label="Filter file changes by kind"
        >
          {FILE_CHANGE_KIND_BADGES.map(({ kind, label, Icon }) => {
            const count = kindCounts[kind];
            const on = kindFilter.has(kind);
            return (
              <button
                key={kind}
                type="button"
                className={[
                  "file-change-kind-badge",
                  kind,
                  on ? "on" : "",
                  count === 0 ? "empty" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-pressed={on}
                aria-label={`Filter ${label.toLowerCase()} (${count})`}
                title={label}
                disabled={count === 0}
                onClick={() => {
                  setKindFilter((current) => {
                    const next = new Set(current);
                    if (next.has(kind)) {
                      next.delete(kind);
                    } else {
                      next.add(kind);
                    }
                    return next;
                  });
                  setVisibleCount(LIST_PAGE_SIZE);
                }}
              >
                <Icon size={ICON_SIZE} strokeWidth={2} aria-hidden />
                <span>{count}</span>
              </button>
            );
          })}
        </div>
        <ListSearchField
          value={search}
          onChange={(value) => {
            setSearch(value);
            setVisibleCount(LIST_PAGE_SIZE);
          }}
          placeholder="Filter resources or paths"
          label="Filter file changes"
        />
      </div>
      {visible.map((group) => {
        const expanded = expandedKeys.has(group.key);
        const firstChange = group.changes[0];
        const firstRow = firstChange ? rowForChange(firstChange) : null;
        const resource = group.resource;
        return (
          <div className="file-change-group" key={group.key}>
            <div
              className="diff-row file-change-group-row"
              aria-label={fileChangeGroupHoverTitle(group)}
            >
              {!group.singleton ? (
                <button
                  type="button"
                  className="file-change-expand-btn"
                  aria-expanded={expanded}
                  aria-label={expanded ? "Collapse file paths" : "Expand file paths"}
                  onClick={() => {
                    setExpandedKeys((current) => {
                      const next = new Set(current);
                      if (next.has(group.key)) {
                        next.delete(group.key);
                      } else {
                        next.add(group.key);
                      }
                      return next;
                    });
                  }}
                >
                  {expanded ? (
                    <ChevronDown size={ICON_SIZE} strokeWidth={2} aria-hidden />
                  ) : (
                    <ChevronRight size={ICON_SIZE} strokeWidth={2} aria-hidden />
                  )}
                </button>
              ) : null}
              <span className="diff-body">
                {resource?.type ? <TypeIcon type={resource.type} /> : null}
                {resource ? (
                  onOpenResource ? (
                    <ResourceNameButton
                      label={resource.name}
                      className="diff-label"
                      onOpen={() =>
                        onOpenResource({
                          selector: `${resource.type}:${resource.name}`,
                          label: resource.name,
                          pathHint: firstRow?.absolutePath,
                        })
                      }
                    />
                  ) : (
                    <span className="diff-label">{resource.name}</span>
                  )
                ) : (
                  <span className="diff-label mono">
                    {firstChange?.path ?? group.key}
                  </span>
                )}
                <RelatedHarnessIcons harnessIds={group.platforms} />
                <FileChangeGroupCounts group={group} />
              </span>
              {group.singleton && firstChange && firstRow ? (
                <FileChangeRowActions
                  change={firstChange}
                  row={firstRow}
                  busy={fileChangeBusyPath === firstChange.path}
                  busyAction={
                    fileChangeBusyPath === firstChange.path
                      ? fileChangeBusyAction
                      : null
                  }
                  onOpenFileChange={onOpenFileChange}
                  onDiffFileChange={onDiffFileChange}
                  onAddFileChange={onAddFileChange}
                  onDropFileChange={onDropFileChange}
                />
              ) : null}
              <FileChangeHoverTooltip rows={fileChangeGroupHoverRows(group)} />
            </div>
            {!group.singleton && expanded
              ? group.changes.map((change, index) => {
                  const row = rowForChange(change);
                  const kind = row.action;
                  const busy = fileChangeBusyPath === change.path;
                  return (
                    <div
                      className={`diff-row file-change-child ${fileChangeKindClass(kind)}`}
                      key={`${change.type}-${change.path}-${change.platform ?? "na"}-${index}`}
                    >
                      <span className="diff-mark" aria-hidden>
                        {fileChangeKindMark(kind)}
                      </span>
                      <span className="diff-body">
                        <span className="diff-label mono">{change.path}</span>
                        {change.platform ? (
                          <RelatedHarnessIcons harnessIds={[change.platform]} />
                        ) : null}
                      </span>
                      <FileChangeRowActions
                        change={change}
                        row={row}
                        busy={busy}
                        busyAction={busy ? fileChangeBusyAction : null}
                        onOpenFileChange={onOpenFileChange}
                        onDiffFileChange={onDiffFileChange}
                        onAddFileChange={onAddFileChange}
                        onDropFileChange={onDropFileChange}
                      />
                    </div>
                  );
                })
              : null}
          </div>
        );
      })}
      <ListTruncationControls
        visible={visible.length}
        total={filteredGroups.length}
        onMore={() =>
          setVisibleCount((current) =>
            nextVisibleCount(current, filteredGroups.length),
          )
        }
        onShowAll={() => setVisibleCount(filteredGroups.length)}
      />
    </div>
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
  onEditProfile?: () => void;
  onAddResource?: (resource: ProfileContentsResource) => Promise<void>;
  addingResourceKey?: string | null;
  onCommitManagedChanges?: () => Promise<void>;
  committingManagedChanges?: boolean;
  onOpenResourceInEditor?: (resource: ProfileContentsResource) => Promise<void>;
  onRemoveResourceFromProfile?: (
    resource: ProfileContentsResource,
    pluginId?: string,
  ) => Promise<void>;
  removingResourceKey?: string | null;
  onOpenFileChange?: (change: DriftFileChange, absolutePath: string) => Promise<void>;
  onDiffFileChange?: (change: DriftFileChange) => void;
  onAddFileChange?: (change: DriftFileChange) => Promise<void>;
  onDropFileChange?: (change: DriftFileChange) => Promise<void>;
  fileChangeBusyPath?: string | null;
  fileChangeBusyAction?: "open" | "add" | "drop" | null;
  filesRootPath?: string | null;
  /** Row-action failures (open / add / drop / remove resource). */
  resourceActionError?: string | null;
  onDismissResourceActionError?: () => void;
  onRecoveryAction?: (action: RecoveryAction) => void;
  recoveryBusy?: boolean;
  onSuccess?: (message: string) => void;
  onLibraryChanged?: () => void;
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
  onEditProfile,
  onAddResource,
  addingResourceKey = null,
  onCommitManagedChanges,
  committingManagedChanges = false,
  onOpenResourceInEditor,
  onRemoveResourceFromProfile,
  removingResourceKey = null,
  onOpenFileChange,
  onDiffFileChange,
  onAddFileChange,
  onDropFileChange,
  fileChangeBusyPath = null,
  fileChangeBusyAction = null,
  filesRootPath = null,
  resourceActionError = null,
  onDismissResourceActionError,
  onRecoveryAction,
  recoveryBusy = false,
  onSuccess,
  onLibraryChanged,
}: LiveStatePanelProps) {
  const [detailTarget, setDetailTarget] = useState<ResourceDetailTarget | null>(
    null,
  );
  const [profileResourceSearch, setProfileResourceSearch] = useState("");
  const [profileResourceVisible, setProfileResourceVisible] = useState(
    LIST_PAGE_SIZE,
  );
  const [notStagedSearch, setNotStagedSearch] = useState("");
  const [notStagedVisible, setNotStagedVisible] = useState(LIST_PAGE_SIZE);
  const openResource = (target: ResourceDetailTarget) => {
    setDetailTarget(target);
  };
  const closeResource = () => {
    setDetailTarget(null);
  };

  const profileResourceKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const resource of applyPreview?.contents?.resources ?? []) {
      keys.add(`${resource.type}:${resource.name}`);
    }
    return keys;
  }, [applyPreview?.contents?.resources]);

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
  const enabledPlugins = (enabledSourceContents?.plugins ?? []).filter((plugin) =>
    enabledKeys.has(pluginIdentityKey(plugin)),
  );
  const enabledPins = (enabledSourceContents?.plugin_pins ?? []).filter((pin) =>
    enabledKeys.has(pinIdentityKey(pin)),
  );
  const hasEnabledList = enabledPlugins.length > 0 || enabledPins.length > 0;
  const profileStackEmpty =
    previewMatchesSelection && (enabledItems.length === 0 || !hasEnabledList);

  const profileNameForActions = selectedProfile ?? activeProfile;

  const previewHarnesses = applyPreview?.harnesses ?? liveHarnesses;
  const installGaps = aggregateInstallGaps(
    view === "home" ? previewHarnesses : undefined,
  ).filter((row) => row.kind === "missing");
  const notStagedResources =
    applyPreview?.not_staged
    ?? applyPreview?.untracked_resources
    ?? [];
  const hasStackChanges = Boolean(selectedProfile)
    && !relativeToActive
    && (diff.added.length > 0 || diff.removed.length > 0);
  const hasFileChanges = (applyPreview?.files?.changes?.length ?? 0) > 0;
  const hasInstallGaps = view === "home" && installGaps.length > 0;
  const targetPreviewTone =
    previewMatchesSelection && applyPreview
      ? hasStackChanges || hasFileChanges || hasInstallGaps
        ? "drifted"
        : "clean"
      : null;

  const previewWarning = applyPreview?.warning ?? null;
  const showPreviewError = Boolean(selectedProfile && applyPreviewError);
  const showNotTrackedActions =
    previewWarning === PROJECT_NOT_TRACKED_WARNING
    && Boolean(onBootstrap || onCreateProfileFromProject);
  const recoveryActions =
    !showNotTrackedActions && applyPreview?.recovery_actions?.length
      ? applyPreview.recovery_actions
      : null;

  return (
    <>
      {showPreviewError ? (
        <div className="banner error" role="alert">
          <div>{applyPreviewError}</div>
        </div>
      ) : null}
      {resourceActionError ? (
        <div className="banner error" role="alert">
          <div>{resourceActionError}</div>
          {onDismissResourceActionError ? (
            <div className="banner-actions">
              <button
                type="button"
                className="btn"
                onClick={onDismissResourceActionError}
              >
                Dismiss
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {previewWarning ? (
        <div className="banner" role="status">
          <div style={{ whiteSpace: "pre-wrap" }}>{previewWarning}</div>
          {showNotTrackedActions ? (
            <div className="banner-actions">
              {onBootstrap ? (
                <button
                  className={["btn", bootstrapBusy ? "is-busy" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  onClick={onBootstrap}
                  disabled={bootstrapBusy}
                  aria-busy={bootstrapBusy}
                >
                  {bootstrapBusy ? <ButtonSpinner size={16} /> : null}
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
          ) : recoveryActions && onRecoveryAction ? (
            <div className="banner-actions">
              {recoveryActions.map((action, index) => (
                <button
                  key={`${action.id}-${index}`}
                  type="button"
                  className={index === 0 ? "btn primary" : "btn"}
                  onClick={() => onRecoveryAction(action)}
                  disabled={recoveryBusy}
                >
                  {action.label}
                </button>
              ))}
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
              onEditProfile ? (
                <ProfileStackEmptyState onEditProfile={onEditProfile} />
              ) : (
                <p className="muted">Add plugins or resources from your library.</p>
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
                <ListSearchField
                  value={profileResourceSearch}
                  onChange={(value) => {
                    setProfileResourceSearch(value);
                    setProfileResourceVisible(LIST_PAGE_SIZE);
                  }}
                  placeholder="Filter resources (name or type:name)"
                  label="Filter profile resources"
                />
                <div className="enabled-list">
                  {(() => {
                    const filteredPlugins = enabledPlugins
                      .map((plugin) => ({
                        ...plugin,
                        resources: dedupeContentsResources(
                          filterContentsResourcesBySearch(
                            plugin.resources,
                            profileResourceSearch,
                          ),
                        ),
                      }))
                      .filter(
                        (plugin) =>
                          plugin.resources.length > 0
                          || matchesPluginSearch(plugin, profileResourceSearch),
                      );
                    const filteredPins = enabledPins.filter((pin) =>
                      matchesPinSearch(pin, profileResourceSearch),
                    );
                    const totalResourceRows = filteredPlugins.reduce(
                      (sum, plugin) => sum + plugin.resources.length,
                      0,
                    ) + filteredPins.length;

                    let remaining = profileResourceVisible;
                    const truncatedPlugins: ProfileContentsPlugin[] = [];
                    for (const plugin of filteredPlugins) {
                      if (remaining <= 0) {
                        break;
                      }
                      if (plugin.resources.length === 0) {
                        truncatedPlugins.push(plugin);
                        remaining -= 1;
                        continue;
                      }
                      const take = plugin.resources.slice(0, remaining);
                      remaining -= take.length;
                      truncatedPlugins.push({ ...plugin, resources: take });
                    }
                    const pinSlice =
                      remaining > 0
                        ? filteredPins.slice(0, remaining)
                        : [];
                    const visibleResourceRows =
                      truncatedPlugins.reduce(
                        (sum, plugin) =>
                          sum + Math.max(plugin.resources.length, plugin.resources.length === 0 ? 1 : 0),
                        0,
                      ) + pinSlice.length;

                    return (
                      <>
                        {truncatedPlugins.map((plugin) => (
                          <EnabledPluginGroup
                            key={plugin.id}
                            plugin={plugin}
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
                                ? (resource, pluginId) => {
                                    void onRemoveResourceFromProfile(
                                      resource,
                                      pluginId,
                                    );
                                  }
                                : undefined
                            }
                          />
                        ))}
                        {pinSlice.map((pin) => (
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
                        <ListTruncationControls
                          visible={visibleResourceRows}
                          total={totalResourceRows}
                          onMore={() =>
                            setProfileResourceVisible((current) =>
                              nextVisibleCount(current, totalResourceRows),
                            )
                          }
                          onShowAll={() =>
                            setProfileResourceVisible(totalResourceRows)
                          }
                        />
                      </>
                    );
                  })()}
                </div>
              </>
            )}
          </div>
        </details>

        {selectedProfile && notStagedResources.length > 0 ? (
          <details
            className="contents-block"
            open
            aria-label="Not staged"
          >
            <summary className="contents-header">
              <span>Not staged</span>
              <span className="contents-header-meta muted">
                {notStagedResources.length} on disk
              </span>
            </summary>
            <div className="contents-body">
              <p className="muted untracked-hint">
                On disk but not in any profile — commit to include them on apply.
              </p>
              <ListSearchField
                value={notStagedSearch}
                onChange={(value) => {
                  setNotStagedSearch(value);
                  setNotStagedVisible(LIST_PAGE_SIZE);
                }}
                placeholder="Filter not staged (name or type:name)"
                label="Filter not staged resources"
              />
              <div className="enabled-list">
                {(() => {
                  const filtered = dedupeContentsResources(
                    filterContentsResourcesBySearch(
                      notStagedResources,
                      notStagedSearch,
                    ),
                  );
                  const visible = filtered.slice(0, notStagedVisible);
                  return (
                    <>
                      {visible.map((resource) => {
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
                      <ListTruncationControls
                        visible={visible.length}
                        total={filtered.length}
                        onMore={() =>
                          setNotStagedVisible((current) =>
                            nextVisibleCount(current, filtered.length),
                          )
                        }
                        onShowAll={() => setNotStagedVisible(filtered.length)}
                      />
                    </>
                  );
                })()}
              </div>
            </div>
          </details>
        ) : null}
        </div>

        {selectedProfile ? (
          <details
            className={[
              "contents-block",
              targetPreviewTone === "clean" ? "target-preview-clean" : "",
              targetPreviewTone === "drifted" ? "target-preview-drifted" : "",
            ]
              .filter(Boolean)
              .join(" ")}
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
                  ) : hasStackChanges ? (
                    <details className="diff-section">
                      <summary className="compare-title">
                        <span className="compare-title-text">Stack changes</span>
                        <StackChangeSummary
                          rows={summarizeStackChanges(diff.added, diff.removed)}
                        />
                      </summary>
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
                    <div
                      className="diff-section is-disabled"
                      aria-disabled="true"
                    >
                      <div className="compare-title">
                        <span className="compare-title-text">Stack changes</span>
                        <span className="muted">No changes</span>
                      </div>
                    </div>
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

                  <details className="diff-section">
                    <summary className="compare-title">
                      <span className="compare-title-text">
                        File changes
                        {(applyPreview.files?.expected_count ?? 0) > 0
                          ? ` · ${(applyPreview.files?.changes?.length ?? 0)} would change · ${applyPreview.files?.expected_count ?? 0} managed`
                          : (applyPreview.files?.changes?.length ?? 0) > 0
                            ? ` · ${applyPreview.files?.changes?.length ?? 0} would change`
                            : ""}
                      </span>
                      {onCommitManagedChanges
                        && (applyPreview.files?.changes ?? []).some(
                          (change) => fileChangeAction(change).action === "update",
                        ) ? (
                        <button
                          type="button"
                          className={[
                            "icon-action",
                            "compare-title-action",
                            committingManagedChanges ? "is-busy" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          disabled={committingManagedChanges}
                          aria-busy={committingManagedChanges}
                          aria-label="Commit live file updates into profile"
                          title="Commit live file updates into profile"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void onCommitManagedChanges();
                          }}
                        >
                          {committingManagedChanges ? (
                            <ButtonSpinner size={ICON_SIZE} />
                          ) : (
                            <Plus size={ICON_SIZE} strokeWidth={2} aria-hidden />
                          )}
                        </button>
                      ) : null}
                    </summary>
                    <FileChangeRows
                      changes={applyPreview.files?.changes ?? []}
                      filesRootPath={filesRootPath ?? applyPreview.files?.root_path ?? null}
                      profileResourceKeys={profileResourceKeys}
                      fileChangeBusyPath={fileChangeBusyPath}
                      fileChangeBusyAction={fileChangeBusyAction}
                      onOpenFileChange={onOpenFileChange}
                      onDiffFileChange={onDiffFileChange}
                      onAddFileChange={onAddFileChange}
                      onDropFileChange={onDropFileChange}
                      onOpenResource={openResource}
                    />
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
        onSuccess={onSuccess}
        onLibraryChanged={onLibraryChanged}
      />
    </>
  );
}
