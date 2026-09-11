import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  ArrowLeft,
  CheckCheck,
  Clock,
  FileCode2,
  Folder,
  Hash,
  Link,
  MapPin,
  RefreshCw,
  TextQuote,
  Trash2,
} from "lucide-react";
import {
  AgentApiError,
  fetchLibraryResourceDetail,
  openResourcePath,
  removeProfileResource,
} from "../lib/agent-client";
import { fieldKeyAction } from "../lib/library-field-edit";
import {
  deleteLibraryResource,
  isResourceConflictError,
  patchLibraryResource,
  previewLibraryResourceDelete,
  syncLibraryResource,
  type ResourceDeletePlan,
  type ResourceSyncResult,
} from "../lib/api/resource-mutate";
import { formatLibraryTimestamp } from "../lib/library-timestamp";
import {
  isPluginTypeResource,
  pluginRefShowsMarketplaceUrl,
} from "../lib/plugin-ref-detail";
import {
  RESOURCE_CONTENT_PREVIEW_LINES,
  previewResourceContent,
} from "../lib/resource-content-preview";
import {
  attachersFromResourceDetail,
  confirmableDeleteLocations,
  DISK_DELETE_CONFIRM_CHECKBOX_LABEL,
  diskDeleteConfirmationExplanation,
  diskDeleteDisabledExplanation,
  formatResourceDeleteAttachers,
  formatResourceDeletePlanSummary,
  formatResourceDeleteSuccess,
  humanizeDiskDeleteReason,
  protectedDeleteLocations,
  RESOURCE_DELETE_DISK_LABEL,
  RESOURCE_DELETE_LIBRARY_LABEL,
  resourceCanRemoveFromActiveProfile,
  resourceDeleteDiskDisabled,
  resourceDeleteDiskNeedsConfirmation,
} from "../lib/resource-delete";
import { formatOriginKindLabel } from "../lib/resource-filters";
import type { LibraryResourceDetail } from "../lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconActionButton } from "./IconActionButton";
import type { LibraryDetailChromeProps } from "./LibraryDetailChrome";
import { LibraryFieldRow } from "./LibraryFieldRow";
import {
  PathAccessActions,
  REVEAL_PATH_LABEL,
} from "./PathAccessActions";
import { PluginRefResourceList } from "./PluginRefResourceList";
import { TypeIcon } from "./TypeIcon";

export interface ResourceDetailTarget {
  /** Prefer id when known; otherwise `type:name` (optional `@namespace`). */
  selector: string;
  label: string;
  pathHint?: string | null;
}

export type ResourceDetailChrome = "dialog" | "pane";

export type ResourceDetailEditingField = "name" | "description" | "content";

const DELETE_TOOLTIP = "Remove from library";

function libraryResourceNoun(type: string): string {
  if (type === "skill") {
    return "skill";
  }
  if (type === "plugin") {
    return "plugin";
  }
  return type.replaceAll("_", " ");
}

function librarySyncPreviewTooltip(type: string): string {
  const noun = libraryResourceNoun(type);
  return `Compare this ${noun} with its origin`;
}

function pendingSyncWriteTooltip(type: string): string {
  const noun = libraryResourceNoun(type);
  return `Write origin copy to this ${noun}`;
}

