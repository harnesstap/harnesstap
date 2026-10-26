import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  ArchiveRestore,
  CloudDownload,
  Copy,
  GitFork,
  History,
  MapPin,
  Pencil,
  Play,
  Plus,
  Stethoscope,
  Tag,
  TextQuote,
  Trash2,
  Unlink,
  Upload,
  Variable,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import {
  AgentApiError,
  fetchEnvironments,
  fetchLibraryPlugins,
  fetchLibraryResources,
} from "../lib/agent-client";
import {
  compositionExcludeKeys,
  compositionResourceSelector,
  isCompositionPluginPackage,
  mergeCompositionMembership,
  pluginDetailCompositionEntries,
} from "../lib/composition-membership";
import { fieldKeyAction } from "../lib/library-field-edit";
import { noSpellcheckProps } from "../lib/no-spellcheck";
import { nextPatchVersion, validateCutRows } from "../lib/cut-versions-form";
import {
  cutLibraryPlugin,
  deleteLibraryPlugin,
  fetchLibraryPluginDetail,
  fetchLibraryPluginVersions,
  duplicateLibraryPlugin,
  detachLibraryPlugin,
  setLibraryPluginExcludes,
  undoDetachLibraryPlugin,
  inheritedItemKey,
  type InheritedItem,
  type DuplicateMode,
  patchLibraryPlugin,
  patchLibraryPluginAttachments,
  rollbackLibraryPlugin,
  formatLibraryUpstream,
  pluginImportNoteLines,
  type LibraryPluginDetail,
  type LibraryPluginVersionRow,
  type PluginOrigin,
} from "../lib/api/library-plugins";
import { postPluginOriginUpdate } from "../lib/api/plugin-origin-update";
import {
  formatPluginRollbackConfirmMessage,
  pluginHistoryBackLabel,
  pluginPackageActions,
  pluginPackageBackTarget,
  type PluginDetailMode,
  type PluginPackageAction,
} from "../lib/plugin-history";
import { formatPluginOriginDisplay } from "../lib/resource-display";
import type {
  LibraryEnvironment,
  LibraryPlugin,
  LibraryResource,
} from "../lib/types";
import { ChromeTooltip } from "./ChromeTooltip";
import { ConfirmDialog } from "./ConfirmDialog";
import { EditedChip } from "./EditedChip";
import { DuplicateDialog } from "./DuplicateDialog";
import {
  DETACH_UNDO_MS,
  detachedMessage,
  duplicateSuccessMessage,
  inheritedToggleMessage,
  parentNameFromRef,
  syncedChip,
  toggleExcludeEntry,
} from "../lib/duplicate-profile";
import { OverflowMenu, type OverflowMenuItem } from "./OverflowMenu";
import { SyncedChip } from "./SyncedChip";
import { PublishProfileDrawer } from "./parity/PublishProfileDrawer";
import { DoctorReportDialog } from "./DoctorReportDialog";
import { LibraryDetailChrome } from "./LibraryDetailChrome";
import { LibraryFieldRow } from "./LibraryFieldRow";
import { PluginVersionHistoryList } from "./PluginVersionHistoryList";
import type { ApplyPluginResult } from "../lib/api/apply-plugin";
import { ApplyPluginDrawer } from "./parity/ApplyPluginDrawer";
import { IconActionButton } from "./IconActionButton";
import { PluginCompositionFields } from "./parity/PluginCompositionFields";
import {
  ScopeAddToProfileModal,
  type ScopeLibraryPick,
} from "./ScopeAddToProfileModal";
import { toast } from "../state/toast-store";

export interface PluginPackageDetailProps {
  selector: string;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  projectPath?: string | null;
  onBusyChange?: (busy: boolean) => void;
  onSuccess: (message: string) => void;
  onApplyResult?: (result: ApplyPluginResult) => void;
  onProfilesChanged: () => void;
  onDeleted: () => void;
  onBack: () => void;
  onNameCommit: (name: string) => Promise<void>;
  onFieldEditingChange: (editing: boolean) => void;
  onRegisterCancelFieldEdit?: (cancel: (() => void) | null) => void;
  onConfirmOpenChange?: (open: boolean) => void;
  onLibraryChanged?: () => void;
  historyMode?: PluginDetailMode;
  frozenVersion?: string | null;
  showBack?: boolean;
  onHistoryModeChange: (
    mode: PluginDetailMode,
    frozenVersion?: string | null,
  ) => void;
  /** Opens a profile's page; the duplicate toast uses it. */
  onOpenProfile?: (name: string) => void;
  /** Opens a profile's edit pane (header Edit). */
  onEditProfile?: (name: string) => void;
}

type PluginEditingField =
  | "name"
  | "description"
  | "tags"
  | "default_environment";

const APPLY_TOOLTIP = "Apply plugin graph";
const UPDATE_TOOLTIP = "Update from origin";
const DELETE_TOOLTIP = "Delete from library";
const CUT_TOOLTIP = "Tag a new version";
const DUPLICATE_TOOLTIP = "Duplicate";
const DOCTOR_TOOLTIP = "Run Doctor";
const HISTORY_TOOLTIP = "Browse versions";
const FROZEN_BANNER =
  "Frozen version (read-only). Restore copies it onto the working head.";
const NONE_ENV = "";

function originArticle(origin: PluginOrigin): string {
  switch (origin) {
    case "catalog":
      return "a catalog";
    case "upstream":
      return "an upstream";
    case "authored":
      return "an authored";
    default: {
      const _exhaustive: never = origin;
      return _exhaustive;
    }
  }
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

function tagsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((tag, index) => tag === right[index]);
}

