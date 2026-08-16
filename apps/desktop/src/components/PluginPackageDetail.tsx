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
  AlignLeft,
  GitFork,
  MapPin,
  Play,
  Scissors,
  Stethoscope,
  Tag,
  Trash2,
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
  fetchMarketplacePlugins,
  fetchMarketplaces,
} from "../lib/agent-client";
import { fieldKeyAction } from "../lib/library-field-edit";
import { validateCutRows } from "../lib/cut-versions-form";
import {
  cutLibraryPlugin,
  deleteLibraryPlugin,
  fetchLibraryPluginDetail,
  forkLibraryPlugin,
  patchLibraryPlugin,
  patchLibraryPluginAttachments,
  runLibraryPluginDoctor,
  type LibraryPluginDetail,
  type PluginDoctorReport,
  type PluginOrigin,
} from "../lib/api/library-plugins";
import type {
  CatalogPlugin,
  LibraryEnvironment,
  LibraryPlugin,
  LibraryResource,
  PluginMarketplaceEntry,
} from "../lib/types";
import { ButtonSpinner } from "./ButtonSpinner";
import { ConfirmDialog } from "./ConfirmDialog";
import { LibraryDetailChrome } from "./LibraryDetailChrome";
import { LibraryFieldRow } from "./LibraryFieldRow";
import { ApplyPluginDrawer } from "./parity/ApplyPluginDrawer";
import { PluginCompositionFields } from "./parity/PluginCompositionFields";

export interface PluginPackageDetailProps {
  selector: string;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  projectPath?: string | null;
  onBusyChange?: (busy: boolean) => void;
  onSuccess: (message: string) => void;
  onProfilesChanged: () => void;
  onDeleted: () => void;
  onBack: () => void;
  onNameCommit: (name: string) => Promise<void>;
  onFieldEditingChange: (editing: boolean) => void;
  onConfirmOpenChange?: (open: boolean) => void;
  onLibraryChanged?: () => void;
}

type PluginEditingField =
  | "name"
  | "description"
  | "tags"
  | "default_environment";

const APPLY_TOOLTIP =
  "Write this plugin’s graph into the selected project (or global when that drawer says so).";
const DELETE_TOOLTIP =
  "Remove this from the library. Plugins that referenced it are not edited. On-disk harness files are not deleted.";
const CUT_TOOLTIP =
  "Freeze this working head as an immutable version and start a new dirty head.";
const FORK_TOOLTIP =
  "Copy this catalog or upstream plugin into a new local authored plugin you can edit.";