export interface ResourceDetailBodyProps {
  target: ResourceDetailTarget;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onSuccess?: (message: string) => void;
  onLibraryChanged?: () => void;
  onDeleted?: () => void;
  chrome?: ResourceDetailChrome;
  Chrome?: ComponentType<LibraryDetailChromeProps>;
  onBack?: () => void;
  titleId?: string;
  closeRef?: Ref<HTMLButtonElement>;
  onClose?: () => void;
  onFieldEditingChange?: (editing: boolean) => void;
  onConfirmOpenChange?: (open: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  onOpenOwningPlugin?: (pluginName: string) => void;
}

function displayName(resource: LibraryResourceDetail): string {
  return resource.namespace
    ? `${resource.name}@${resource.namespace}`
    : resource.name;
}

function originLabel(resource: LibraryResourceDetail): string {
  const kind = formatOriginKindLabel(resource.origin_kind);
  if (isPluginTypeResource(resource.type) || !resource.origin_ref) {
    return kind;
  }
  return `${kind} (${resource.origin_ref})`;
}

function isUntrackedDetail(resource: LibraryResourceDetail): boolean {
  return (
    resource.origin_kind === "untracked" ||
    resource.id.startsWith("untracked:")
  );
}

function isSyncableDetail(resource: LibraryResourceDetail): boolean {
  return resource.origin_kind === "marketplace_link" || resource.type === "plugin";
}

function quoteResource(resource: { type: string; name: string }): string {
  return `${resource.type} "${resource.name}"`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof AgentApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function descriptionNeedsTextarea(value: string): boolean {
  return value.includes("\n") || value.length > 80;
}

function draftForField(
  field: ResourceDetailEditingField,
  resource: LibraryResourceDetail,
): string {
  switch (field) {
    case "name":
      return resource.name;
    case "description":
      return resource.description ?? "";
    case "content":
      return resource.content;
    default: {
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

export function ResourceDetailBody({
  target,
  baseUrl,
  token,
  disabled = false,
  onSuccess,
  onLibraryChanged,
  onDeleted,
  chrome = "dialog",
  Chrome,
  onBack,
  titleId: titleIdProp,
  closeRef,
  onClose,
  onFieldEditingChange,
  onConfirmOpenChange,
  onBusyChange,
  onOpenOwningPlugin,
}: ResourceDetailBodyProps) {
  const generatedTitleId = useId();
  const titleId = titleIdProp ?? generatedTitleId;
  const editorRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [detail, setDetail] = useState<LibraryResourceDetail | null>(null);
  const [preview, setPreview] = useState<ResourceSyncResult | null>(null);
  const [mutating, setMutating] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "overwrite" | null>(null);
  const [deletePlan, setDeletePlan] = useState<ResourceDeletePlan | null>(null);
  const [deleteForceChecked, setDeleteForceChecked] = useState(false);
  const deleteForceId = useId();
  const [protectionPlan, setProtectionPlan] = useState<ResourceDeletePlan | null>(
    null,
  );
  const [editingField, setEditingField] = useState<ResourceDetailEditingField | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [descriptionMultiline, setDescriptionMultiline] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | null>(null);

  const busy = mutating;
  const actionsLocked = disabled || !baseUrl || loading || busy;
  const untracked = detail ? isUntrackedDetail(detail) : true;
  const fieldsReadOnly = untracked || disabled || !baseUrl;
  const typeLabel = detail ? detail.type.replaceAll("_", " ") : "";

  useEffect(() => {
    onFieldEditingChange?.(editingField !== null);
  }, [editingField, onFieldEditingChange]);

  useEffect(() => {
    onConfirmOpenChange?.(confirm !== null);
  }, [confirm, onConfirmOpenChange]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (editingField) {
      editorRef.current?.focus();
    }
  }, [editingField]);

  useEffect(() => {
    if (!target || !baseUrl) {
      setDetail(null);
      setError(null);
      setActionError(null);
      setLoading(false);
      setPreview(null);
      setConfirm(null);
      setDeleteForceChecked(false);
      setEditingField(null);
      setFieldError(null);
      setOpeningPath(null);
      setProtectionPlan(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setActionError(null);
    setDetail(null);
    setPreview(null);
    setEditingField(null);
    setFieldError(null);
    setOpeningPath(null);
    setProtectionPlan(null);
    void fetchLibraryResourceDetail(baseUrl, token, target.selector, {
      pathHint: target.pathHint,
    })
      .then((next) => {
        if (!cancelled) {
          setDetail(next);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(errorMessage(loadError, "Could not load resource details"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [target.selector, target.pathHint, baseUrl, token]);

  useEffect(() => {
    if (!baseUrl || !detail || isUntrackedDetail(detail)) {
      setProtectionPlan(null);
      return;
    }
    let cancelled = false;
    void previewLibraryResourceDelete(baseUrl, token, target.selector)
      .then((plan) => {
        if (!cancelled) {
          setProtectionPlan(plan);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProtectionPlan(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, target.selector, detail]);

  async function startEdit(field: ResourceDetailEditingField): Promise<void> {
    if (!detail || fieldsReadOnly) {
      return;
    }
    if (editingField && editingField !== field) {
      const committed = await commitField(editingField, draft);
      if (!committed) {
        return;
      }
    }
    const nextDraft = draftForField(field, detail);
    setEditingField(field);
    setDraft(nextDraft);
    setFieldError(null);
    if (field === "description") {
      setDescriptionMultiline(descriptionNeedsTextarea(nextDraft));
    }
  }

  function cancelEdit(): void {
    setEditingField(null);
    setDraft("");
    setFieldError(null);
  }

  async function commitField(
    field: ResourceDetailEditingField,
    value: string,
  ): Promise<boolean> {
    if (!baseUrl || !target || !detail || editingField !== field) {
      return false;
    }
    const trimmedName = field === "name" ? value.trim() : value;
    const original = draftForField(field, detail);
    if (field === "name" && trimmedName.length === 0) {
      setFieldError("Name is required");
      return false;
    }
    const nextValue = field === "name" ? trimmedName : value;
    if (nextValue === original) {
      setEditingField(null);
      setFieldError(null);
      return true;
    }
    setMutating(true);
    setFieldError(null);
    try {
      const patch =
        field === "name"
          ? { name: nextValue }
          : field === "description"
            ? { description: nextValue }
            : { content: nextValue };
      await patchLibraryResource(baseUrl, token, target.selector, patch);
      const next = await fetchLibraryResourceDetail(baseUrl, token, target.selector, {
        pathHint: target.pathHint,
      });
      setDetail(next);
      setEditingField((current) => (current === field ? null : current));
      setFieldError(null);
      onLibraryChanged?.();
      return true;
    } catch (patchError: unknown) {
      setFieldError(errorMessage(patchError, "Could not update resource"));
      return false;
    } finally {
      setMutating(false);
    }
  }

  function onEditorKeyDown(
    field: ResourceDetailEditingField,
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void {
    const action = fieldKeyAction(event.key, {
      multiline: event.currentTarget.tagName === "TEXTAREA",
    });
    if (action === "commit") {
      event.preventDefault();
      void commitField(field, event.currentTarget.value);
      return;
    }
    if (action === "cancel") {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    }
  }

  async function runSync(onConflict: "fail" | "overwrite", dryRun: boolean) {
    if (!baseUrl || !target || !detail) {
      return;
    }
    setMutating(true);
    setActionError(null);
    try {
      const result = await syncLibraryResource(baseUrl, token, target.selector, {
        dry_run: dryRun,
        on_conflict: onConflict,
      });
      if (dryRun) {
        setPreview(result);
        return;
      }
      setPreview(null);
      onSuccess?.(`Synced ${quoteResource(detail)}`);
      const next = await fetchLibraryResourceDetail(baseUrl, token, target.selector, {
        pathHint: target.pathHint,
      });
      setDetail(next);
      onLibraryChanged?.();
    } catch (syncError: unknown) {
      if (!dryRun && isResourceConflictError(syncError)) {
        setConfirm("overwrite");
        return;
      }
      setActionError(errorMessage(syncError, "Could not sync resource"));
    } finally {
      setMutating(false);
    }
  }

  async function openDeleteConfirm() {
    if (!baseUrl || !target || !detail) {
      return;
    }
    setMutating(true);
    setActionError(null);
    try {
      const plan = await previewLibraryResourceDelete(baseUrl, token, target.selector);
      setDeletePlan(plan);
      setDeleteForceChecked(false);
      setConfirm("delete");
    } catch (planError: unknown) {
      setActionError(errorMessage(planError, "Could not preview resource delete"));
    } finally {
      setMutating(false);
    }
  }

  async function runDelete(mode: "library" | "library_and_disk") {
    if (!baseUrl || !target || !detail) {
      return;
    }
    setMutating(true);
    setActionError(null);
    try {
      const result = await deleteLibraryResource(
        baseUrl,
        token,
        target.selector,
        mode,
        {
          force:
            mode === "library_and_disk" &&
            resourceDeleteDiskNeedsConfirmation(deletePlan),
        },
      );
      onSuccess?.(
        formatResourceDeleteSuccess(mode, quoteResource(detail), result),
      );
      onLibraryChanged?.();
      setConfirm(null);
      setDeletePlan(null);
      setDeleteForceChecked(false);
      onDeleted?.();
    } catch (deleteError: unknown) {
      setActionError(errorMessage(deleteError, "Could not delete resource"));
    } finally {
      setMutating(false);
    }
  }

  async function runRemoveFromActive() {
    if (!baseUrl || !target || !detail) {
      return;
    }
    const attachers = attachersFromResourceDetail(detail);
    if (!attachers.active_profile) {
      return;
    }
    setMutating(true);
    setActionError(null);
    try {
      await removeProfileResource(baseUrl, token, attachers.active_profile, {
        resourceType: detail.type,
        resourceName: detail.name,
      });
      onSuccess?.(
        `Removed ${quoteResource(detail)} from ${attachers.active_profile}`,
      );
      const next = await fetchLibraryResourceDetail(baseUrl, token, target.selector, {
        pathHint: target.pathHint,
      });
      setDetail(next);
      onLibraryChanged?.();
    } catch (removeError: unknown) {
      setActionError(
        errorMessage(removeError, "Could not remove resource from active profile"),
      );
    } finally {
      setMutating(false);
    }
  }

  async function openContainedPath(path: string, reveal = false): Promise<void> {
    if (!baseUrl || openingPath) {
      return;
    }
    setOpeningPath(path);
    setActionError(null);
    try {
      await openResourcePath(baseUrl, token, { path, reveal });
    } catch (openError: unknown) {
      setActionError(
        errorMessage(
          openError,
          reveal ? "Could not reveal path in Finder" : "Could not open file in editor",
        ),
      );
    } finally {
      setOpeningPath(null);
    }
  }

  function editorPathFor(resource: LibraryResourceDetail): string {
    if (isPluginTypeResource(resource.type)) {
      return resource.install_path ?? "";
    }
    return resource.source;
  }

  function renderPathValue(path: string): ReactNode {
    if (!path) {
      return undefined;
    }
    return (
      <button
        type="button"
        className="library-field-path-button"
        title={REVEAL_PATH_LABEL}
        aria-label={`${REVEAL_PATH_LABEL}: ${path}`}
        disabled={disabled || !baseUrl || loading || Boolean(openingPath)}
        onClick={() => void openContainedPath(path, true)}
      >
        {path}
      </button>
    );
  }

  function renderPathActions(path: string, showEditor: boolean): ReactNode {
    if (!path) {
      return null;
    }
    return (
      <PathAccessActions
        path={path}
        disabled={disabled || !baseUrl || loading}
        opening={openingPath === path}
        showEditor={showEditor}
        onReveal={(next) => void openContainedPath(next, true)}
        onOpenEditor={(next) => void openContainedPath(next, false)}
      />
    );
  }

  const editorPath = detail ? editorPathFor(detail) : "";
  const showSync = Boolean(detail && !isUntrackedDetail(detail) && isSyncableDetail(detail));
  const showDelete = Boolean(detail && !isUntrackedDetail(detail));
  const showApply = Boolean(preview && preview.updated.length > 0);
  const deleteAttachers = detail ? attachersFromResourceDetail(detail) : null;
  const deleteAttacherCopy = deleteAttachers
    ? formatResourceDeleteAttachers(deleteAttachers)
    : null;
  const canRemoveFromActive = deleteAttachers
    ? resourceCanRemoveFromActiveProfile(deleteAttachers)
    : false;
  const deletePlanSummary = deletePlan
    ? formatResourceDeletePlanSummary(deletePlan)
    : null;
  const diskDeleteDisabled = resourceDeleteDiskDisabled(deletePlan);
  const diskDeleteNeedsConfirm = resourceDeleteDiskNeedsConfirmation(deletePlan);
  const diskDeleteHint = diskDeleteDisabledExplanation(deletePlan);
  const inspectDiskHint = diskDeleteDisabledExplanation(protectionPlan);
  const inspectConfirmHint = diskDeleteConfirmationExplanation(protectionPlan);
  const inspectProtectedPaths = protectionPlan
    ? protectedDeleteLocations(protectionPlan)
    : [];
  const inspectConfirmablePaths = protectionPlan
    ? confirmableDeleteLocations(protectionPlan)
    : [];
  const owningPlugins = deleteAttachers?.plugins ?? [];

  const actionButtons = (
    <>
      {showSync ? (
        <IconActionButton
          primary
          disabled={actionsLocked}
          title={detail ? librarySyncPreviewTooltip(detail.type) : undefined}
          label="Sync"
          showLabel
          onClick={() => void runSync("fail", true)}
          busy={busy}
          spinnerSize={14}
          icon={<RefreshCw size={16} aria-hidden />}
        />
      ) : null}
      {showApply ? (
        <IconActionButton
          primary
          disabled={actionsLocked}
          title={detail ? pendingSyncWriteTooltip(detail.type) : undefined}
          label="Write"
          showLabel
          onClick={() => void runSync("fail", false)}
          busy={busy}
          spinnerSize={14}
          icon={<CheckCheck size={16} aria-hidden />}
        />
      ) : null}
      {showDelete ? (
        <IconActionButton
          disabled={actionsLocked}
          title={DELETE_TOOLTIP}
          label="Delete"
          onClick={() => void openDeleteConfirm()}
          icon={<Trash2 size={16} aria-hidden />}
        />
      ) : null}
    </>
  );

  const nameEditor =
    chrome === "pane" && editingField === "name" ? (
      <input
        ref={editorRef as Ref<HTMLInputElement>}
        className="library-detail-title-input"
        value={draft}
        aria-label="Name"
        aria-invalid={fieldError ? true : undefined}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => void commitField("name", event.target.value)}
        onKeyDown={(event) => onEditorKeyDown("name", event)}
      />
    ) : (
      <span
        onDoubleClick={() => {
          if (chrome === "pane") {
            void startEdit("name");
          }
        }}
      >
        {detail
          ? chrome === "pane"
            ? detail.name
            : displayName(detail)
          : target.label}
      </span>
    );

  function renderEditor(
    field: "description" | "content",
    multiline: boolean,
  ): ReactNode {
    if (multiline) {
      return (
        <textarea
          ref={editorRef as Ref<HTMLTextAreaElement>}
          className={
            field === "content"
              ? "library-field-editor library-field-editor-content mono"
              : "library-field-editor"
          }
          value={draft}
          aria-label={field === "content" ? "Content" : "Description"}
          aria-invalid={fieldError ? true : undefined}
          disabled={busy}
          rows={field === "content" ? 12 : 4}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => void commitField(field, event.target.value)}
          onKeyDown={(event) => onEditorKeyDown(field, event)}
        />
      );
    }
    return (
      <input
        ref={editorRef as Ref<HTMLInputElement>}
        className="library-field-editor"
        value={draft}
        aria-label="Description"
        aria-invalid={fieldError ? true : undefined}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => void commitField(field, event.target.value)}
        onKeyDown={(event) => onEditorKeyDown(field, event)}
      />
    );
  }

  const fields: ReactNode = loading ? (
    <p className="muted">Loading details…</p>
  ) : !detail && error ? (
    <div className="banner error" role="alert">
      <div>{error}</div>
      {target.pathHint ? (
        <div className="muted mono resource-detail-path-hint">
          {target.pathHint}
        </div>
      ) : null}
    </div>
  ) : detail ? (
    <>
      {actionError ? (
        <div className="banner error" role="alert">
          <div>{actionError}</div>
        </div>
      ) : null}
      {chrome === "pane" && editingField === "name" && fieldError ? (
        <p className="library-field-error">{fieldError}</p>
      ) : null}
      {inspectDiskHint ? (
        <div className="resource-detail-protected" role="status">
          <p>{inspectDiskHint}</p>
          {inspectProtectedPaths.map((location) => (
            <div
              key={`${location.scope}:${location.path}`}
              className="resource-detail-protected-path"
            >
              <p className="muted">{humanizeDiskDeleteReason(location.reason)}</p>
              <p className="mono resource-detail-protected-path-value">
                {location.path}
              </p>
              <PathAccessActions
                path={location.path}
                disabled={disabled || !baseUrl || loading}
                opening={openingPath === location.path}
                onReveal={(next) => void openContainedPath(next, true)}
              />
            </div>
          ))}
          {owningPlugins.length > 0 ? (
            <p>
              Owned by plugin{owningPlugins.length === 1 ? "" : "s"}:{" "}
              {owningPlugins.map((pluginName, index) => (
                <span key={pluginName}>
                  {index > 0 ? ", " : null}
                  {onOpenOwningPlugin ? (
                    <button
                      type="button"
                      className="resource-detail-plugin-link"
                      onClick={() => onOpenOwningPlugin(pluginName)}
                    >
                      {pluginName}
                    </button>
                  ) : (
                    pluginName
                  )}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : inspectConfirmHint ? (
        <div className="resource-detail-protected" role="status">
          <p>{inspectConfirmHint}</p>
          {inspectConfirmablePaths.map((location) => (
            <div
              key={`${location.scope}:${location.path}`}
              className="resource-detail-protected-path"
            >
              <p className="muted">{humanizeDiskDeleteReason(location.reason)}</p>
              <p className="mono resource-detail-protected-path-value">
                {location.path}
              </p>
              <PathAccessActions
                path={location.path}
                disabled={disabled || !baseUrl || loading}
                opening={openingPath === location.path}
                onReveal={(next) => void openContainedPath(next, true)}
              />
            </div>
          ))}
        </div>
      ) : null}
      {isPluginTypeResource(detail.type) ? (
        <>
          <h3 className="library-detail-section">Details</h3>
          <LibraryFieldRow
            icon={<TypeIcon type={detail.type} />}
            fieldName="Type"
            readOnly
            display={typeLabel}
            editing={false}
            onStartEdit={() => undefined}
          />
          <LibraryFieldRow
            icon={<MapPin size={16} aria-hidden />}
            fieldName="Origin"
            readOnly
            display={originLabel(detail)}
            editing={false}
            onStartEdit={() => undefined}
          />
          {pluginRefShowsMarketplaceUrl(detail) ? (
            <LibraryFieldRow
              icon={<Link size={16} aria-hidden />}
              fieldName="Marketplace URL"
              readOnly
              mono
              display={detail.marketplace_url}
              editing={false}
              onStartEdit={() => undefined}
            />
          ) : null}
          <LibraryFieldRow
            icon={<Folder size={16} aria-hidden />}
            fieldName="Path"
            readOnly
            mono
            display={renderPathValue(editorPath)}
            placeholder="Install path not found"
            editing={false}
            onStartEdit={() => undefined}
            iconButtonLabel={REVEAL_PATH_LABEL}
            onIconClick={
              editorPath
                ? () => void openContainedPath(editorPath, true)
                : undefined
            }
            action={renderPathActions(editorPath, false)}
          />
          <LibraryFieldRow
            icon={<Clock size={16} aria-hidden />}
            fieldName="Updated"
            readOnly
            mono
            display={formatLibraryTimestamp(detail.updated_at)}
            editing={false}
            onStartEdit={() => undefined}
          />
          <PluginRefResourceList
            resources={detail.contained_resources}
            openingPath={openingPath}
            disabled={disabled || !baseUrl || loading}
            onOpen={(path) => void openContainedPath(path)}
          />
        </>
      ) : (
        <>
          <h3 className="library-detail-section">Details</h3>
          <LibraryFieldRow
            icon={<TypeIcon type={detail.type} />}
            fieldName="Type"
            readOnly
            display={typeLabel}
            editing={false}
            onStartEdit={() => undefined}
          />
          <LibraryFieldRow
            icon={<TextQuote size={16} aria-hidden />}
            fieldName="Description"
            readOnly={fieldsReadOnly}
            display={detail.description}
            placeholder="No description"
            editing={editingField === "description"}
            error={editingField === "description" ? fieldError : null}
            onStartEdit={() => void startEdit("description")}
          >
            {renderEditor("description", descriptionMultiline)}
          </LibraryFieldRow>
          {detail.namespace ? (
            <LibraryFieldRow
              icon={<Hash size={16} aria-hidden />}
              fieldName="Namespace"
              readOnly
              display={detail.namespace}
              editing={false}
              onStartEdit={() => undefined}
            />
          ) : null}
          <LibraryFieldRow
            icon={<Folder size={16} aria-hidden />}
            fieldName="Path"
            readOnly
            mono
            display={renderPathValue(editorPath) ?? (detail.source || "-")}
            editing={false}
            onStartEdit={() => undefined}
            iconButtonLabel={REVEAL_PATH_LABEL}
            onIconClick={
              editorPath
                ? () => void openContainedPath(editorPath, true)
                : undefined
            }
            action={renderPathActions(editorPath, true)}
          />
          <LibraryFieldRow
            icon={<MapPin size={16} aria-hidden />}
            fieldName="Origin"
            readOnly
            display={originLabel(detail)}
            editing={false}
            onStartEdit={() => undefined}
          />
          <LibraryFieldRow
            icon={<Clock size={16} aria-hidden />}
            fieldName="Updated"
            readOnly
            mono
            display={formatLibraryTimestamp(detail.updated_at)}
            editing={false}
            onStartEdit={() => undefined}
          />
          <h3 className="library-detail-section">Content</h3>
          <LibraryFieldRow
            icon={<FileCode2 size={16} aria-hidden />}
            fieldName="Content"
            readOnly={fieldsReadOnly}
            display={
              detail.content ? (
                <pre className="resource-detail-content">
                  <code>
                    {previewResourceContent(
                      detail.content,
                      RESOURCE_CONTENT_PREVIEW_LINES,
                    )}
                  </code>
                </pre>
              ) : undefined
            }
            placeholder="No content"
            editing={editingField === "content"}
            error={editingField === "content" ? fieldError : null}
            onStartEdit={() => void startEdit("content")}
          >
            {renderEditor("content", true)}
          </LibraryFieldRow>
          {detail.content_truncated ? (
            <p className="muted resource-detail-truncated">
              Content truncated for preview.
            </p>
          ) : null}
        </>
      )}
      {preview ? (
        <div className="resource-detail-sync-preview">
          <p className="muted">
            Checked {preview.checked} resource(s) · {preview.updated.length}{" "}
            updated, {preview.unchanged.length} unchanged,{" "}
            {preview.skipped.length} skipped, {preview.stale.length} stale
          </p>
          {preview.stale.map((entry) => (
            <p
              key={`${entry.resource.id}:${entry.reason}`}
              className="muted"
            >
              {entry.resource.type}:{entry.resource.name}: {entry.reason}
            </p>
          ))}
        </div>
      ) : null}
    </>
  ) : (
    <p className="muted">No details available.</p>
  );

  const confirms = (
    <>
      <ConfirmDialog
        open={confirm === "delete" && detail !== null}
        title="Delete this resource?"
        description={
          detail
            ? `Choose how to remove ${detail.type} "${detail.name}". Library-only keeps on-disk files. Library + disk removes known global, project, and source locations.`
            : ""
        }
        confirmLabel={RESOURCE_DELETE_DISK_LABEL}
        cancelLabel="Cancel"
        confirmBusy={busy}
        confirmDisabled={diskDeleteDisabled || (diskDeleteNeedsConfirm && !deleteForceChecked)}
        confirmHint={diskDeleteHint}
        secondaryLabel={RESOURCE_DELETE_LIBRARY_LABEL}
        secondaryBusy={busy}
        onSecondary={() => void runDelete("library")}
        tertiaryLabel={canRemoveFromActive ? "Remove from active profile" : undefined}
        tertiaryBusy={busy}
        onTertiary={canRemoveFromActive ? () => void runRemoveFromActive() : undefined}
        onConfirm={() => void runDelete("library_and_disk")}
        onCancel={() => {
          if (!busy) {
            setConfirm(null);
            setDeletePlan(null);
            setDeleteForceChecked(false);
          }
        }}
      >
        {deleteAttacherCopy ? (
          <div className="muted">
            {deleteAttacherCopy.profilesLine ? (
              <p>{deleteAttacherCopy.profilesLine}</p>
            ) : null}
            {deleteAttacherCopy.pluginsLine ? (
              <p>
                Plugins:{" "}
                {owningPlugins.map((pluginName, index) => (
                  <span key={pluginName}>
                    {index > 0 ? ", " : null}
                    {onOpenOwningPlugin ? (
                      <button
                        type="button"
                        className="resource-detail-plugin-link"
                        onClick={() => {
                          setConfirm(null);
                          setDeletePlan(null);
                          setDeleteForceChecked(false);
                          onOpenOwningPlugin(pluginName);
                        }}
                      >
                        {pluginName}
                      </button>
                    ) : (
                      pluginName
                    )}
                  </span>
                ))}
              </p>
            ) : null}
            {deleteAttacherCopy.emptyLine ? (
              <p>{deleteAttacherCopy.emptyLine}</p>
            ) : null}
          </div>
        ) : null}
        {deletePlanSummary ? (
          <div className="muted">
            {deletePlanSummary.emptyMessage ? (
              <p>{deletePlanSummary.emptyMessage}</p>
            ) : null}
            {deletePlanSummary.groups.map((group) => (
              <div key={group.scope}>
                <p>
                  <strong>{group.label}</strong>
                </p>
                {group.locations.map((location) => (
                  <p key={`${location.scope}:${location.path}`}>
                    {location.action}: {location.path}
                    {location.project_name ? ` (${location.project_name})` : ""}
                  </p>
                ))}
              </div>
            ))}
            {deletePlanSummary.confirmations.length > 0 ? (
              <div className="resource-detail-protected">
                <p>
                  <strong>Differs from library</strong>
                </p>
                {deletePlanSummary.confirmations.map((confirmation) => (
                  <p key={confirmation}>{confirmation}</p>
                ))}
                {deletePlan
                  ? confirmableDeleteLocations(deletePlan).map((location) => (
                      <div
                        key={`${location.scope}:${location.path}`}
                        className="resource-detail-protected-path"
                      >
                        <p className="mono resource-detail-protected-path-value">
                          {location.path}
                        </p>
                        <PathAccessActions
                          path={location.path}
                          disabled={disabled || !baseUrl || loading}
                          opening={openingPath === location.path}
                          onReveal={(next) => void openContainedPath(next, true)}
                        />
                      </div>
                    ))
                  : null}
              </div>
            ) : null}
            {deletePlanSummary.blockers.length > 0 ? (
              <div className="resource-detail-protected">
                <p>
                  <strong>Protected</strong>
                </p>
                {deletePlanSummary.blockers.map((blocker) => (
                  <p key={blocker}>{blocker}</p>
                ))}
                {deletePlan
                  ? protectedDeleteLocations(deletePlan).map((location) => (
                      <div
                        key={`${location.scope}:${location.path}`}
                        className="resource-detail-protected-path"
                      >
                        <p className="mono resource-detail-protected-path-value">
                          {location.path}
                        </p>
                        <PathAccessActions
                          path={location.path}
                          disabled={disabled || !baseUrl || loading}
                          opening={openingPath === location.path}
                          onReveal={(next) => void openContainedPath(next, true)}
                        />
                      </div>
                    ))
                  : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {diskDeleteNeedsConfirm ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id={deleteForceId}
              checked={deleteForceChecked}
              disabled={busy}
              onCheckedChange={(value) => setDeleteForceChecked(value === true)}
            />
            <Label htmlFor={deleteForceId} className="font-normal text-muted-foreground">
              {DISK_DELETE_CONFIRM_CHECKBOX_LABEL}
            </Label>
          </div>
        ) : null}
        {confirm === "delete" && actionError ? (
          <div className="banner error" role="alert">
            {actionError}
          </div>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "overwrite" && detail !== null}
        title="Overwrite library definition?"
        description={
          detail
            ? `The install tree differs from the cached library copy of ${detail.type} "${detail.name}". Continuing overwrites the library definition.`
            : ""
        }
        confirmLabel="Overwrite"
        cancelLabel="Cancel"
        confirmBusy={busy}
        onConfirm={() => {
          setConfirm(null);
          void runSync("overwrite", false);
        }}
        onCancel={() => {
          if (!busy) {
            setConfirm(null);
          }
        }}
      />
    </>
  );

  if (chrome === "pane" && Chrome && onBack) {
    return (
      <>
        <Chrome
          titleId={titleId}
          title={nameEditor}
          typeLabel={typeLabel}
          onBack={onBack}
          backDisabled={busy}
          actions={showSync || showDelete ? actionButtons : null}
        >
          <div className="library-detail-body">{fields}</div>
        </Chrome>
        {confirms}
      </>
    );
  }

  return (
    <>
      <div className="resource-detail-header">
        <button
          ref={closeRef}
          type="button"
          className="icon-action"
          aria-label="Close resource details"
          title="Close resource details"
          onClick={onClose}
          disabled={busy}
        >
          <ArrowLeft size={16} aria-hidden />
        </button>
        <div className="resource-detail-heading">
          <div className="eyebrow">Resource</div>
          <h2 id={titleId}>{nameEditor}</h2>
        </div>
      </div>
      <div className="resource-detail-body">{fields}</div>
      {showSync || showDelete ? (
        <div className="resource-detail-actions">{actionButtons}</div>
      ) : null}
      {confirms}
    </>
  );
}
