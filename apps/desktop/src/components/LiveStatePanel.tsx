import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Check,
  ChevronsDown,
  CircleAlert,
  CircleDashed,
  Diff,
  ExternalLink,
  FolderCog,
  Info,
  Layers,
  ListPlus,
  Minus,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UnfoldVertical,
  X,
} from "lucide-react";
import { ChromeTooltip } from "./ChromeTooltip";
import { IconActionButton } from "./IconActionButton";
import {
  aggregateInstallGaps,
  countFileChangeKindResources,
  countPendingApplyKinds,
  diffProfileContents,
  fileChangeAction,
  filterFileChangeGroups,
  filterProfileResourceList,
  flattenProfileResourceList,
  groupFileChangesByResource,
  groupInstallGaps,
  installGapQuietVerb,
  installGapRowPresentation,
  installGapStatusLabel,
  isTargetPreviewInstallGap,
  liveMcpNamesFromHarnesses,
  managedPathFromResourceSource,
  summarizeStackChanges,
  type ContentsDiffItem,
  type FileChangeKind,
  type FileChangeResourceGroup,
  type InstallGapRow,
  type ProfileResourceListRow,
  type StackChangeSummaryRow,
  type StackChangeTone,
} from "../lib/contents-diff";
import { fileChangeRowActions } from "../lib/file-change-actions";
import {
  profileStackHasList,
  resolveProfileResourceStack,
} from "../lib/profile-resource-stack";
import { relatedHarnessesForResourceType } from "../lib/harness-meta";
import {
  hoverModelFromContentsDiffItem,
  hoverModelFromFileChangeChild,
  hoverModelFromFileChangeGroup,
  hoverModelFromProfileResource,
} from "../lib/resource-hover";
import {
  filterContentsResourcesBySearch,
  LIST_PAGE_SIZE,
  nextVisibleCount,
} from "../lib/resource-search";
import {
  countResourceTypeTabs,
  resolveResourceTypeTab,
} from "../lib/resource-type-tabs";
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
import { ResourceTypeTabs } from "./ResourceTypeTabs";
import {
  ResourceDetailPane,
  type ResourceDetailTarget,
} from "./ResourceDetailPane";
import { TypeIcon } from "./TypeIcon";
import {
  ResourceRowDescription,
  ResourceRowIdentity,
  ResourceRowLeading,
  ResourceRowMeta,
  ResourceRowRoot,
  ResourceRowTrailing,
} from "./ui/resource-row";

const ICON_SIZE = 14;
const NOT_STAGED_HELP =
  "On disk, not in this profile. Live copies that differ show here too.";
const NOT_STAGED_SUBTITLE = "On disk, not in this profile";
const STACK_CHANGES_SUBTITLE = "What apply would add or remove.";
const INSTALL_GAPS_HELP = "Profile items that do not match the live install.";
const INSTALL_GAPS_SUBTITLE = "Profile items not matching the live install.";

function SectionInfo({ text }: { text: string }) {
  return (
    <ChromeTooltip content={text} side="top">
      <span
        className="contents-header-info"
        aria-label={text}
        role="img"
      >
        <Info size={ICON_SIZE} strokeWidth={2} aria-hidden />
      </span>
    </ChromeTooltip>
  );
}

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
      <IconActionButton
        label="More"
        onClick={onMore}
        spinnerSize={ICON_SIZE}
        icon={<ChevronsDown size={ICON_SIZE} strokeWidth={2} aria-hidden />}
      />
      <span aria-hidden className="list-truncation-sep">
        |
      </span>
      <IconActionButton
        label="Show all"
        onClick={onShowAll}
        spinnerSize={ICON_SIZE}
        icon={<UnfoldVertical size={ICON_SIZE} strokeWidth={2} aria-hidden />}
      />
    </div>
  );
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
        <IconActionButton
          className="profile-resource-open-btn"
          label={`Open ${resource.name} in editor`}
          title="Open in default editor"
          onClick={() => onOpenInEditor(resource)}
          icon={<ExternalLink size={ICON_SIZE} strokeWidth={2} aria-hidden />}
        />
      ) : null}
      {canRemove && onRemoveFromProfile ? (
        <IconActionButton
          className="profile-resource-remove-btn"
          label={`Remove ${resource.name} from ${profileName}`}
          title="Remove from profile"
          busy={removing}
          spinnerSize={ICON_SIZE}
          onClick={() => onRemoveFromProfile(resource, pluginId)}
          icon={<Trash2 size={ICON_SIZE} strokeWidth={2} aria-hidden />}
        />
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
      <IconActionButton
        primary
        label="Edit profile"
        onClick={onEditProfile}
        icon={<Pencil size={ICON_SIZE} strokeWidth={2} aria-hidden />}
      />
    </div>
  );
}