function draftForTextField(
  field: "name" | "description",
  plugin: LibraryPluginDetail["plugin"],
): string {
  switch (field) {
    case "name":
      return plugin.name;
    case "description":
      return plugin.description ?? "";
    default: {
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

export function PluginPackageDetail({
  selector,
  baseUrl,
  token,
  disabled = false,
  projectPath = null,
  onBusyChange,
  onSuccess,
  onApplyResult,
  onProfilesChanged,
  onDeleted,
  onBack,
  onNameCommit,
  onFieldEditingChange,
  onRegisterCancelFieldEdit,
  onConfirmOpenChange,
  onLibraryChanged,
  historyMode = "head",
  frozenVersion = null,
  showBack = true,
  onHistoryModeChange,
  onOpenProfile,
  onEditProfile,
}: PluginPackageDetailProps) {
  const titleId = useId();
  const editorRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [detail, setDetail] = useState<LibraryPluginDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailEpoch, setDetailEpoch] = useState(0);

  const [libraryPlugins, setLibraryPlugins] = useState<LibraryPlugin[]>([]);
  const [resources, setResources] = useState<LibraryResource[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [resourceFilter, setResourceFilter] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [libraryEpoch, setLibraryEpoch] = useState(0);

  const [environments, setEnvironments] = useState<LibraryEnvironment[]>([]);
  const [busy, setBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [doctorOpen, setDoctorOpen] = useState(false);

  const [applyOpen, setApplyOpen] = useState(false);
  const [cutOpen, setCutOpen] = useState(false);
  const [cutVersion, setCutVersion] = useState("");
  const [cutEdited, setCutEdited] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [versions, setVersions] = useState<LibraryPluginVersionRow[]>([]);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [frozenDetail, setFrozenDetail] = useState<LibraryPluginDetail | null>(
    null,
  );
  const [frozenError, setFrozenError] = useState<string | null>(null);
  const [frozenLoading, setFrozenLoading] = useState(false);

  const [editingField, setEditingField] = useState<PluginEditingField | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [draftEnvId, setDraftEnvId] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [descriptionMultiline, setDescriptionMultiline] = useState(false);

  const [updateBusy, setUpdateBusy] = useState(false);
  const [optimisticMembership, setOptimisticMembership] = useState<string[] | null>(
    null,
  );

  const confirmOpen =
    applyOpen ||
    cutOpen ||
    deleteOpen ||
    duplicateOpen ||
    restoreOpen ||
    doctorOpen;
  const anyBusy = busy || doctorBusy || confirmBusy || applyBusy || rollbackBusy || updateBusy;
  const chromeLocked = disabled || !baseUrl || detailLoading;
  const authored = detail?.plugin.origin === "authored";
  const fieldsReadOnly =
    !authored || disabled || !baseUrl || historyMode !== "head";
  const pickersDisabled = chromeLocked || !authored || historyMode !== "head";
  const viewDetail =
    historyMode === "frozen" && frozenDetail ? frozenDetail : detail;

  useEffect(() => {
    onFieldEditingChange(editingField !== null);
  }, [editingField, onFieldEditingChange]);

  useEffect(() => {
    onRegisterCancelFieldEdit?.(() => {
      setEditingField(null);
      setDraft("");
      setDraftTags(detail?.plugin.tags ?? []);
      setDraftEnvId(detail?.plugin.default_environment_id ?? null);
      setFieldError(null);
    });
    return () => {
      onRegisterCancelFieldEdit?.(null);
    };
  }, [detail, onRegisterCancelFieldEdit]);

  useEffect(() => {
    onConfirmOpenChange?.(
      applyOpen ||
        cutOpen ||
        deleteOpen ||
        duplicateOpen ||
        restoreOpen ||
        doctorOpen,
    );
  }, [
    applyOpen,
    cutOpen,
    deleteOpen,
    duplicateOpen,
    restoreOpen,
    doctorOpen,
    onConfirmOpenChange,
  ]);

  useEffect(() => {
    onBusyChange?.(anyBusy);
  }, [anyBusy, onBusyChange]);

  useEffect(() => {
    setOptimisticMembership(null);
  }, [selector]);

  useEffect(() => {
    if (editingField) {
      editorRef.current?.focus();
    }
  }, [editingField]);

  const closeDoctor = () => {
    setDoctorOpen(false);
  };

  useEffect(() => {
    closeDoctor();
    if (!baseUrl || !selector) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setActionError(null);
    setEditingField(null);
    setFieldError(null);
    void fetchLibraryPluginDetail(baseUrl, token, selector)
      .then((next) => {
        if (!cancelled) {
          setDetail(next);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetailError(errorMessage(error, "Could not load plugin"));
          setDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, selector, detailEpoch]);

  useEffect(() => {
    if (!baseUrl || historyMode !== "history") {
      return;
    }
    const headName = detail?.plugin.name ?? selector;
    let cancelled = false;
    setVersionsLoading(true);
    setVersionsError(null);
    void fetchLibraryPluginVersions(baseUrl, token, headName)
      .then((next) => {
        if (!cancelled) {
          setVersions(next);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setVersionsError(errorMessage(error, "Could not load plugin versions"));
          setVersions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setVersionsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, historyMode, selector, detail?.plugin.name]);

  useEffect(() => {
    if (!baseUrl || historyMode !== "frozen" || !frozenVersion) {
      if (historyMode !== "frozen") {
        setFrozenDetail(null);
        setFrozenError(null);
        setFrozenLoading(false);
      }
      return;
    }
    const headName = detail?.plugin.name ?? selector;
    let cancelled = false;
    setFrozenLoading(true);
    setFrozenError(null);
    void fetchLibraryPluginDetail(
      baseUrl,
      token,
      `${headName}@${frozenVersion}`,
    )
      .then((next) => {
        if (!cancelled) {
          setFrozenDetail(next);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFrozenError(
            errorMessage(error, "Could not load frozen plugin version"),
          );
          setFrozenDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFrozenLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    baseUrl,
    token,
    historyMode,
    frozenVersion,
    selector,
    detail?.plugin.name,
  ]);

  useEffect(() => {
    if (!baseUrl) {
      return;
    }
    let cancelled = false;
    setLibraryLoading(true);
    setLibraryError(null);
    void Promise.all([
      fetchLibraryPlugins(baseUrl, token),
      fetchLibraryResources(baseUrl, token),
    ])
      .then(([nextPlugins, nextResources]) => {
        if (!cancelled) {
          setLibraryPlugins(nextPlugins);
          setResources(nextResources);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLibraryError(errorMessage(error, "Could not load library"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLibraryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, libraryEpoch]);

  useEffect(() => {
    if (!baseUrl) {
      setEnvironments([]);
      return;
    }
    let cancelled = false;
    void fetchEnvironments(baseUrl, token)
      .then((list) => {
        if (!cancelled) {
          setEnvironments(list.environments);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEnvironments([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token]);

  const membership = useMemo(
    () =>
      mergeCompositionMembership(resources, libraryPlugins, {
        excludePluginName: selector,
      }),
    [libraryPlugins, resources, selector],
  );

  const selectedPluginIds = useMemo(() => {
    if (!viewDetail) {
      return [];
    }
    const byName = new Map(libraryPlugins.map((plugin) => [plugin.name, plugin.id]));
    const ids: string[] = [];
    for (const dep of viewDetail.dependencies) {
      const fromMap = byName.get(dep.dependency_name);
      if (fromMap) {
        ids.push(fromMap);
      } else if (dep.resource_id) {
        ids.push(dep.resource_id);
      }
    }
    return ids;
  }, [viewDetail, libraryPlugins]);

  const selectedResourceIds = useMemo(
    () => viewDetail?.resources.map((resource) => resource.id) ?? [],
    [viewDetail],
  );

  const serverMembershipIds = useMemo(
    () => [...new Set([...selectedPluginIds, ...selectedResourceIds])],
    [selectedPluginIds, selectedResourceIds],
  );
  const selectedMembershipIds = optimisticMembership ?? serverMembershipIds;

  const compositionMembers = useMemo(
    () =>
      pluginDetailCompositionEntries(
        membership,
        selectedMembershipIds,
        viewDetail?.resources ?? [],
      ),
    [membership, selectedMembershipIds, viewDetail],
  );

  const compositionAddExcludeKeys = useMemo(
    () => compositionExcludeKeys(compositionMembers),
    [compositionMembers],
  );

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const plugin of libraryPlugins) {
      for (const tag of plugin.tags) {
        tags.add(tag);
      }
    }
    for (const tag of viewDetail?.plugin.tags ?? []) {
      tags.add(tag);
    }
    return [...tags]
      .sort((left, right) => left.localeCompare(right))
      .map((tag) => ({ value: tag, label: tag }));
  }, [libraryPlugins, viewDetail]);

  const environmentOptions = useMemo(
    () => [
      { value: NONE_ENV, label: "None" },
      ...environments.map((environment) => ({
        value: environment.id,
        label: environment.name,
      })),
    ],
    [environments],
  );

  function environmentLabel(id: string | null): string {
    if (!id) {
      return "";
    }
    return environments.find((environment) => environment.id === id)?.name ?? id;
  }

  function refreshAfterMutation(): void {
    setDetailEpoch((value) => value + 1);
    setLibraryEpoch((value) => value + 1);
    onLibraryChanged?.();
  }

  async function commitTextField(
    field: "name" | "description",
    value: string,
  ): Promise<boolean> {
    if (!baseUrl || !detail || editingField !== field) {
      return false;
    }
    const trimmedName = field === "name" ? value.trim() : value;
    const original = draftForTextField(field, detail.plugin);
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
    setBusy(true);
    setFieldError(null);
    try {
      const patch =
        field === "name" ? { name: nextValue } : { description: nextValue };
      const next = await patchLibraryPlugin(baseUrl, token, selector, patch);
      setDetail(next);
      setEditingField((current) => (current === field ? null : current));
      setFieldError(null);
      onLibraryChanged?.();
      if (field === "name" && next.plugin.name !== selector) {
        await onNameCommit(next.plugin.name);
      }
      return true;
    } catch (patchError: unknown) {
      setFieldError(errorMessage(patchError, "Could not update plugin"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function commitTags(
    nextTags: string[],
    leaveEdit = false,
  ): Promise<boolean> {
    if (!baseUrl || !detail) {
      return false;
    }
    if (tagsEqual(nextTags, detail.plugin.tags)) {
      if (leaveEdit) {
        setEditingField((current) => (current === "tags" ? null : current));
      }
      setFieldError(null);
      return true;
    }
    setBusy(true);
    setFieldError(null);
    try {
      const next = await patchLibraryPlugin(baseUrl, token, selector, {
        tags: nextTags,
      });
      setDetail(next);
      setDraftTags(next.plugin.tags);
      if (leaveEdit) {
        setEditingField((current) => (current === "tags" ? null : current));
      }
      setFieldError(null);
      onLibraryChanged?.();
      return true;
    } catch (patchError: unknown) {
      setDraftTags(detail.plugin.tags);
      setFieldError(errorMessage(patchError, "Could not update plugin"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function commitEnvironment(nextId: string | null): Promise<boolean> {
    if (!baseUrl || !detail) {
      return false;
    }
    if (nextId === detail.plugin.default_environment_id) {
      setEditingField((current) =>
        current === "default_environment" ? null : current,
      );
      setFieldError(null);
      return true;
    }
    setBusy(true);
    setFieldError(null);
    try {
      const next = await patchLibraryPlugin(baseUrl, token, selector, {
        default_environment_id: nextId,
      });
      setDetail(next);
      setDraftEnvId(next.plugin.default_environment_id);
      setEditingField((current) =>
        current === "default_environment" ? null : current,
      );
      setFieldError(null);
      onLibraryChanged?.();
      return true;
    } catch (patchError: unknown) {
      setFieldError(errorMessage(patchError, "Could not update plugin"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function commitCurrent(): Promise<boolean> {
    if (!editingField) {
      return true;
    }
    switch (editingField) {
      case "name":
      case "description":
        return commitTextField(editingField, draft);
      case "tags":
        return commitTags(draftTags, true);
      case "default_environment":
        if (fieldError) {
          return commitEnvironment(draftEnvId);
        }
        setEditingField(null);
        setFieldError(null);
        return true;
      default: {
        const _exhaustive: never = editingField;
        return _exhaustive;
      }
    }
  }

  async function startEdit(field: PluginEditingField): Promise<void> {
    if (!detail || fieldsReadOnly) {
      return;
    }
    if (editingField && editingField !== field) {
      const committed = await commitCurrent();
      if (!committed) {
        return;
      }
    }
    setEditingField(field);
    setFieldError(null);
    switch (field) {
      case "name":
      case "description": {
        const nextDraft = draftForTextField(field, detail.plugin);
        setDraft(nextDraft);
        if (field === "description") {
          setDescriptionMultiline(descriptionNeedsTextarea(nextDraft));
        }
        return;
      }
      case "tags":
        setDraftTags([...detail.plugin.tags]);
        return;
      case "default_environment":
        setDraftEnvId(detail.plugin.default_environment_id);
        return;
      default: {
        const _exhaustive: never = field;
        return _exhaustive;
      }
    }
  }

  function cancelEdit(): void {
    setEditingField(null);
    setDraft("");
    setDraftTags(detail?.plugin.tags ?? []);
    setDraftEnvId(detail?.plugin.default_environment_id ?? null);
    setFieldError(null);
  }

  function onEditorKeyDown(
    field: "name" | "description",
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void {
    const action = fieldKeyAction(event.key, {
      multiline: event.currentTarget.tagName === "TEXTAREA",
    });
    if (action === "commit") {
      event.preventDefault();
      void commitTextField(field, event.currentTarget.value);
      return;
    }
    if (action === "cancel") {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    }
  }

  const toggleMembership = (id: string) => {
    const entry = membership.find((row) => row.id === id);
    if (!entry || pickersDisabled || !baseUrl || !selector) {
      return;
    }
    const selected = selectedMembershipIds.includes(id);
    let body: Parameters<typeof patchLibraryPluginAttachments>[3];
    if (isCompositionPluginPackage(entry)) {
      const plugin = libraryPlugins.find((row) => row.id === id);
      if (!plugin) {
        return;
      }
      body = selected
        ? { remove: [{ type: "plugin", selector: plugin.name }] }
        : { add: [{ type: "plugin", selector: plugin.name }] };
    } else {
      const selectorValue = compositionResourceSelector(entry);
      body = selected
        ? { remove: [{ type: entry.type, selector: selectorValue }] }
        : { add: [{ type: entry.type, selector: selectorValue }] };
    }
    const previous = selectedMembershipIds;
    const nextIds = selected
      ? selectedMembershipIds.filter((entryId) => entryId !== id)
      : [...selectedMembershipIds, id];
    setOptimisticMembership(nextIds);
    setDetailError(null);
    void patchLibraryPluginAttachments(baseUrl, token, selector, body)
      .then((next) => {
        setDetail(next);
        setOptimisticMembership(null);
        onSuccess(`Updated plugin ${next.plugin.name}`);
        refreshAfterMutation();
      })
      .catch((error: unknown) => {
        setOptimisticMembership(previous);
        const message = errorMessage(
          error,
          "Could not update plugin composition",
        );
        toast({
          tone: "error",
          title: message,
          action: {
            label: "Retry",
            onClick: () => toggleMembership(id),
          },
        });
      });
  };

  const addLibraryItems = async (items: ScopeLibraryPick[]) => {
    if (!baseUrl || !selector || busy || pickersDisabled) {
      return;
    }
    const add: Array<{ type: string; selector: string }> = [];
    for (const item of items) {
      const entry = membership.find((row) => row.id === item.id);
      if (!entry) {
        continue;
      }
      if (isCompositionPluginPackage(entry)) {
        add.push({ type: "plugin", selector: entry.name });
        continue;
      }
      add.push({
        type: entry.type,
        selector: compositionResourceSelector(entry),
      });
    }
    if (add.length === 0) {
      return;
    }
    setBusy(true);
    setDetailError(null);
    try {
      const next = await patchLibraryPluginAttachments(
        baseUrl,
        token,
        selector,
        { add },
      );
      setDetail(next);
      onSuccess(`Updated plugin ${next.plugin.name}`);
      refreshAfterMutation();
    } catch (error: unknown) {
      const message = errorMessage(error, "Could not update plugin composition");
      setDetailError(message);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setBusy(false);
    }
  };

  const cutErrors = detail
    ? validateCutRows([
        {
          name: detail.plugin.name,
          currentVersion: detail.plugin.version,
          newVersion: cutVersion,
        },
      ])
    : {};
  const cutValid = Object.keys(cutErrors).length === 0;

  const confirmCut = async () => {
    if (!baseUrl || !detail || !cutValid) {
      return;
    }
    setConfirmBusy(true);
    try {
      const version = cutVersion.trim();
      await cutLibraryPlugin(baseUrl, token, detail.plugin.name, version);
      onSuccess(`Tagged plugin ${detail.plugin.name}@${version}`);
      setCutOpen(false);
      refreshAfterMutation();
    } catch (error: unknown) {
      setDetailError(errorMessage(error, "Could not tag plugin version"));
      setCutOpen(false);
    } finally {
      setConfirmBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!baseUrl || !detail) {
      return;
    }
    setConfirmBusy(true);
    try {
      const name = detail.plugin.name;
      const taggedProfile = detail.plugin.tags.includes("profile");
      await deleteLibraryPlugin(baseUrl, token, name);
      onSuccess(`Deleted plugin ${name}`);
      setDeleteOpen(false);
      if (taggedProfile) {
        onProfilesChanged();
      }
      onLibraryChanged?.();
      onDeleted();
    } catch (error: unknown) {
      setDetailError(errorMessage(error, "Could not delete plugin"));
      setDeleteOpen(false);
    } finally {
      setConfirmBusy(false);
    }
  };

  const confirmDuplicate = async (input: { name: string; mode: DuplicateMode }) => {
    if (!baseUrl || !detail) {
      return;
    }
    setConfirmBusy(true);
    try {
      const result = await duplicateLibraryPlugin(baseUrl, token, detail.plugin.name, input);
      const createdProfile = detail.plugin.tags.includes("profile");
      toast({
        tone: "success",
        title: duplicateSuccessMessage(detail.plugin.name, result),
        ...(createdProfile && onOpenProfile ? { onOpen: () => onOpenProfile(result.name) } : {}),
      });
      setDuplicateOpen(false);
      onLibraryChanged?.();
      if (detail.plugin.tags.includes("profile")) {
        onProfilesChanged();
      }
      await onNameCommit(result.name);
    } catch (error: unknown) {
      setDetailError(errorMessage(error, "Could not duplicate"));
      setDuplicateOpen(false);
    } finally {
      setConfirmBusy(false);
    }
  };

  const confirmRestore = async () => {
    if (!baseUrl || !detail || !frozenVersion || rollbackBusy) {
      return;
    }
    setRollbackBusy(true);
    setFrozenError(null);
    try {
      const name = detail.plugin.name;
      const head = detail.plugin.version;
      const frozen = frozenVersion;
      await rollbackLibraryPlugin(baseUrl, token, name, frozen);
      setRestoreOpen(false);
      onHistoryModeChange("head");
      setDetailEpoch((value) => value + 1);
      onLibraryChanged?.();
      onSuccess(`Restored ${name}@${frozen} onto ${head}*`);
    } catch (error: unknown) {
      setFrozenError(errorMessage(error, "Could not restore plugin version"));
      setRestoreOpen(false);
    } finally {
      setRollbackBusy(false);
    }
  };

  const versionSuffix = (() => {
    switch (historyMode) {
      case "frozen": {
        const frozen = frozenDetail?.plugin ?? null;
        if (frozen) {
          return `@${frozen.version}`;
        }
        return frozenVersion ? `@${frozenVersion}` : "";
      }
      case "history":
      case "head":
        return detail
          ? `@${detail.plugin.version}`
          : "";
      default: {
        const _exhaustive: never = historyMode;
        return _exhaustive;
      }
    }
  })();

  const showEditedChip =
    (historyMode === "head" || historyMode === "history") && Boolean(detail?.plugin.dirty);
  const editedChip =
    showEditedChip && detail ? <EditedChip version={detail.plugin.version} /> : null;

  const nameEditor =
    editingField === "name" ? (
      <>
        <input
          ref={editorRef as Ref<HTMLInputElement>}
          className="library-detail-title-input"
          value={draft}
          aria-label="Name"
          aria-invalid={fieldError ? true : undefined}
          disabled={anyBusy}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => void commitTextField("name", event.target.value)}
          onKeyDown={(event) => onEditorKeyDown("name", event)}
          {...noSpellcheckProps}
        />
        <span className="mono library-detail-version">{versionSuffix}</span>
        {editedChip}
      </>
    ) : (
      <>
        <span
          className={
            !fieldsReadOnly ? "library-detail-title-display" : undefined
          }
          tabIndex={!fieldsReadOnly ? 0 : undefined}
          onClick={() => {
            if (!fieldsReadOnly) {
              void startEdit("name");
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !fieldsReadOnly) {
              event.preventDefault();
              void startEdit("name");
            }
          }}
          onDoubleClick={() => {
            if (!fieldsReadOnly) {
              void startEdit("name");
            }
          }}
        >
          {detail?.plugin.name ?? selector}
          {fieldsReadOnly ? null : (
            <IconActionButton
              className="library-field-edit-trigger"
              label="Rename"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void startEdit("name");
              }}
              icon={<Pencil size={14} aria-hidden />}
            />
          )}
        </span>
        {versionSuffix ? (
          <span className="mono library-detail-version">{versionSuffix}</span>
        ) : null}
        {editedChip}
      </>
    );

  function renderDescriptionEditor(): ReactNode {
    if (descriptionMultiline) {
      return (
        <textarea
          ref={editorRef as Ref<HTMLTextAreaElement>}
          className="library-field-editor"
          value={draft}
          aria-label="Description"
          aria-invalid={fieldError ? true : undefined}
          disabled={anyBusy}
          rows={4}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => onEditorKeyDown("description", event)}
          {...noSpellcheckProps}
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
        disabled={anyBusy}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) =>
          void commitTextField("description", event.target.value)
        }
        onKeyDown={(event) => onEditorKeyDown("description", event)}
        {...noSpellcheckProps}
      />
    );
  }

  async function runOriginUpdate(): Promise<void> {
    if (!baseUrl || !detail || chromeLocked || updateBusy) {
      return;
    }
    setUpdateBusy(true);
    setActionError(null);
    try {
      const report = await postPluginOriginUpdate(baseUrl, token, {
        name: detail.plugin.name,
      });
      const failed = report.results.find((row) => row.status === "failed");
      if (failed) {
        setActionError(
          failed.message ?? "Could not update this plugin in the library",
        );
      } else if (report.results.some((row) => row.status === "updated")) {
        onSuccess(`Updated ${detail.plugin.name} in the library`);
      }
      setDetailEpoch((value) => value + 1);
      onLibraryChanged?.();
    } catch (error: unknown) {
      setActionError(
        errorMessage(error, "Could not update this plugin in the library"),
      );
    } finally {
      setUpdateBusy(false);
    }
  }

  const isProfile = detail?.plugin.tags.includes("profile") ?? false;
  const parentName = detail?.plugin.upstream ? parentNameFromRef(detail.plugin.upstream.ref) : "";

  const runLinkChange = async (action: () => Promise<void>, fallback: string): Promise<boolean> => {
    if (!baseUrl || !detail) {
      return false;
    }
    setBusy(true);
    setActionError(null);
    try {
      await action();
      setDetailEpoch((value) => value + 1);
      onLibraryChanged?.();
      if (isProfile) {
        onProfilesChanged();
      }
      return true;
    } catch (error: unknown) {
      setActionError(errorMessage(error, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Detach right away; Undo on the toast puts the link and the hidden list back.
  const detachNow = () => {
    if (!baseUrl || !detail) {
      return;
    }
    const name = detail.plugin.name;
    const parent = parentName;
    let undoToken: string | undefined;
    void runLinkChange(async () => {
      undoToken = (await detachLibraryPlugin(baseUrl, token, name)).undo_token;
    }, "Could not detach").then((ok) => {
      if (!ok) {
        return;
      }
      toast({
        tone: "success",
        title: detachedMessage(name, parent),
        durationMs: DETACH_UNDO_MS,
        ...(undoToken
          ? {
              action: {
                label: "Undo",
                onClick: () => {
                  const tokenToUse = undoToken ?? "";
                  void runLinkChange(
                    () => undoDetachLibraryPlugin(baseUrl, token, name, tokenToUse).then(() => undefined),
                    "Could not undo",
                  );
                },
              },
            }
          : {}),
      });
    });
  };

  const toggleInherited = (item: InheritedItem) => {
    if (!baseUrl || !detail) {
      return;
    }
    const name = detail.plugin.name;
    const key = inheritedItemKey(item);
    void runLinkChange(async () => {
      const current = (await fetchLibraryPluginDetail(baseUrl, token, name)).excludes ?? [];
      await setLibraryPluginExcludes(baseUrl, token, name, toggleExcludeEntry(current, key));
    }, "Could not change the profile").then((ok) => {
      if (!ok) {
        return;
      }
      toast({
        tone: "success",
        title: inheritedToggleMessage(item.name, !item.hidden),
        action: {
          label: "Undo",
          onClick: () => toggleInherited({ ...item, hidden: !item.hidden }),
        },
      });
    });
  };

  function renderPackageAction(action: PluginPackageAction): ReactNode {
    if (!detail) {
      return null;
    }
    const clusterLocked = chromeLocked || confirmOpen;
    switch (action) {
      case "apply":
        // Profiles apply from the sidebar only.
        if (isProfile) {
          return null;
        }
        return (
          <IconActionButton
            key="apply"
            primary
            showLabel
            data-testid="apply-package"
            disabled={clusterLocked || applyBusy}
            busy={applyBusy}
            title={APPLY_TOOLTIP}
            label="Apply"
            onClick={() => setApplyOpen(true)}
            icon={<Play size={16} aria-hidden />}
          />
        );
      case "update":
        return (
          <IconActionButton
            key="update"
            disabled={clusterLocked || updateBusy}
            busy={updateBusy}
            title={UPDATE_TOOLTIP}
            label="Update"
            onClick={() => {
              void runOriginUpdate();
            }}
            icon={<CloudDownload size={16} aria-hidden />}
          />
        );
      case "history":
        return (
          <IconActionButton
            key="history"
            disabled={clusterLocked}
            title={HISTORY_TOOLTIP}
            label="History"
            onClick={() => onHistoryModeChange("history")}
            icon={<History size={16} aria-hidden />}
          />
        );
      case "cut":
        return (
          <IconActionButton
            key="cut"
            disabled={clusterLocked}
            title={CUT_TOOLTIP}
            label="Tags"
            onClick={() => {
              setCutVersion(nextPatchVersion(detail?.plugin.version ?? ""));
              setCutEdited(false);
              setCutOpen(true);
            }}
            icon={<Tag size={16} aria-hidden />}
          />
        );
      case "duplicate":
        return (
          <IconActionButton
            key="duplicate"
            disabled={clusterLocked}
            title={DUPLICATE_TOOLTIP}
            label="Duplicate"
            onClick={() => setDuplicateOpen(true)}
            icon={<Copy size={16} aria-hidden />}
          />
        );
      case "doctor":
        return (
          <IconActionButton
            key="doctor"
            disabled={clusterLocked || doctorBusy}
            busy={doctorBusy}
            title={DOCTOR_TOOLTIP}
            label="Doctor"
            onClick={() => {
              setDoctorOpen(true);
            }}
            icon={<Stethoscope size={16} aria-hidden />}
          />
        );
      case "delete":
        return (
          <IconActionButton
            key="delete"
            disabled={clusterLocked || anyBusy}
            title={DELETE_TOOLTIP}
            label="Delete"
            onClick={() => setDeleteOpen(true)}
            icon={<Trash2 size={16} aria-hidden />}
          />
        );
      case "restore":
        return (
          <IconActionButton
            key="restore"
            primary
            showLabel
            disabled={clusterLocked || !frozenVersion}
            label="Restore"
            onClick={() => setRestoreOpen(true)}
            icon={<ArchiveRestore size={16} aria-hidden />}
          />
        );
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  }

  const packageActions = detail
    ? pluginPackageActions({
        origin: detail.plugin.origin,
        mode: historyMode,
        frozen: historyMode === "frozen",
      })
    : [];
  const clusterLockedForMenu = chromeLocked || confirmOpen;
  const overflowItems: OverflowMenuItem[] = !detail || historyMode !== "head"
    ? []
    : [
        ...(packageActions.includes("update")
          ? [{
              id: "refresh",
              label: "Refresh from origin",
              icon: <CloudDownload size={16} aria-hidden />,
              disabled: clusterLockedForMenu || updateBusy,
              onSelect: () => void runOriginUpdate(),
            }]
          : []),
        ...(packageActions.includes("doctor")
          ? [{
              id: "doctor",
              label: "Run Doctor",
              icon: <Stethoscope size={16} aria-hidden />,
              disabled: clusterLockedForMenu || doctorBusy,
              onSelect: () => setDoctorOpen(true),
            }]
          : []),
        ...(isProfile && authored
          ? [{
              id: "publish",
              label: "Publish",
              icon: <Upload size={16} aria-hidden />,
              disabled: clusterLockedForMenu,
              onSelect: () => setPublishOpen(true),
            }]
          : []),
        ...(detail.plugin.upstream?.kind === "extends"
          ? [{
              id: "detach",
              label: "Detach",
              icon: <Unlink size={16} aria-hidden />,
              disabled: clusterLockedForMenu || anyBusy,
              onSelect: detachNow,
            }]
          : []),
        ...(packageActions.includes("delete")
          ? [{
              id: "delete",
              label: "Delete",
              icon: <Trash2 size={16} aria-hidden />,
              danger: true,
              separatorBefore: true,
              disabled: clusterLockedForMenu || anyBusy,
              onSelect: () => setDeleteOpen(true),
            }]
          : []),
      ];
  const iconActionOrder: PluginPackageAction[] = ["restore", "apply", "duplicate", "cut", "history"];
  const actionButtons =
    !detail || (packageActions.length === 0 && overflowItems.length === 0)
      ? undefined
      : (
        <>
          {iconActionOrder
            .filter((action) => action !== "duplicate" && action !== "cut" && action !== "history")
            .filter((action) => packageActions.includes(action))
            .map((action) => renderPackageAction(action))}
          {isProfile && onEditProfile && historyMode === "head" ? (
            <IconActionButton
              key="edit"
              data-testid="edit-profile-from-library"
              disabled={clusterLockedForMenu}
              title="Edit profile"
              label="Edit"
              onClick={() => onEditProfile(detail.plugin.name)}
              icon={<Pencil size={16} aria-hidden />}
            />
          ) : null}
          {(["duplicate", "cut", "history"] as PluginPackageAction[])
            .filter((action) => packageActions.includes(action))
            .map((action) => renderPackageAction(action))}
          <OverflowMenu items={overflowItems} iconSize={16} disabled={chromeLocked} />
        </>
      );
  const headerSubtitle = detail ? (
    <>
      <span className="meta-chip type-chip" data-testid="library-detail-type">
        {isProfile ? "profile" : "plugin"}
      </span>
      {detail.plugin.upstream?.kind === "extends" ? (
        <SyncedChip {...syncedChip(detail.plugin.upstream, parentName)} />
      ) : null}
    </>
  ) : null;

  const record = viewDetail;

  const fields: ReactNode = (() => {
    switch (historyMode) {
      case "history":
        if (versionsLoading && versions.length === 0 && !versionsError) {
          return <p className="muted">Loading versions...</p>;
        }
        return (
          <PluginVersionHistoryList
            pluginName={detail?.plugin.name ?? selector}
            headVersion={detail?.plugin.version ?? ""}
            headDirty={detail?.plugin.dirty ?? false}
            versions={versions}
            error={versionsError}
            onSelectHead={() => onHistoryModeChange("head")}
            onSelectFrozen={(version) => onHistoryModeChange("frozen", version)}
          />
        );
      case "frozen":
        if (frozenLoading && !frozenDetail) {
          return (
            <>
              {frozenError ? (
                <div className="banner error" role="alert">
                  {frozenError}
                </div>
              ) : null}
              <p className="muted">Loading frozen version...</p>
            </>
          );
        }
        if (frozenError && !frozenDetail) {
          return (
            <div className="banner error" role="alert">
              {frozenError}
            </div>
          );
        }
        break;
      case "head":
        break;
      default: {
        const _exhaustive: never = historyMode;
        return _exhaustive;
      }
    }
    if (historyMode === "head" && detailLoading && !detail) {
      return <p className="muted">Loading plugin...</p>;
    }
    if (historyMode === "head" && detailError && !detail) {
      return (
        <div className="banner error" role="alert">
          {detailError}
        </div>
      );
    }
    if (!record) {
      return <p className="muted">Detail for {selector}</p>;
    }
    return (
    <>
      {historyMode === "frozen" ? (
        <div className="banner">{FROZEN_BANNER}</div>
      ) : null}
      {historyMode === "frozen" && frozenError ? (
        <div className="banner error" role="alert">
          {frozenError}
        </div>
      ) : null}
      {historyMode === "head" && actionError ? (
        <div className="banner error" role="alert">
          {actionError}
        </div>
      ) : null}
      {historyMode === "head" && detailError ? (
        <div className="banner error" role="alert">
          {detailError}
        </div>
      ) : null}
      {editingField === "name" && fieldError ? (
        <p className="library-field-error">{fieldError}</p>
      ) : null}
      {historyMode === "head" && !authored ? (
        <div className="banner">
          {record.plugin.name} is {originArticle(record.plugin.origin)} plugin
          and cannot be edited directly.
        </div>
      ) : null}
      {record.plugin.format_label ? (
        <LibraryFieldRow
          icon={<Tag size={16} aria-hidden />}
          fieldName="Format"
          readOnly
          display={record.plugin.format_label}
          editing={false}
          onStartEdit={() => undefined}
          onCommit={() => undefined}
          onCancel={() => undefined}
        />
      ) : null}
      {pluginImportNoteLines(record.diagnostics).length > 0 ? (
        <div className="banner" role="status">
          <p>Loaded with notes.</p>
          <ul>
            {pluginImportNoteLines(record.diagnostics).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <LibraryFieldRow
        icon={<TextQuote size={16} aria-hidden />}
        fieldName="Description"
        readOnly={fieldsReadOnly}
        display={record.plugin.description}
        placeholder="No description"
        editing={editingField === "description"}
        error={editingField === "description" ? fieldError : null}
        multiline={descriptionMultiline}
        onStartEdit={() => void startEdit("description")}
        onCommit={() => void commitTextField("description", draft)}
        onCancel={cancelEdit}
      >
        {renderDescriptionEditor()}
      </LibraryFieldRow>
      <LibraryFieldRow
        icon={<MapPin size={16} aria-hidden />}
        fieldName="Origin"
        readOnly
        display={formatPluginOriginDisplay(
          record.plugin.origin,
          record.plugin.origin_locator,
        )}
        editing={false}
        onStartEdit={() => undefined}
      />
      {record.plugin.upstream && record.plugin.upstream.kind !== "extends" ? (
        <LibraryFieldRow
          icon={<GitFork size={16} aria-hidden />}
          fieldName="Copied from"
          readOnly
          display={formatLibraryUpstream(record.plugin.upstream)}
          editing={false}
          onStartEdit={() => undefined}
        />
      ) : null}
      <LibraryFieldRow
        icon={<Tag size={16} aria-hidden />}
        fieldName="Tags"
        readOnly={fieldsReadOnly}
        display={record.plugin.tags.join(", ")}
        placeholder="No tags"
        editing={editingField === "tags"}
        error={editingField === "tags" ? fieldError : null}
        onStartEdit={() => void startEdit("tags")}
      >
        <div
          className="library-tag-editor"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelEdit();
            }
          }}
        >
          {draftTags.length > 0 ? (
            <div className="library-tag-chips">
              {draftTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="badge"
                  disabled={anyBusy}
                  onClick={() => {
                    const next = draftTags.filter((entry) => entry !== tag);
                    void commitTags(next);
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : null}
          <Combobox
            value=""
            options={tagOptions}
            allowCustom
            disabled={anyBusy}
            placeholder="Add a tag"
            onValueChange={(value) => {
              const tag = value.trim();
              if (!tag || draftTags.includes(tag)) {
                return;
              }
              const next = [...draftTags, tag];
              void commitTags(next);
            }}
          />
        </div>
      </LibraryFieldRow>
      <LibraryFieldRow
        icon={<Variable size={16} aria-hidden />}
        fieldName="Default environment"
        readOnly={fieldsReadOnly}
        display={environmentLabel(record.plugin.default_environment_id)}
        placeholder="None"
        editing={editingField === "default_environment"}
        error={editingField === "default_environment" ? fieldError : null}
        onStartEdit={() => void startEdit("default_environment")}
      >
        <div
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelEdit();
            }
          }}
        >
          <Combobox
            value={draftEnvId ?? NONE_ENV}
            options={environmentOptions}
            disabled={anyBusy}
            placeholder="None"
            onValueChange={(value) => {
              const nextId = value === NONE_ENV ? null : value;
              setDraftEnvId(nextId);
              void commitEnvironment(nextId);
            }}
          />
        </div>
      </LibraryFieldRow>
      <PluginCompositionFields
        libraryLoading={libraryLoading}
        libraryError={libraryError}
        resources={compositionMembers}
        resourceFilter={resourceFilter}
        onResourceFilter={setResourceFilter}
        selectedIds={selectedMembershipIds}
        onToggleResource={toggleMembership}
        disabled={pickersDisabled}
        emptyUnfilteredLabel={isProfile ? "Nothing in this profile yet." : "Nothing in this plugin yet."}
        inherited={
          record.plugin.upstream?.kind === "extends"
            ? {
                items: record.inherited ?? [],
                parentName,
                onToggle: pickersDisabled ? undefined : toggleInherited,
              }
            : undefined
        }
        notice={
          record.plugin.upstream?.kind === "extends" && record.parent_missing ? (
            <div className="banner">{record.parent_missing}</div>
          ) : null
        }
        footer={
          <ChromeTooltip content={isProfile ? "Add to profile" : "Add to plugin"}>
            <button
              type="button"
              className="scope-inventory-fab icon-action primary"
              data-testid="plugin-composition-fab"
              aria-label={isProfile ? "Add to profile" : "Add to plugin"}
              disabled={pickersDisabled}
              onClick={() => setAddModalOpen(true)}
            >
              <Plus size={20} strokeWidth={2} aria-hidden />
            </button>
          </ChromeTooltip>
        }
      />
    </>
    );
  })();

  function handleChromeBack(): void {
    const target = pluginPackageBackTarget(historyMode);
    switch (target) {
      case "history":
        onHistoryModeChange("history");
        return;
      case "head":
        onHistoryModeChange("head");
        return;
      case "list":
        onBack();
        return;
      default: {
        const _exhaustive: never = target;
        return _exhaustive;
      }
    }
  }

  return (
    <>
      <LibraryDetailChrome
        titleId={titleId}
        title={nameEditor}
        subtitle={headerSubtitle}
        onBack={handleChromeBack}
        showBack={showBack}
        backDisabled={confirmOpen}
        backLabel={pluginHistoryBackLabel(historyMode)}
        actions={actionButtons}
      >
        <div className="library-detail-body">{fields}</div>
      </LibraryDetailChrome>

      <DoctorReportDialog
        open={doctorOpen}
        pluginName={detail?.plugin.name ?? selector}
        selector={selector}
        baseUrl={baseUrl}
        token={token}
        onClose={closeDoctor}
        onBusyChange={setDoctorBusy}
        onSuccess={onSuccess}
      />

      <ScopeAddToProfileModal
        open={addModalOpen}
        disabled={pickersDisabled}
        baseUrl={baseUrl}
        token={token}
        profileKeys={compositionAddExcludeKeys}
        title="Add to plugin"
        addErrorFallback="Could not add to plugin"
        onClose={() => setAddModalOpen(false)}
        onAdd={addLibraryItems}
      />

      {detail ? (
        <ApplyPluginDrawer
          open={applyOpen}
          onClose={() => setApplyOpen(false)}
          pluginName={detail.plugin.name}
          isProfile={detail.plugin.tags.includes("profile")}
          baseUrl={baseUrl}
          token={token}
          projectPath={projectPath ?? null}
          disabled={disabled}
          onBusyChange={setApplyBusy}
          onSuccess={onSuccess}
          onApplyResult={onApplyResult}
          onProfilesChanged={onProfilesChanged}
        />
      ) : null}

      <ConfirmDialog
        open={cutOpen}
        title="Tag plugin version"
        description="Freeze the current working state under a new version. The previous version is kept in history."
        confirmLabel="Tag version"
        confirmDisabled={!cutValid}
        confirmBusy={confirmBusy}
        onConfirm={() => {
          void confirmCut();
        }}
        onCancel={() => {
          if (!confirmBusy) {
            setCutOpen(false);
          }
        }}
      >
        <div className="form-field">
          <Label htmlFor="plugin-cut-version">Version</Label>
          <Input
            id="plugin-cut-version"
            value={cutVersion}
            onChange={(event) => {
              setCutVersion(event.target.value);
              setCutEdited(true);
            }}
            disabled={confirmBusy}
          />
          {detail && cutEdited && cutErrors[detail.plugin.name] ? (
            <p className="muted">{cutErrors[detail.plugin.name]}</p>
          ) : null}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete plugin"
        description={
          detail ? (
            <>
              This removes {detail.plugin.name}@{detail.plugin.version} from the
              local library and its composition attachments. Resources in the
              library are not deleted.
              {detail.plugin.tags.includes("profile")
                ? " This plugin is also a profile, so the profile goes too. To keep the plugin as a plain plugin, delete the profile from Profiles instead."
                : ""}
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Delete plugin"
        confirmBusy={confirmBusy}
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={() => {
          if (!confirmBusy) {
            setDeleteOpen(false);
          }
        }}
      />

      {isProfile && authored && detail ? (
        <PublishProfileDrawer
          hideTrigger
          open={publishOpen}
          onOpenChange={setPublishOpen}
          profileName={detail.plugin.name}
          profileVersion={detail.plugin.version}
          baseUrl={baseUrl}
          token={token}
          disabled={chromeLocked}
          onSuccess={onSuccess}
          onRequestCut={() => {
            setCutVersion(nextPatchVersion(detail.plugin.version));
            setCutEdited(false);
            setCutOpen(true);
          }}
        />
      ) : null}

      <DuplicateDialog
        open={duplicateOpen}
        sourceName={detail?.plugin.name ?? ""}
        isProfile={isProfile}
        existingNames={new Set(libraryPlugins.map((plugin) => plugin.name))}
        busy={confirmBusy}
        onConfirm={(input) => {
          void confirmDuplicate(input);
        }}
        onCancel={() => setDuplicateOpen(false)}
      />

      <ConfirmDialog
        open={restoreOpen}
        title="Restore plugin version"
        description={
          detail && frozenVersion
            ? formatPluginRollbackConfirmMessage({
                headVersion: detail.plugin.version,
                frozenVersion,
                dirty: detail.plugin.dirty,
              })
            : ""
        }
        confirmLabel="Restore"
        confirmBusy={rollbackBusy}
        onConfirm={() => {
          void confirmRestore();
        }}
        onCancel={() => {
          if (!rollbackBusy) {
            setRestoreOpen(false);
          }
        }}
      />
    </>
  );
}