const DOCTOR_TOOLTIP =
  "Run health checks on this plugin’s composition and pins.";
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
  onProfilesChanged,
  onDeleted,
  onBack,
  onNameCommit,
  onFieldEditingChange,
  onConfirmOpenChange,
  onLibraryChanged,
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
  const [libraryEpoch, setLibraryEpoch] = useState(0);

  const [marketplaces, setMarketplaces] = useState<PluginMarketplaceEntry[]>([]);
  const [marketplaceName, setMarketplaceName] = useState("");
  const [catalogPlugins, setCatalogPlugins] = useState<CatalogPlugin[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [pluginRef, setPluginRef] = useState("");

  const [environments, setEnvironments] = useState<LibraryEnvironment[]>([]);
  const [busy, setBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [doctorReport, setDoctorReport] = useState<PluginDoctorReport | null>(
    null,
  );
  const [doctorBusy, setDoctorBusy] = useState(false);

  const [applyOpen, setApplyOpen] = useState(false);
  const [cutOpen, setCutOpen] = useState(false);
  const [cutVersion, setCutVersion] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [forkName, setForkName] = useState("");
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [editingField, setEditingField] = useState<PluginEditingField | null>(
    null,
  );
  const [draft, setDraft] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [draftEnvId, setDraftEnvId] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [descriptionMultiline, setDescriptionMultiline] = useState(false);

  const anyBusy = busy || doctorBusy || confirmBusy || applyBusy;
  const actionsLocked = disabled || !baseUrl || detailLoading || anyBusy;
  const authored = detail?.plugin.origin === "authored";
  const fieldsReadOnly = !authored || disabled || !baseUrl;
  const pickersDisabled = actionsLocked || !authored;

  useEffect(() => {
    onFieldEditingChange(editingField !== null);
  }, [editingField, onFieldEditingChange]);

  useEffect(() => {
    onConfirmOpenChange?.(applyOpen || cutOpen || deleteOpen || forkOpen);
  }, [applyOpen, cutOpen, deleteOpen, forkOpen, onConfirmOpenChange]);

  useEffect(() => {
    onBusyChange?.(anyBusy);
  }, [anyBusy, onBusyChange]);

  useEffect(() => {
    if (editingField) {
      editorRef.current?.focus();
    }
  }, [editingField]);

  useEffect(() => {
    if (!baseUrl || !selector) {
      setDetail(null);
      setDoctorReport(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    setDoctorReport(null);
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

  useEffect(() => {
    if (!baseUrl) {
      return;
    }
    let cancelled = false;
    setMarketplaceLoading(true);
    setMarketplaceError(null);
    void fetchMarketplaces(baseUrl, token)
      .then((result) => {
        if (!cancelled) {
          setMarketplaces(result.marketplaces);
          setMarketplaceName(result.marketplaces[0]?.name ?? "");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMarketplaces([]);
          setMarketplaceName("");
          setMarketplaceError(errorMessage(error, "Could not load marketplaces"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMarketplaceLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token]);

  useEffect(() => {
    if (!baseUrl || !marketplaceName) {
      setCatalogPlugins([]);
      setPluginRef("");
      return;
    }
    let cancelled = false;
    setPluginsLoading(true);
    setMarketplaceError(null);
    void fetchMarketplacePlugins(baseUrl, token, marketplaceName)
      .then((result) => {
        if (!cancelled) {
          setCatalogPlugins(result.plugins);
          setPluginRef(result.plugins[0]?.ref ?? "");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCatalogPlugins([]);
          setPluginRef("");
          setMarketplaceError(
            errorMessage(error, "Could not load marketplace plugins"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPluginsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, marketplaceName, token]);

  const pluginRows = useMemo(
    () =>
      libraryPlugins
        .filter((plugin) => plugin.name !== selector)
        .map((plugin) => ({
          id: plugin.id,
          name: plugin.name,
          description: plugin.description,
        })),
    [libraryPlugins, selector],
  );

  const selectedPluginIds = useMemo(() => {
    if (!detail) {
      return [];
    }
    const byName = new Map(libraryPlugins.map((plugin) => [plugin.name, plugin.id]));
    const ids: string[] = [];
    for (const dep of detail.dependencies) {
      const fromMap = byName.get(dep.dependency_name);
      if (fromMap) {
        ids.push(fromMap);
      } else if (dep.resource_id) {
        ids.push(dep.resource_id);
      }
    }
    return ids;
  }, [detail, libraryPlugins]);

  const selectedResourceIds = useMemo(
    () => detail?.resources.map((resource) => resource.id) ?? [],
    [detail],
  );

  const composeResources = useMemo(
    () => resources.filter((resource) => resource.type !== "plugin"),
    [resources],
  );

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    for (const plugin of libraryPlugins) {
      for (const tag of plugin.tags) {
        tags.add(tag);
      }
    }
    for (const tag of detail?.plugin.tags ?? []) {
      tags.add(tag);
    }
    return [...tags]
      .sort((left, right) => left.localeCompare(right))
      .map((tag) => ({ value: tag, label: tag }));
  }, [libraryPlugins, detail]);

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

  const runPatch = async (
    body: Parameters<typeof patchLibraryPluginAttachments>[3],
  ) => {
    if (!baseUrl || !selector || busy || disabled) {
      return;
    }
    setBusy(true);
    setDetailError(null);
    try {
      const next = await patchLibraryPluginAttachments(
        baseUrl,
        token,
        selector,
        body,
      );
      setDetail(next);
      onSuccess(`Updated plugin ${next.plugin.name}`);
      refreshAfterMutation();
    } catch (error: unknown) {
      setDetailError(errorMessage(error, "Could not update plugin composition"));
    } finally {
      setBusy(false);
    }
  };

  const togglePlugin = (pluginId: string) => {
    const plugin = libraryPlugins.find((entry) => entry.id === pluginId);
    if (!plugin) {
      return;
    }
    const selected = selectedPluginIds.includes(pluginId);
    void runPatch(
      selected
        ? { remove: [{ type: "plugin", selector: plugin.name }] }
        : { add: [{ type: "plugin", selector: plugin.name }] },
    );
  };

  const toggleResource = (resourceId: string) => {
    const resource = resources.find((entry) => entry.id === resourceId);
    if (!resource) {
      return;
    }
    const selected = selectedResourceIds.includes(resourceId);
    void runPatch(
      selected
        ? { remove: [{ type: resource.type, selector: resource.name }] }
        : { add: [{ type: resource.type, selector: resource.name }] },
    );
  };

  const pinMarketplacePlugin = () => {
    const ref = pluginRef.trim();
    if (!ref) {
      return;
    }
    const catalog = catalogPlugins.find((entry) => entry.ref === ref);
    void runPatch({
      add: [
        {
          type: "plugin",
          selector: ref,
          ...(catalog?.version ? { version: catalog.version } : {}),
        },
      ],
    });
  };

  const runDoctor = async () => {
    if (!baseUrl || !selector || doctorBusy || disabled) {
      return;
    }
    setDoctorBusy(true);
    setDetailError(null);
    try {
      const report = await runLibraryPluginDoctor(baseUrl, token, selector);
      setDoctorReport(report);
      onSuccess(
        report.valid
          ? `Doctor: ${report.plugin} valid`
          : `Doctor: ${report.plugin} invalid`,
      );
    } catch (error: unknown) {
      setDetailError(errorMessage(error, "Could not run plugin doctor"));
    } finally {
      setDoctorBusy(false);
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
      onSuccess(`Cut plugin ${detail.plugin.name}@${version}`);
      setCutOpen(false);
      refreshAfterMutation();
    } catch (error: unknown) {
      setDetailError(errorMessage(error, "Could not cut plugin version"));
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

  const confirmFork = async () => {
    if (!baseUrl || !detail) {
      return;
    }
    setConfirmBusy(true);
    try {
      const asName = forkName.trim() || `${detail.plugin.name}-fork`;
      const result = await forkLibraryPlugin(
        baseUrl,
        token,
        detail.plugin.name,
        asName,
      );
      onSuccess(`Forked ${detail.plugin.name} into ${result.name}`);
      setForkOpen(false);
      onLibraryChanged?.();
      await onNameCommit(result.name);
    } catch (error: unknown) {
      setDetailError(errorMessage(error, "Could not fork plugin"));
      setForkOpen(false);
    } finally {
      setConfirmBusy(false);
    }
  };

  const pluginControlsDisabled =
    pickersDisabled
    || !token
    || marketplaceLoading
    || pluginsLoading
    || !pluginRef.trim()
    || catalogPlugins.length === 0;

  const versionSuffix = detail
    ? `@${detail.plugin.version}${detail.plugin.dirty ? "*" : ""}`
    : "";

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
        />
        <span className="mono library-detail-version">{versionSuffix}</span>
      </>
    ) : (
      <>
        <span
          onDoubleClick={() => {
            void startEdit("name");
          }}
        >
          {detail?.plugin.name ?? selector}
        </span>
        {versionSuffix ? (
          <span className="mono library-detail-version">{versionSuffix}</span>
        ) : null}
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
          onBlur={(event) =>
            void commitTextField("description", event.target.value)
          }
          onKeyDown={(event) => onEditorKeyDown("description", event)}
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
      />
    );
  }

  const actionButtons = detail ? (
    <>
      <button
        type="button"
        className="btn primary"
        data-testid="apply-package"
        disabled={actionsLocked}
        title={APPLY_TOOLTIP}
        aria-label={APPLY_TOOLTIP}
        onClick={() => setApplyOpen(true)}
      >
        <Play size={14} aria-hidden />
        Apply
      </button>
      {authored ? (
        <button
          type="button"
          className="btn"
          disabled={actionsLocked}
          title={CUT_TOOLTIP}
          aria-label={CUT_TOOLTIP}
          onClick={() => {
            setCutVersion("");
            setCutOpen(true);
          }}
        >
          <Scissors size={14} aria-hidden />
          Cut version
        </button>
      ) : (
        <button
          type="button"
          className="btn"
          disabled={actionsLocked}
          title={FORK_TOOLTIP}
          aria-label={FORK_TOOLTIP}
          onClick={() => {
            setForkName(`${detail.plugin.name}-fork`);
            setForkOpen(true);
          }}
        >
          <GitFork size={14} aria-hidden />
          Fork
        </button>
      )}
      <button
        type="button"
        className="btn"
        disabled={actionsLocked}
        title={DOCTOR_TOOLTIP}
        aria-label={DOCTOR_TOOLTIP}
        onClick={() => {
          void runDoctor();
        }}
      >
        {doctorBusy ? <ButtonSpinner size={14} /> : <Stethoscope size={14} aria-hidden />}
        Doctor
      </button>
      <button
        type="button"
        className="btn"
        disabled={actionsLocked}
        title={DELETE_TOOLTIP}
        aria-label={DELETE_TOOLTIP}
        onClick={() => setDeleteOpen(true)}
      >
        <Trash2 size={14} aria-hidden />
        Delete
      </button>
    </>
  ) : null;

  const fields: ReactNode = detailLoading && !detail ? (
    <p className="muted">Loading plugin…</p>
  ) : detailError && !detail ? (
    <div className="banner error" role="alert">
      {detailError}
    </div>
  ) : detail ? (
    <>
      {detailError ? (
        <div className="banner error" role="alert">
          {detailError}
        </div>
      ) : null}
      {editingField === "name" && fieldError ? (
        <p className="library-field-error">{fieldError}</p>
      ) : null}
      {!authored ? (
        <div className="banner">
          {detail.plugin.name} is {originArticle(detail.plugin.origin)} plugin
          and cannot be edited directly.
        </div>
      ) : null}
      <LibraryFieldRow
        icon={<AlignLeft size={16} aria-hidden />}
        fieldName="Description"
        readOnly={fieldsReadOnly}
        display={detail.plugin.description}
        placeholder="No description"
        editing={editingField === "description"}
        error={editingField === "description" ? fieldError : null}
        onStartEdit={() => void startEdit("description")}
      >
        {renderDescriptionEditor()}
      </LibraryFieldRow>
      <LibraryFieldRow
        icon={<MapPin size={16} aria-hidden />}
        fieldName="Origin"
        readOnly
        display={detail.plugin.origin}
        editing={false}
        onStartEdit={() => undefined}
      />
      <LibraryFieldRow
        icon={<Tag size={16} aria-hidden />}
        fieldName="Tags"
        readOnly={fieldsReadOnly}
        display={detail.plugin.tags.join(", ")}
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
        display={environmentLabel(detail.plugin.default_environment_id)}
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
        showMarketplace={Boolean(authored)}
        marketplaceLoading={marketplaceLoading}
        marketplaceError={marketplaceError}
        marketplaces={marketplaces}
        marketplaceName={marketplaceName}
        onMarketplaceName={setMarketplaceName}
        catalogPlugins={catalogPlugins}
        pluginsLoading={pluginsLoading}
        pluginRef={pluginRef}
        onPluginRef={setPluginRef}
        onPin={pinMarketplacePlugin}
        pinDisabled={pluginControlsDisabled}
        pinBusy={busy}
        marketplaceSelectId="plugin-marketplace"
        pluginSelectId="plugin-ref"
        libraryLoading={libraryLoading}
        libraryError={libraryError}
        pluginRows={pluginRows}
        selectedPluginIds={selectedPluginIds}
        onTogglePlugin={togglePlugin}
        resources={composeResources}
        resourceFilter={resourceFilter}
        onResourceFilter={setResourceFilter}
        selectedResourceIds={selectedResourceIds}
        onToggleResource={toggleResource}
        disabled={pickersDisabled}
      />
      {doctorReport ? (
        <section className="edit-profile-section" aria-label="Doctor">
          <h3>Doctor</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>check</th>
                <th>result</th>
                <th>message</th>
              </tr>
            </thead>
            <tbody>
              {doctorReport.results.map((row, index) => {
                const resultClass =
                  row.severity === "ok"
                    ? "muted"
                    : row.severity === "error"
                      ? "banner error"
                      : "banner";
                return (
                  <tr key={`${row.check}-${index}`}>
                    <td>{row.check}</td>
                    <td className={resultClass}>{row.severity}</td>
                    <td>{row.message}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  ) : (
    <p className="muted">Detail for {selector}</p>
  );

  return (
    <>
      <LibraryDetailChrome
        titleId={titleId}
        title={nameEditor}
        typeLabel="plugin"
        onBack={onBack}
        backDisabled={anyBusy}
        actions={actionButtons}
      >
        <div className="library-detail-body">{fields}</div>
      </LibraryDetailChrome>

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
          onProfilesChanged={onProfilesChanged}
        />
      ) : null}

      <ConfirmDialog
        open={cutOpen}
        title="Cut plugin version"
        description="Freeze the current working state under a new semver version. The previous version is kept in history."
        confirmLabel="Cut version"
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
            onChange={(event) => setCutVersion(event.target.value)}
            disabled={confirmBusy}
          />
          {detail && cutErrors[detail.plugin.name] ? (
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
                ? " This plugin is also a profile. Deleting it removes it from the library. To keep the plugin and only drop the profile tag, use Profiles."
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

      <ConfirmDialog
        open={forkOpen}
        title="Fork plugin"
        description="Creates an authored copy you can edit. Library resources are shared, not duplicated."
        confirmLabel="Fork plugin"
        confirmBusy={confirmBusy}
        onConfirm={() => {
          void confirmFork();
        }}
        onCancel={() => {
          if (!confirmBusy) {
            setForkOpen(false);
          }
        }}
      >
        <div className="form-field">
          <Label htmlFor="plugin-fork-name">Name</Label>
          <Input
            id="plugin-fork-name"
            value={forkName}
            onChange={(event) => setForkName(event.target.value)}
            disabled={confirmBusy}
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