function TargetPreviewQuietEmpty() {
  return (
    <div className="target-preview-quiet-empty" role="status">
      <Check
        className="target-preview-quiet-empty-icon"
        size={40}
        strokeWidth={1.75}
        aria-hidden
      />
      <p>no changes</p>
    </div>
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

function FileChangeKindBadgeMark({ kind }: { kind: FileChangeKind }): ReactNode {
  switch (kind) {
    case "add":
      return (
        <span className="file-change-kind-mark" aria-hidden>
          +
        </span>
      );
    case "remove":
      return (
        <span className="file-change-kind-mark" aria-hidden>
          −
        </span>
      );
    case "update":
      return <Pencil size={ICON_SIZE} strokeWidth={2} aria-hidden />;
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

function FileChangeKindBadges({
  counts,
  interactive,
  selected,
  onToggle,
  ariaLabel,
}: {
  counts: Record<FileChangeKind, number>;
  interactive: boolean;
  selected?: ReadonlySet<FileChangeKind>;
  onToggle?: (kind: FileChangeKind) => void;
  ariaLabel: string;
}): ReactNode {
  const badges = FILE_CHANGE_KIND_BADGES.flatMap(({ kind, label }) => {
    const count = counts[kind];
    if (count <= 0) {
      return [];
    }
    const on = selected?.has(kind) ?? false;
    const className = [
      "file-change-kind-badge",
      "apply-diff-kind-badge",
      kind,
      on ? "on" : "",
      interactive ? "" : "static",
    ]
      .filter(Boolean)
      .join(" ");
    const aria = interactive
      ? `Filter ${label.toLowerCase()} (${count})`
      : `${count} ${label.toLowerCase()}`;
    const inner = (
      <>
        <FileChangeKindBadgeMark kind={kind} />
        <span>{count}</span>
      </>
    );
    if (!interactive) {
      return [
        <span key={kind} className={className} aria-label={aria}>
          {inner}
        </span>,
      ];
    }
    return [
      <button
        key={kind}
        type="button"
        className={className}
        aria-pressed={on}
        aria-label={aria}
        title={label}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle?.(kind);
        }}
      >
        {inner}
      </button>,
    ];
  });
  if (badges.length === 0) {
    return null;
  }
  return (
    <div
      className="file-change-kind-badges apply-diff-kind-badges"
      role="group"
      aria-label={ariaLabel}
    >
      {badges}
    </div>
  );
}

function TargetPreviewDiffBadges({
  counts,
}: {
  counts: Record<FileChangeKind, number>;
}): ReactNode {
  return (
    <FileChangeKindBadges
      counts={counts}
      interactive={false}
      ariaLabel="Pending apply diff"
    />
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
  const detail = item.detail ? (
    <ResourceRowDescription>{item.detail}</ResourceRowDescription>
  ) : null;
  return (
    <ResourceRowRoot
      hover={hoverModelFromContentsDiffItem(item)}
      className={`diff-row ${tone}`}
    >
      <ResourceRowLeading>
        <span className="diff-mark" aria-hidden>
          {tone === "add" ? "+" : "−"}
        </span>
      </ResourceRowLeading>
      {canOpen && selector && onOpenResource ? (
        <ResourceRowIdentity
          type={item.iconType}
          label={item.label}
          onOpen={() =>
            onOpenResource({
              selector,
              label: item.label,
              pathHint: item.path,
            })
          }
        >
          {detail}
        </ResourceRowIdentity>
      ) : (
        <ResourceRowIdentity type={item.iconType} label={item.label}>
          {detail}
        </ResourceRowIdentity>
      )}
      <ResourceRowMeta
        harnessIds={relatedHarnessesForResourceType(item.iconType)}
      />
    </ResourceRowRoot>
  );
}

function UntrackedResourceRow({
  resource,
  adding,
  onAdd,
  onOpenResource,
  onDiff,
}: {
  resource: ProfileContentsResource;
  adding: boolean;
  onAdd: () => void;
  onOpenResource?: (target: ResourceDetailTarget) => void;
  onDiff?: (path: string) => void;
}) {
  const selector = resource.id ?? `${resource.type}:${resource.name}`;
  const canOpen = Boolean(onOpenResource);
  const isUpdate = resource.not_staged_kind === "update";
  const managedPath = managedPathFromResourceSource(resource.source);
  const canDiff = isUpdate && Boolean(onDiff && managedPath);
  const statusLabel = isUpdate
    ? "Live copy differs from this profile"
    : "On disk, not in this profile";
  const typeLabel = resource.type.replaceAll("_", " ");
  return (
    <ResourceRowRoot
      hover={hoverModelFromProfileResource(resource)}
      testId={`resource-row-${resource.name}`}
      className="untracked-row"
    >
      <ResourceRowLeading>
        <ChromeTooltip content={statusLabel} side="top">
          <span
            className="not-staged-status-glyph"
            aria-label={statusLabel}
            role="img"
          >
            {isUpdate ? (
              <CircleAlert size={ICON_SIZE} strokeWidth={2} aria-hidden />
            ) : (
              <CircleDashed size={ICON_SIZE} strokeWidth={2} aria-hidden />
            )}
          </span>
        </ChromeTooltip>
      </ResourceRowLeading>
      {canOpen && onOpenResource ? (
        <ResourceRowIdentity
          type={resource.type}
          label={resource.name}
          onOpen={() =>
            onOpenResource({
              selector,
              label: resource.name,
              pathHint: resource.source,
            })
          }
        >
          <ResourceRowDescription>
            {typeLabel} · {statusLabel}
          </ResourceRowDescription>
        </ResourceRowIdentity>
      ) : (
        <ResourceRowIdentity type={resource.type} label={resource.name}>
          <ResourceRowDescription>
            {typeLabel} · {statusLabel}
          </ResourceRowDescription>
        </ResourceRowIdentity>
      )}
      <ResourceRowTrailing>
        {canDiff && onDiff && managedPath ? (
          <IconActionButton
            className="file-change-diff-btn"
            label={`Show diff for ${resource.name}`}
            title="Show diff"
            onClick={() => onDiff(managedPath)}
            icon={<Diff size={ICON_SIZE} strokeWidth={2} aria-hidden />}
          />
        ) : null}
        <IconActionButton
          className="untracked-add-btn"
          showLabel
          busy={adding}
          spinnerSize={ICON_SIZE}
          label="Add"
          title={
            isUpdate
              ? `Replace profile copy of ${resource.name} with the live file`
              : `Add ${resource.name} to this profile`
          }
          onClick={onAdd}
          icon={<Plus size={ICON_SIZE} strokeWidth={2} aria-hidden />}
        />
      </ResourceRowTrailing>
    </ResourceRowRoot>
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
    <ResourceRowRoot
      hover={hoverModelFromContentsDiffItem(item)}
      testId={`resource-row-${item.label}`}
    >
      <ResourceRowLeading>
        <TypeIcon type={item.iconType} />
      </ResourceRowLeading>
      {canOpen && selector && onOpenResource ? (
        <ResourceRowIdentity
          label={item.label}
          onOpen={() =>
            onOpenResource({
              selector,
              label: item.label,
              pathHint: item.path,
            })
          }
        />
      ) : (
        <ResourceRowIdentity label={item.label} />
      )}
      {item.detail ? (
        <ResourceRowTrailing>
          <span className="enabled-detail muted">{item.detail}</span>
        </ResourceRowTrailing>
      ) : null}
    </ResourceRowRoot>
  );
}

function ProfilePluginPackageRow({
  plugin,
}: {
  plugin: ProfileContentsPlugin;
}) {
  return (
    <ResourceRowRoot
      hover={{
        type: "plugin",
        name: plugin.name,
        harnessIds: [...relatedHarnessesForResourceType("plugin")],
        extra: [],
      }}
      testId={`resource-row-${plugin.name}`}
    >
      <ResourceRowLeading>
        <TypeIcon type="plugin" />
      </ResourceRowLeading>
      <ResourceRowIdentity label={plugin.name} />
      <ResourceRowTrailing>
        <span className="enabled-detail muted">@{plugin.version}</span>
      </ResourceRowTrailing>
    </ResourceRowRoot>
  );
}

function ProfileMembershipResourceRow({
  resource,
  pluginId,
  pluginName,
  profileName,
  removing,
  onOpenResource,
  onOpenInEditor,
  onRemoveFromProfile,
}: {
  resource: ProfileContentsResource;
  pluginId?: string;
  pluginName?: string;
  profileName: string | null;
  removing: boolean;
  onOpenResource: (target: ResourceDetailTarget) => void;
  onOpenInEditor?: (resource: ProfileContentsResource) => void;
  onRemoveFromProfile?: (
    resource: ProfileContentsResource,
    pluginId?: string,
  ) => void;
}) {
  const nested = Boolean(pluginId);
  return (
    <ResourceRowRoot
      hover={hoverModelFromProfileResource(resource)}
      testId={`resource-row-${resource.name}`}
    >
      <ResourceRowLeading>
        <TypeIcon type={resource.type} />
      </ResourceRowLeading>
      <ResourceRowIdentity
        label={resource.name}
        onOpen={() => onOpenResource(resourceDetailTarget(resource))}
      />
      {pluginName || nested ? (
        <ResourceRowTrailing>
          {pluginName ? (
            <span className="enabled-detail muted">in {pluginName}</span>
          ) : null}
          {nested ? (
            <ProfileResourceActions
              resource={resource}
              pluginId={pluginId}
              profileName={profileName}
              removing={removing}
              onOpenInEditor={onOpenInEditor}
              onRemoveFromProfile={onRemoveFromProfile}
            />
          ) : null}
        </ResourceRowTrailing>
      ) : null}
    </ResourceRowRoot>
  );
}

function ProfileResourceListItem({
  row,
  profileName,
  removingResourceKey,
  onOpenResource,
  onOpenInEditor,
  onRemoveFromProfile,
}: {
  row: ProfileResourceListRow;
  profileName: string | null;
  removingResourceKey: string | null;
  onOpenResource: (target: ResourceDetailTarget) => void;
  onOpenInEditor?: (resource: ProfileContentsResource) => void;
  onRemoveFromProfile?: (
    resource: ProfileContentsResource,
    pluginId?: string,
  ) => void;
}) {
  switch (row.kind) {
    case "plugin":
      return <ProfilePluginPackageRow plugin={row.plugin} />;
    case "pin":
      return (
        <EnabledResourceRow
          item={{
            key: row.key,
            kind: "unchanged",
            category: "plugin_pin",
            iconType: "plugin_pin",
            label: row.pin.ref,
            detail: row.pin.version_constraint
              ? `@${row.pin.version_constraint}`
              : undefined,
          }}
        />
      );
    case "resource": {
      if (row.pluginId) {
        return (
          <ProfileMembershipResourceRow
            resource={row.resource}
            pluginId={row.pluginId}
            pluginName={row.pluginName}
            profileName={profileName}
            removing={
              removingResourceKey === `${row.resource.type}:${row.resource.name}`
            }
            onOpenResource={onOpenResource}
            onOpenInEditor={onOpenInEditor}
            onRemoveFromProfile={onRemoveFromProfile}
          />
        );
      }
      return (
        <EnabledResourceRow
          item={contentsResourceAsItem(row.resource)}
          onOpenResource={onOpenResource}
        />
      );
    }
    default: {
      const neverRow: never = row;
      return neverRow;
    }
  }
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
        <IconActionButton
          className="profile-resource-open-btn"
          label={
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
          busy={openBusy}
          spinnerSize={ICON_SIZE}
          onClick={() => void onOpenFileChange(change, absolutePath)}
          icon={<ExternalLink size={ICON_SIZE} strokeWidth={2} aria-hidden />}
        />
      ) : null}
      {canDiff && onDiffFileChange ? (
        <IconActionButton
          className="file-change-diff-btn"
          label={`Show diff for ${change.path}`}
          title="Show diff"
          disabled={busy}
          onClick={() => onDiffFileChange(change)}
          icon={<Diff size={ICON_SIZE} strokeWidth={2} aria-hidden />}
        />
      ) : null}
      {canAdd && onAddFileChange ? (
        <IconActionButton
          className="untracked-add-btn"
          label={`Commit ${change.path} into profile`}
          title="Commit into profile"
          disabled={busy}
          busy={addBusy}
          spinnerSize={ICON_SIZE}
          onClick={() => void onAddFileChange(change)}
          icon={<Plus size={ICON_SIZE} strokeWidth={2} aria-hidden />}
        />
      ) : null}
      {canDrop && onDropFileChange ? (
        <IconActionButton
          className="profile-resource-remove-btn"
          label={
            row.action === "update"
              ? `Restore profile version of ${change.path}`
              : `Remove ${change.path} from profile`
          }
          title={row.action === "update" ? "Restore profile version" : "Remove from profile"}
          disabled={busy}
          busy={dropBusy}
          spinnerSize={ICON_SIZE}
          onClick={() => void onDropFileChange(change)}
          icon={<Trash2 size={ICON_SIZE} strokeWidth={2} aria-hidden />}
        />
      ) : null}
    </span>
  );
}

const FILE_CHANGE_ADD_CHIP_TOOLTIP = "Will be written when you Apply";

function fileChangeKindChipTooltip(kind: FileChangeKind): string | undefined {
  switch (kind) {
    case "add":
      return FILE_CHANGE_ADD_CHIP_TOOLTIP;
    case "remove":
    case "update":
      return undefined;
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

function fileChangeKindBadge(kind: FileChangeKind): (typeof FILE_CHANGE_KIND_BADGES)[number] {
  switch (kind) {
    case "add":
    case "remove":
    case "update":
      return FILE_CHANGE_KIND_BADGES.find((badge) => badge.kind === kind)!;
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

function FileChangeKindChip({
  kind,
  count,
}: {
  kind: FileChangeKind;
  count: number;
}): ReactNode {
  const meta = fileChangeKindBadge(kind);
  const tooltip = fileChangeKindChipTooltip(kind);
  const Icon = meta.Icon;
  const chip = (
    <span
      className={`file-change-group-count ${fileChangeKindClass(kind)}`}
      aria-label={tooltip ?? `${meta.label} ${count}`}
    >
      <Icon size={ICON_SIZE} strokeWidth={2} aria-hidden />
      <span>{count}</span>
    </span>
  );
  if (!tooltip) {
    return chip;
  }
  return (
    <ChromeTooltip content={tooltip} side="top">
      {chip}
    </ChromeTooltip>
  );
}

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

function fileChangeGroupAriaLabel(
  group: FileChangeResourceGroup,
): string | undefined {
  const name = group.resource?.name;
  const type = group.resource?.type;
  if (name && type) {
    return `${name} ${type}`;
  }
  return undefined;
}

function FileChangeGroupCounts({
  group,
}: {
  group: FileChangeResourceGroup;
}): ReactNode {
  const counts = groupKindCounts(group);
  return (
    <span className="file-change-group-counts">
      {FILE_CHANGE_KIND_BADGES.map(({ kind }) => {
        const count = counts[kind];
        if (count === 0) {
          return null;
        }
        return <FileChangeKindChip key={kind} kind={kind} count={count} />;
      })}
    </span>
  );
}

function FileChangeRows({
  changes,
  filesRootPath,
  profileResourceKeys,
  kindFilter,
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
  kindFilter: ReadonlySet<FileChangeKind>;
  fileChangeBusyPath?: string | null;
  fileChangeBusyAction?: "open" | "add" | "drop" | null;
  onOpenFileChange?: (change: DriftFileChange, absolutePath: string) => Promise<void>;
  onDiffFileChange?: (change: DriftFileChange) => void;
  onAddFileChange?: (change: DriftFileChange) => Promise<void>;
  onDropFileChange?: (change: DriftFileChange) => Promise<void>;
  onOpenResource?: (target: ResourceDetailTarget) => void;
}) {
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(LIST_PAGE_SIZE);
  }, [kindFilter]);

  const groups = groupFileChangesByResource(changes);

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
        const firstChange = group.changes[0];
        const firstRow = firstChange ? rowForChange(firstChange) : null;
        const resource = group.resource;
        const singletonPath = group.singleton ? firstChange?.path : null;
        return (
          <div className="file-change-group" key={group.key}>
            <ResourceRowRoot
              hover={hoverModelFromFileChangeGroup(group)}
              className="diff-row file-change-group-row"
              ariaLabel={fileChangeGroupAriaLabel(group)}
            >
              {resource ? (
                onOpenResource ? (
                  <ResourceRowIdentity
                    type={resource.type}
                    label={singletonPath ?? resource.name}
                    className={singletonPath ? "mono" : undefined}
                    onOpen={() =>
                      onOpenResource({
                        selector: `${resource.type}:${resource.name}`,
                        label: resource.name,
                        pathHint: firstRow?.absolutePath,
                      })
                    }
                  />
                ) : (
                  <ResourceRowIdentity
                    type={resource.type}
                    label={singletonPath ?? resource.name}
                    className={singletonPath ? "mono" : undefined}
                  />
                )
              ) : (
                <ResourceRowIdentity
                  label={firstChange?.path ?? group.key}
                  className="mono"
                />
              )}
              <ResourceRowMeta harnessIds={group.platforms} />
              <ResourceRowTrailing>
                <FileChangeGroupCounts group={group} />
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
              </ResourceRowTrailing>
            </ResourceRowRoot>
            {!group.singleton
              ? group.changes.map((change, index) => {
                  const row = rowForChange(change);
                  const kind = row.action;
                  const busy = fileChangeBusyPath === change.path;
                  return (
                    <ResourceRowRoot
                      hover={hoverModelFromFileChangeChild(change)}
                      className={`diff-row file-change-child ${fileChangeKindClass(kind)}`}
                      key={`${change.type}-${change.path}-${change.platform ?? "na"}-${index}`}
                    >
                      <ResourceRowLeading>
                        <span className="diff-mark" aria-hidden>
                          {fileChangeKindMark(kind)}
                        </span>
                      </ResourceRowLeading>
                      <ResourceRowIdentity
                        label={change.path}
                        className="mono"
                      />
                      <ResourceRowMeta
                        harnessIds={change.platform ? [change.platform] : []}
                      />
                      <ResourceRowTrailing>
                        <FileChangeKindChip kind={kind} count={1} />
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
                      </ResourceRowTrailing>
                    </ResourceRowRoot>
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

function FileChangesSection({
  changes,
  filesRootPath,
  profileResourceKeys,
  managedCount = 0,
  fileChangeBusyPath = null,
  fileChangeBusyAction = null,
  committingManagedChanges,
  onCommitManagedChanges,
  onOpenFileChange,
  onDiffFileChange,
  onAddFileChange,
  onDropFileChange,
  onOpenResource,
}: {
  changes: DriftFileChange[];
  filesRootPath?: string | null;
  profileResourceKeys: Set<string>;
  managedCount?: number;
  fileChangeBusyPath?: string | null;
  fileChangeBusyAction?: "open" | "add" | "drop" | null;
  committingManagedChanges?: boolean;
  onCommitManagedChanges?: () => void | Promise<void>;
  onOpenFileChange?: (change: DriftFileChange, absolutePath: string) => Promise<void>;
  onDiffFileChange?: (change: DriftFileChange) => void;
  onAddFileChange?: (change: DriftFileChange) => Promise<void>;
  onDropFileChange?: (change: DriftFileChange) => Promise<void>;
  onOpenResource?: (target: ResourceDetailTarget) => void;
}) {
  const [kindFilter, setKindFilter] = useState<Set<FileChangeKind>>(
    () => new Set(),
  );
  const kindCounts = countFileChangeKindResources(changes);
  const showCommit =
    Boolean(onCommitManagedChanges)
    && changes.some((change) => fileChangeAction(change).action === "update");

  return (
    <details className="diff-section">
      <summary className="compare-title">
        <span className="compare-title-text">
          {managedCount > 0 ? (
            <ChromeTooltip content={`${managedCount} managed`} side="top">
              <span>File changes</span>
            </ChromeTooltip>
          ) : (
            "File changes"
          )}
        </span>
        <FileChangeKindBadges
          counts={kindCounts}
          interactive
          selected={kindFilter}
          onToggle={(kind) => {
            setKindFilter((current) => {
              const next = new Set(current);
              if (next.has(kind)) {
                next.delete(kind);
              } else {
                next.add(kind);
              }
              return next;
            });
          }}
          ariaLabel="Filter file changes by kind"
        />
        {showCommit && onCommitManagedChanges ? (
          <IconActionButton
            className="compare-title-action"
            busy={committingManagedChanges}
            spinnerSize={ICON_SIZE}
            label="Commit live file updates into profile"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void onCommitManagedChanges();
            }}
            icon={<Plus size={ICON_SIZE} strokeWidth={2} aria-hidden />}
          />
        ) : null}
      </summary>
      <FileChangeRows
        changes={changes}
        filesRootPath={filesRootPath}
        profileResourceKeys={profileResourceKeys}
        kindFilter={kindFilter}
        fileChangeBusyPath={fileChangeBusyPath}
        fileChangeBusyAction={fileChangeBusyAction}
        onOpenFileChange={onOpenFileChange}
        onDiffFileChange={onDiffFileChange}
        onAddFileChange={onAddFileChange}
        onDropFileChange={onDropFileChange}
        onOpenResource={onOpenResource}
      />
    </details>
  );
}

function contentsResourceAsItem(
  resource: ProfileContentsResource,
): ContentsDiffItem {
  return {
    key: `resource:${resource.type}:${resource.name}`,
    kind: "unchanged",
    category: "resource",
    iconType: resource.type,
    label: resource.name,
    detail: resource.type.replaceAll("_", " "),
    path: resource.source,
    selector: resource.id ?? `${resource.type}:${resource.name}`,
  };
}

function expandRecoveryActions(actions: RecoveryAction[]): RecoveryAction[] {
  const expanded: RecoveryAction[] = [];
  for (const action of actions) {
    if (action.id === "override-version" && action.versions.length > 1) {
      for (const version of action.versions) {
        expanded.push({
          ...action,
          label: `Use ${action.pluginName}@${version}`,
          versions: [version],
        });
      }
      continue;
    }
    expanded.push(action);
  }
  return expanded;
}

function installGapSyncAction(row: InstallGapRow): RecoveryAction | null {
  if (row.kind !== "missing" || row.iconType !== "plugin") {
    return null;
  }
  const raw = row.label.replace(/^plugin\s+/, "");
  const pluginName = raw.split("@")[0]?.trim() ?? "";
  if (!pluginName) {
    return null;
  }
  return {
    id: "sync-install",
    label: `Install ${pluginName}`,
    pluginName,
    sourceKind: "marketplace",
  };
}

/** Mirrors `previewProjectApply` when project drift is `na`. */
const PROJECT_NOT_TRACKED_WARNING =
  "Project is not tracked yet. Bootstrap or apply to create a snapshot.";

export interface LiveStatePanelProps {
  view: ViewScope;
  formatView: (view: ViewScope) => string;
  selectedProfile: string | null;
  activeProfile: string | null;
  liveContents: ProfileContents | null | undefined;
  applyPreview: ProfileApplyPreview | null;
  applyPreviewLoading: boolean;
  applyPreviewError: string | null;
  onRetryPreview?: () => void;
  onDismissPreviewError?: () => void;
  liveHarnesses: Record<string, HarnessLiveStatus> | null | undefined;
  hasFullHarnessSnapshot: boolean;
  baseUrl: string | null;
  token: string | null;
  bootstrapBusy?: boolean;
  onBootstrap?: () => void;
  onCreateProfileFromProject?: () => void;
  onEditProfile?: () => void;
  onAddResource?: (resource: ProfileContentsResource) => Promise<void>;
  onAddAllResources?: () => Promise<void>;
  addingResourceKey?: string | null;
  addingAllResources?: boolean;
  /** When the rail already has Re-apply as the accent CTA, demote Add all. */
  railPrimaryIsReapply?: boolean;
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
  onRetryPreview,
  onDismissPreviewError,
  liveHarnesses,
  hasFullHarnessSnapshot,
  baseUrl,
  token,
  bootstrapBusy = false,
  onBootstrap,
  onCreateProfileFromProject,
  onEditProfile,
  onAddResource,
  onAddAllResources,
  addingResourceKey = null,
  addingAllResources = false,
  railPrimaryIsReapply = false,
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
  const [profileResourceType, setProfileResourceType] = useState<string | null>(
    null,
  );
  const [profileResourceVisible, setProfileResourceVisible] = useState(
    LIST_PAGE_SIZE,
  );
  const [notStagedSearch, setNotStagedSearch] = useState("");
  const [notStagedType, setNotStagedType] = useState<string | null>(null);
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
  const installedPinRefs = useMemo(() => {
    const refs = new Set<string>();
    const harnesses = applyPreview?.harnesses ?? liveHarnesses;
    if (!harnesses) {
      return refs;
    }
    for (const status of Object.values(harnesses)) {
      for (const plugin of status.plugins ?? []) {
        if (plugin.state !== "installed") {
          continue;
        }
        refs.add(plugin.id);
        const name = plugin.id.split("@")[0]?.trim();
        if (name) {
          refs.add(name);
        }
      }
    }
    return refs;
  }, [applyPreview?.harnesses, liveHarnesses]);
  const ownedResourceKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const resource of applyPreview?.files?.owned_resources ?? []) {
      keys.add(`${resource.type}:${resource.name}`);
    }
    return keys;
  }, [applyPreview?.files?.owned_resources]);
  const ignorePluginNames = useMemo(() => {
    const names = new Set<string>();
    if (selectedProfile) {
      names.add(selectedProfile);
    }
    if (activeProfile) {
      names.add(activeProfile);
    }
    return names;
  }, [selectedProfile, activeProfile]);
  const liveMcpNames = useMemo(
    () => liveMcpNamesFromHarnesses(applyPreview?.harnesses ?? liveHarnesses),
    [applyPreview?.harnesses, liveHarnesses],
  );
  const diff = diffProfileContents(targetContents, liveContents, {
    ownedResourceKeys,
    installedPinRefs,
    ignorePluginNames,
    liveMcpNames,
  });
  const resourceStack = resolveProfileResourceStack({
    selectedProfile,
    activeProfile,
    relativeToActive,
    previewMatchesSelection,
    liveContents,
    targetContents,
  });
  const enabledSourceContents = resourceStack.contents;
  const profileStackEmpty =
    resourceStack.kind !== "loading" && !profileStackHasList(enabledSourceContents);
  const profileResourceRows = useMemo(
    () =>
      filterProfileResourceList(
        flattenProfileResourceList(enabledSourceContents),
        profileResourceSearch,
      ),
    [enabledSourceContents, profileResourceSearch],
  );

  const profileNameForActions = selectedProfile ?? activeProfile;

  const previewHarnesses = applyPreview?.harnesses ?? liveHarnesses;
  const installGaps = aggregateInstallGaps(previewHarnesses).filter(
    isTargetPreviewInstallGap,
  );
  const installGapGroups = groupInstallGaps(installGaps);
  const notStagedResources =
    applyPreview?.not_staged
    ?? applyPreview?.untracked_resources
    ?? [];
  const hasStackChanges = Boolean(selectedProfile)
    && !relativeToActive
    && (diff.added.length > 0 || diff.removed.length > 0);
  const hasFileChanges = (applyPreview?.files?.changes?.length ?? 0) > 0;
  const hasInstallGaps = installGaps.length > 0;
  const pendingKindCounts = countPendingApplyKinds({
    added: hasStackChanges ? diff.added : [],
    removed: hasStackChanges ? diff.removed : [],
    fileChanges: applyPreview?.files?.changes ?? [],
    installGaps,
  });
  const targetPreviewQuietEmpty = Boolean(applyPreview)
    && Boolean(targetContents)
    && !hasStackChanges
    && !hasFileChanges
    && !hasInstallGaps;
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
      ? expandRecoveryActions(applyPreview.recovery_actions)
      : null;

  return (
    <>
      {showPreviewError ? (
        <div className="banner error" role="alert">
          <div>{applyPreviewError}</div>
          {onRetryPreview || onDismissPreviewError ? (
            <div className="banner-actions">
              {onDismissPreviewError ? (
                <IconActionButton
                  label="Dismiss"
                  onClick={onDismissPreviewError}
                  icon={<X size={ICON_SIZE} strokeWidth={2} aria-hidden />}
                />
              ) : null}
              {onRetryPreview ? (
                <IconActionButton
                  primary
                  label="Retry"
                  onClick={onRetryPreview}
                  icon={<RefreshCw size={ICON_SIZE} strokeWidth={2} aria-hidden />}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {resourceActionError ? (
        <div className="banner error" role="alert">
          <div>{resourceActionError}</div>
          {onDismissResourceActionError ? (
            <div className="banner-actions">
              <IconActionButton
                label="Dismiss"
                onClick={onDismissResourceActionError}
                icon={<X size={ICON_SIZE} strokeWidth={2} aria-hidden />}
              />
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
                <IconActionButton
                  busy={bootstrapBusy}
                  label={bootstrapBusy ? "Bootstrapping…" : "Bootstrap"}
                  onClick={onBootstrap}
                  icon={<FolderCog size={ICON_SIZE} strokeWidth={2} aria-hidden />}
                />
              ) : null}
              {onCreateProfileFromProject ? (
                <IconActionButton
                  primary
                  label="Create profile from project"
                  onClick={onCreateProfileFromProject}
                  disabled={bootstrapBusy}
                  icon={<Plus size={ICON_SIZE} strokeWidth={2} aria-hidden />}
                />
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
            {selectedProfile && notStagedResources.length > 0 ? (
              <span className="contents-header-meta muted">
                {notStagedResources.length} not staged
              </span>
            ) : null}
          </summary>
          <div className="contents-body">
            {!activeProfile && !selectedProfile ? (
              <p className="muted">No active profile to inspect.</p>
            ) : resourceStack.kind === "loading" ? (
              <p className="muted">Loading profile resources…</p>
            ) : !enabledSourceContents ? (
              <p className="muted">
                {activeProfile || selectedProfile
                  ? "Could not resolve profile contents."
                  : "No profile resources yet."}
                {onEditProfile && (activeProfile || selectedProfile) ? (
                  <>
                    {" "}
                    <IconActionButton
                      label="Edit profile"
                      onClick={onEditProfile}
                      icon={<Pencil size={ICON_SIZE} strokeWidth={2} aria-hidden />}
                    />
                  </>
                ) : null}
              </p>
            ) : profileStackEmpty ? (
              onEditProfile ? (
                <ProfileStackEmptyState onEditProfile={onEditProfile} />
              ) : (
                <p className="muted">Add plugins or resources from your library.</p>
              )
            ) : (
              <>
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
                    const typeCounts = countResourceTypeTabs(
                      profileResourceRows.map((row) => row.type),
                    );
                    const typeTab = resolveResourceTypeTab(
                      profileResourceType,
                      typeCounts,
                    );
                    const typed =
                      typeTab === null
                        ? profileResourceRows
                        : profileResourceRows.filter((row) => row.type === typeTab);
                    const visible = typed.slice(0, profileResourceVisible);
                    return (
                      <>
                        <ResourceTypeTabs
                          counts={typeCounts}
                          value={typeTab}
                          onChange={(next) => {
                            setProfileResourceType(next);
                            setProfileResourceVisible(LIST_PAGE_SIZE);
                          }}
                        />
                        {visible.map((row) => (
                          <ProfileResourceListItem
                            key={row.key}
                            row={row}
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
                        <ListTruncationControls
                          visible={visible.length}
                          total={typed.length}
                          onMore={() =>
                            setProfileResourceVisible((current) =>
                              nextVisibleCount(current, typed.length),
                            )
                          }
                          onShowAll={() => setProfileResourceVisible(typed.length)}
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
            className="contents-block not-staged-attention"
            open
            aria-label="Not staged"
          >
            <summary className="contents-header">
              <span className="contents-header-title">
                <span>Not staged</span>
                <SectionInfo text={NOT_STAGED_HELP} />
              </span>
              {onAddAllResources ? (
                <span className="contents-header-toolbar">
                  <IconActionButton
                    primary={!railPrimaryIsReapply}
                    showLabel
                    iconAfterLabel
                    busy={addingAllResources}
                    spinnerSize={ICON_SIZE}
                    label="Add all"
                    title={`Add all ${notStagedResources.length} not-staged items to ${selectedProfile}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void onAddAllResources();
                    }}
                    icon={<ListPlus size={ICON_SIZE} strokeWidth={2} aria-hidden />}
                  />
                </span>
              ) : null}
            </summary>
            <div className="contents-body">
              <p className="muted section-one-liner">{NOT_STAGED_SUBTITLE}</p>
              <ListSearchField
                value={notStagedSearch}
                onChange={(value) => {
                  setNotStagedSearch(value);
                  setNotStagedVisible(LIST_PAGE_SIZE);
                }}
                placeholder="Filter by name"
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
                  const typeCounts = countResourceTypeTabs(
                    filtered.map((resource) => resource.type),
                  );
                  const typeTab = resolveResourceTypeTab(
                    notStagedType,
                    typeCounts,
                  );
                  const typed =
                    typeTab === null
                      ? filtered
                      : filtered.filter((resource) => resource.type === typeTab);
                  const visible = typed.slice(0, notStagedVisible);
                  return (
                    <>
                      <ResourceTypeTabs
                        counts={typeCounts}
                        value={typeTab}
                        onChange={(next) => {
                          setNotStagedType(next);
                          setNotStagedVisible(LIST_PAGE_SIZE);
                        }}
                      />
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
                            onDiff={
                              onDiffFileChange
                                ? (path) =>
                                    onDiffFileChange({
                                      path,
                                      type: "modified",
                                      ...(resource.type && resource.name
                                        ? {
                                            resource: {
                                              type: resource.type,
                                              name: resource.name,
                                            },
                                          }
                                        : {}),
                                    })
                                : undefined
                            }
                          />
                        );
                      })}
                      <ListTruncationControls
                        visible={visible.length}
                        total={typed.length}
                        onMore={() =>
                          setNotStagedVisible((current) =>
                            nextVisibleCount(current, typed.length),
                          )
                        }
                        onShowAll={() => setNotStagedVisible(typed.length)}
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
            ]
              .filter(Boolean)
              .join(" ")}
            open
            aria-label="Target preview"
          >
            <summary className="contents-header">
              <span>Target preview</span>
            </summary>
            <div className="contents-body">
              {applyPreviewLoading && !applyPreview ? (
                <p className="muted">
                  Comparing {selectedProfile} to live {formatView(view).toLowerCase()} state…
                </p>
              ) : applyPreview && targetPreviewQuietEmpty ? (
                <TargetPreviewQuietEmpty />
              ) : applyPreview ? (
                <div className="compare-grid">
                  {targetContents ? (
                    <TargetPreviewDiffBadges counts={pendingKindCounts} />
                  ) : (
                    <p className="muted">
                      Could not resolve target profile contents.
                      {onEditProfile ? (
                        <>
                          {" "}
                          <IconActionButton
                            label="Edit profile"
                            onClick={onEditProfile}
                            icon={<Pencil size={ICON_SIZE} strokeWidth={2} aria-hidden />}
                          />
                        </>
                      ) : null}
                    </p>
                  )}

                  {hasStackChanges ? (
                    <details className="diff-section">
                      <summary className="compare-title">
                        <span className="compare-title-text">
                          Stack changes
                        </span>
                        <StackChangeSummary
                          rows={summarizeStackChanges(diff.added, diff.removed)}
                        />
                      </summary>
                      <p className="muted section-one-liner">{STACK_CHANGES_SUBTITLE}</p>
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
                  ) : null}

                  {installGaps.length > 0 ? (
                    <details className="diff-section" open>
                      <summary className="compare-title">
                        <span className="compare-title-text">
                          Install gaps (in profile)
                          <SectionInfo text={INSTALL_GAPS_HELP} />
                        </span>
                      </summary>
                      <p className="muted section-one-liner">{INSTALL_GAPS_SUBTITLE}</p>
                      {!hasFullHarnessSnapshot && !applyPreview.harnesses ? (
                        <div className="muted">Checking live installs…</div>
                      ) : (
                        installGapGroups.map((group) => (
                          <details
                            className="install-gap-group"
                            key={group.kind}
                            open={
                              group.kind === "missing"
                              || group.kind === "mismatch"
                            }
                          >
                            <summary className="install-gap-group-title">
                              {group.title}
                              <span className="muted">
                                {group.rows.length}
                              </span>
                            </summary>
                            {group.rows.map((row) => {
                              const syncAction = installGapSyncAction(row);
                              const presentation = installGapRowPresentation(row);
                              const quietVerb = installGapQuietVerb(row);
                              const statusLabel = installGapStatusLabel(row);
                              return (
                          <div
                            className={`diff-row ${presentation.tone}`}
                            key={row.key}
                          >
                            <span className="diff-mark" aria-hidden>
                              {presentation.mark}
                            </span>
                            <ChromeTooltip content={statusLabel} side="top">
                              <span
                                className="not-staged-status-glyph"
                                aria-label={statusLabel}
                                role="img"
                              >
                                {row.kind === "add" ? (
                                  <CircleDashed
                                    size={ICON_SIZE}
                                    strokeWidth={2}
                                    aria-hidden
                                  />
                                ) : (
                                  <CircleAlert
                                    size={ICON_SIZE}
                                    strokeWidth={2}
                                    aria-hidden
                                  />
                                )}
                              </span>
                            </ChromeTooltip>
                            <span className="diff-body">
                              <span className="diff-label">{row.label}</span>
                              <span className="diff-detail muted">
                                {presentation.detail}
                              </span>
                              <RelatedHarnessIcons harnessIds={row.harnesses} />
                            </span>
                            {syncAction && onRecoveryAction ? (
                              <span className="diff-row-actions">
                                <IconActionButton
                                  label={syncAction.label}
                                  busy={recoveryBusy}
                                  spinnerSize={ICON_SIZE}
                                  onClick={() => onRecoveryAction(syncAction)}
                                  icon={
                                    <PackagePlus
                                      size={ICON_SIZE}
                                      strokeWidth={2}
                                      aria-hidden
                                    />
                                  }
                                />
                              </span>
                            ) : quietVerb ? (
                              <span className="diff-row-actions muted">
                                {quietVerb}
                              </span>
                            ) : null}
                          </div>
                              );
                            })}
                          </details>
                        ))
                      )}
                    </details>
                  ) : null}

                  {hasFileChanges ? (
                  <FileChangesSection
                    changes={applyPreview.files?.changes ?? []}
                    filesRootPath={filesRootPath ?? applyPreview.files?.root_path ?? null}
                    profileResourceKeys={profileResourceKeys}
                    managedCount={applyPreview.files?.expected_count ?? 0}
                    fileChangeBusyPath={fileChangeBusyPath}
                    fileChangeBusyAction={fileChangeBusyAction}
                    committingManagedChanges={committingManagedChanges}
                    onCommitManagedChanges={onCommitManagedChanges}
                    onOpenFileChange={onOpenFileChange}
                    onDiffFileChange={onDiffFileChange}
                    onAddFileChange={onAddFileChange}
                    onDropFileChange={onDropFileChange}
                    onOpenResource={openResource}
                  />
                  ) : null}
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
