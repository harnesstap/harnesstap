import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Tag, Trash2, Unlink, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AgentApiError,
  attachProfileComposition,
  detachProfileComposition,
  fetchLibraryPlugins,
  fetchLibraryResources,
  fetchProfileDetail,
  patchProfileMetadata,
  renameProfile,
} from "../lib/agent-client";
import {
  compositionExcludeKeys,
  isCompositionPluginPackage,
  mergeCompositionMembership,
  pluginDetailCompositionEntries,
  profileDependencyForMember,
} from "../lib/composition-membership";
import { formatEditedLine } from "../lib/library-timestamp";
import { duplicatePluginNames } from "../lib/resource-display";
import { resourceDisplayName } from "../lib/resource-search";
import type {
  LibraryPlugin,
  LibraryResource,
  ProfileDetail,
} from "../lib/types";
import {
  detachLibraryPlugin,
  inheritedItemKey,
  setLibraryPluginExcludes,
  undoDetachLibraryPlugin,
  type InheritedItem,
} from "../lib/api/library-plugins";
import {
  DETACH_UNDO_MS,
  detachedMessage,
  inheritedToggleMessage,
  parentNameFromRef,
  syncedChip,
  toggleExcludeEntry,
} from "../lib/duplicate-profile";
import { OverflowMenu, type OverflowMenuItem } from "./OverflowMenu";
import { SyncedChip } from "./SyncedChip";
import { ChromeTooltip } from "./ChromeTooltip";
import { EditedChip } from "./EditedChip";
import { StatusPill } from "./StatusPill";
import { IconActionButton } from "./IconActionButton";
import { EditProfileParitySlots } from "./parity/EditProfileParitySlots";
import { PluginCompositionFields } from "./parity/PluginCompositionFields";
import { ProfileDeleteControls } from "./parity/ProfileDeleteControls";
import { ResourceDetailPane } from "./ResourceDetailPane";
import {
  ScopeAddToProfileModal,
  type ScopeLibraryPick,
} from "./ScopeAddToProfileModal";
import { toast } from "../state/toast-store";
import { useEscapeWhenNoLayer } from "../state/overlay-stack";

export interface EditProfilePaneProps {
  profileName: string;
  baseUrl: string | null;
  token: string | null;
  projectPath?: string | null;
  disabled?: boolean;
  onClose: () => void;
  onProfileRenamed: (nextName: string) => void;
  onMutated: (input: {
    profileName: string;
    affectsApply: boolean;
  }) => void | Promise<void>;
  onDeleted?: (result?: { plugin_name: string; plugin_deleted: boolean }, message?: string) => void;
  onCreateEnvironment?: () => void;
  onSuccess?: (message: string) => void;
  onRequestCut?: (name: string, version: string) => void;
  /** Bump after Library import so membership lists include new plugin refs. */
  libraryReloadKey?: number;
  onRegisterCloseGuard?: (guard: (() => boolean) | null) => void;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof AgentApiError && error.code === "plugin_exists") {
    return "A profile with this name already exists.";
  }
  return error instanceof Error ? error.message : fallback;
}

export function EditProfilePane({
  profileName,
  baseUrl,
  token,
  disabled = false,
  onClose,
  onProfileRenamed,
  onMutated,
  onDeleted,
  onCreateEnvironment,
  onSuccess,
  onRequestCut,
  libraryReloadKey = 0,
  onRegisterCloseGuard,
}: EditProfilePaneProps) {
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(profileName);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [plugins, setPlugins] = useState<LibraryPlugin[]>([]);
  const [resources, setResources] = useState<LibraryResource[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [resourceFilter, setResourceFilter] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [inspectTarget, setInspectTarget] = useState<{
    selector: string;
    label: string;
    pathHint?: string | null;
  } | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const pendingMeta = useRef<{ description?: string; tags?: string[] }>({});
  const metaTimer = useRef<number | null>(null);

  const applyDetail = (next: ProfileDetail) => {
    setDetail(next);
    setNameDraft(next.profile.name);
    // A draft still waiting to autosave wins over what the server sent back.
    if (pendingMeta.current.description === undefined) {
      setDescriptionDraft(next.profile.description);
    }
    if (pendingMeta.current.tags === undefined) {
      setTagsDraft(next.profile.tags.filter((tag) => tag !== "profile").join(", "));
    }
  };

  useEffect(() => {
    if (!baseUrl) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchProfileDetail(baseUrl, token, profileName)
      .then((next) => {
        if (!cancelled) {
          applyDetail(next);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(errorMessage(loadError, "Could not load profile"));
          setDetail(null);
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
  }, [baseUrl, profileName, token]);

  useEffect(() => {
    setClock(new Date());
    const timer = window.setInterval(() => {
      setClock(new Date());
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [detail?.profile.updated_at]);

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
          setPlugins(nextPlugins);
          setResources(nextResources);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setLibraryError(errorMessage(loadError, "Could not load library"));
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
  }, [baseUrl, libraryReloadKey, token]);

  const editedLine = useMemo(() => {
    const updatedAt = detail?.profile.updated_at;
    if (!updatedAt) {
      return null;
    }
    return formatEditedLine(updatedAt, { now: clock });
  }, [clock, detail?.profile.updated_at]);

  const membership = useMemo(
    () =>
      mergeCompositionMembership(resources, plugins, {
        excludePluginName: profileName,
        excludeProfileTagged: true,
      }),
    [plugins, profileName, resources],
  );
  const collidingPluginNames = useMemo(
    () => duplicatePluginNames(membership),
    [membership],
  );

  const selectedPluginIds = useMemo(() => {
    if (!detail) {
      return [];
    }
    const byName = new Map(plugins.map((plugin) => [plugin.name, plugin.id]));
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
  }, [detail, plugins]);

  const selectedResourceIds = useMemo(
    () => detail?.resources.map((resource) => resource.id) ?? [],
    [detail],
  );

  const selectedMembershipIds = useMemo(
    () => [...new Set([...selectedPluginIds, ...selectedResourceIds])],
    [selectedPluginIds, selectedResourceIds],
  );

  const compositionMembers = useMemo(
    () =>
      pluginDetailCompositionEntries(
        membership,
        selectedMembershipIds,
        detail?.resources ?? [],
      ),
    [detail, membership, selectedMembershipIds],
  );

  const compositionAddExcludeKeys = useMemo(
    () => compositionExcludeKeys(compositionMembers),
    [compositionMembers],
  );

  const runMutation = async (
    action: () => Promise<ProfileDetail | void>,
    options: { affectsApply: boolean; nextName?: string },
  ) => {
    if (busy || disabled || !baseUrl) {
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next) {
        applyDetail(next);
      }
      await onMutated({
        profileName: options.nextName ?? profileName,
        affectsApply: options.affectsApply,
      });
    } catch (mutationError) {
      setError(errorMessage(mutationError, "Could not save profile change"));
      return false;
    } finally {
      setBusy(false);
    }
    return true;
  };

  const parseTags = (value: string) =>
    value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  const savedTags = detail?.profile.tags.filter((tag) => tag !== "profile") ?? [];

  // Autosave: description and tags save a moment after typing stops, the name
  // on blur or Enter. Saving writes the Library only; harness files change on
  // Apply. Inputs stay enabled while a save runs so typing is never cut off.

  const saveMetaNow = async () => {
    if (metaTimer.current !== null) {
      window.clearTimeout(metaTimer.current);
      metaTimer.current = null;
    }
    const pending = pendingMeta.current;
    pendingMeta.current = {};
    if (!baseUrl || !detail || (pending.description === undefined && pending.tags === undefined)) {
      return;
    }
    try {
      const next = await patchProfileMetadata(baseUrl, token, profileName, pending);
      setDetail(next);
      await onMutated({ profileName, affectsApply: false });
    } catch (saveError) {
      setError(errorMessage(saveError, "Could not save profile change"));
    }
  };

  const queueMeta = (patch: { description?: string; tags?: string[] }) => {
    pendingMeta.current = { ...pendingMeta.current, ...patch };
    if (metaTimer.current !== null) {
      window.clearTimeout(metaTimer.current);
    }
    metaTimer.current = window.setTimeout(() => {
      void saveMetaNow();
    }, 600);
  };

  const onDescriptionChange = (value: string) => {
    setDescriptionDraft(value);
    queueMeta({ description: value });
  };

  const onTagsChange = (value: string) => {
    setTagsDraft(value);
    const nextTags = parseTags(value);
    if (nextTags.join("\0") !== savedTags.join("\0") || pendingMeta.current.tags) {
      queueMeta({ tags: nextTags });
    }
  };

  const commitName = () => {
    const nextName = nameDraft.trim();
    if (!detail || !baseUrl || nextName === profileName) {
      setNameDraft(profileName);
      return;
    }
    if (!nextName) {
      setNameDraft(profileName);
      return;
    }
    void runMutation(
      async () => {
        await saveMetaNow();
        const result = await renameProfile(baseUrl, token, profileName, nextName);
        onProfileRenamed(result.name);
        return fetchProfileDetail(baseUrl, token, result.name);
      },
      { affectsApply: true, nextName },
    ).then((ok) => {
      if (!ok) {
        setNameDraft(profileName);
      }
    });
  };

  const requestClose = () => {
    void saveMetaNow();
    onClose();
    return true;
  };

  // Leaving the pane any other way still saves what was typed.
  const saveOnLeave = useRef(saveMetaNow);
  saveOnLeave.current = saveMetaNow;
  useEffect(
    () => () => {
      void saveOnLeave.current();
    },
    [],
  );

  useEffect(() => {
    onRegisterCloseGuard?.(() => requestClose());
    return () => onRegisterCloseGuard?.(null);
  });

  useEscapeWhenNoLayer((event) => {
    event.preventDefault();
    requestClose();
  });

  const addLibraryItems = async (items: ScopeLibraryPick[]) => {
    if (!baseUrl || !detail || disabled || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let next = detail;
      for (const item of items) {
        const entry = membership.find((row) => row.id === item.id);
        if (!entry) {
          continue;
        }
        next = isCompositionPluginPackage(entry)
          ? await attachProfileComposition(baseUrl, token, profileName, {
              pluginId: entry.id,
            })
          : await attachProfileComposition(baseUrl, token, profileName, {
              resourceId: entry.id,
            });
      }
      applyDetail(next);
      await onMutated({
        profileName,
        affectsApply: true,
      });
    } catch (mutationError) {
      const message = errorMessage(mutationError, "Could not add to profile");
      setError(message);
      throw mutationError instanceof Error
        ? mutationError
        : new Error(message);
    } finally {
      setBusy(false);
    }
  };

  const toggleMembership = (id: string) => {
    if (!baseUrl || !detail) {
      return;
    }
    const entry = membership.find((row) => row.id === id);
    if (!entry) {
      return;
    }
    const wasSelected = selectedMembershipIds.includes(id);
    const label = resourceDisplayName(entry, collidingPluginNames);
    const isPluginHead = isCompositionPluginPackage(entry);
    // A dependency can show as its Library plugin head or, when that plugin is
    // missing from the Library, as its own dependency row. Either way unticking
    // detaches it by name; it must never attach a second copy.
    const dependencyName =
      profileDependencyForMember(id, detail.dependencies, plugins)
      ?? (isPluginHead ? entry.name : null);
    const attach = () =>
      attachProfileComposition(
        baseUrl,
        token,
        profileName,
        isPluginHead ? { pluginId: id } : { resourceId: id },
      );
    const detach = () =>
      detachProfileComposition(
        baseUrl,
        token,
        profileName,
        dependencyName ? { dependencyName } : { resourceId: id },
      );
    // Undo runs the explicit inverse, not a toggle on state from this render.
    const run = (remove: boolean) =>
      runMutation(remove ? detach : attach, { affectsApply: true });
    void run(wasSelected).then((ok) => {
      if (!ok) {
        return;
      }
      toast({
        tone: "success",
        title: wasSelected ? `Removed ${label}` : `Added ${label}`,
        action: {
          label: "Undo",
          onClick: () => void run(!wasSelected),
        },
      });
    });
  };

  const toggleInherited = (item: InheritedItem) => {
    if (!baseUrl || !detail) {
      return;
    }
    const key = inheritedItemKey(item);
    const wasHidden = (detail.excludes ?? []).includes(key);
    const label = item.name;
    void runMutation(
      async () => {
        const current = (await fetchProfileDetail(baseUrl, token, profileName)).excludes ?? [];
        await setLibraryPluginExcludes(baseUrl, token, profileName, toggleExcludeEntry(current, key));
        return fetchProfileDetail(baseUrl, token, profileName);
      },
      { affectsApply: true },
    ).then((ok) => {
      if (!ok) {
        return;
      }
      toast({
        tone: "success",
        title: inheritedToggleMessage(label, !wasHidden),
        action: {
          label: "Undo",
          onClick: () => toggleInherited({ ...item, hidden: !wasHidden }),
        },
      });
    });
  };

  const parentName = detail?.upstream ? parentNameFromRef(detail.upstream.ref) : "";

  // Detach right away; the toast's Undo puts the link and the hidden list back.
  const detachNow = () => {
    if (!baseUrl || !detail) {
      return;
    }
    const parent = parentName;
    let undoToken: string | undefined;
    void runMutation(
      async () => {
        const result = await detachLibraryPlugin(baseUrl, token, profileName);
        undoToken = result.undo_token;
        return fetchProfileDetail(baseUrl, token, profileName);
      },
      { affectsApply: true },
    ).then((ok) => {
      if (!ok) {
        return;
      }
      toast({
        tone: "success",
        title: detachedMessage(profileName, parent),
        durationMs: DETACH_UNDO_MS,
        ...(undoToken
          ? {
              action: {
                label: "Undo",
                onClick: () => {
                  const tokenToUse = undoToken ?? "";
                  void runMutation(
                    async () => {
                      await undoDetachLibraryPlugin(baseUrl, token, profileName, tokenToUse);
                      return fetchProfileDetail(baseUrl, token, profileName);
                    },
                    { affectsApply: true },
                  );
                },
              },
            }
          : {}),
      });
    });
  };

  const controlsDisabled = disabled || busy || loading;

  const editOverflowItems: OverflowMenuItem[] = [
    ...(detail?.upstream?.kind === "extends"
      ? [
          {
            id: "detach",
            label: "Detach",
            icon: <Unlink size={16} aria-hidden />,
            disabled: controlsDisabled,
            onSelect: detachNow,
          },
        ]
      : []),
    {
      id: "delete",
      label: "Delete",
      icon: <Trash2 size={16} aria-hidden />,
      danger: true,
      separatorBefore: detail?.upstream?.kind === "extends",
      disabled: disabled || busy,
      onSelect: () => setDeleteOpen(true),
    },
  ];

  return (
    <main className="edit-profile-pane" aria-label={`Edit ${profileName}`}>
      <div className="edit-profile-header">
        <div className="edit-profile-title">
          <h2>
            Edit · {profileName}
            {detail?.active ? (
              <StatusPill kind="active" />
            ) : null}
            {detail?.profile.version ? (
              <span className="badge badge-meta">v{detail.profile.version}</span>
            ) : null}
            {detail?.profile.version && detail.profile.dirty ? (
              <EditedChip version={detail.profile.version} />
            ) : null}
          </h2>
          {detail?.upstream?.kind === "extends" ? (
            <SyncedChip
              {...syncedChip(detail.upstream, parentName)}
            />
          ) : null}
          {editedLine ? (
            <ChromeTooltip content={editedLine.exact}>
              <p className="muted edit-profile-last-edit" tabIndex={0}>
                {editedLine.text}
              </p>
            </ChromeTooltip>
          ) : null}
        </div>
        <div className="edit-profile-header-actions">
          {detail && onRequestCut ? (
            <IconActionButton
              label="Tag version"
              title={
                detail.profile.dirty
                  ? "Tag unpublished edits to a new version"
                  : "Tag a new version (fork current state)"
              }
              disabled={controlsDisabled}
              onClick={() =>
                onRequestCut(detail.profile.name, detail.profile.version)
              }
              icon={<Tag size={18} strokeWidth={2} aria-hidden />}
            />
          ) : null}
          <OverflowMenu
            testId="edit-profile-overflow"
            disabled={busy}
            items={editOverflowItems}
          />
          <ProfileDeleteControls
            profileName={profileName}
            baseUrl={baseUrl}
            token={token}
            disabled={disabled || busy}
            variant="menu"
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onDeleted={(result, message) => onDeleted?.(result, message)}
          />
          <IconActionButton
            label="Done editing"
            title="Done"
            disabled={busy}
            onClick={() => {
              requestClose();
            }}
            icon={<X size={18} strokeWidth={2} aria-hidden />}
          />
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {loading && !detail ? <p className="muted">Loading profile...</p> : null}

      {detail ? (
        <div className="edit-profile-body">
          <section className="edit-profile-section" aria-label="Profile identity">
            <div className="form-field gap-1.5">
              <Label htmlFor="edit-profile-name">Name</Label>
              <Input
                id="edit-profile-name"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitName();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setNameDraft(profileName);
                  }
                }}
                disabled={controlsDisabled}
              />
            </div>
            <div className="form-field gap-1.5">
              <Label htmlFor="edit-profile-description">Description</Label>
              <Textarea
                id="edit-profile-description"
                value={descriptionDraft}
                onChange={(event) => onDescriptionChange(event.target.value)}
                onBlur={() => void saveMetaNow()}
                disabled={disabled || loading}
                rows={3}
              />
            </div>
            <div className="form-field gap-1.5">
              <Label htmlFor="edit-profile-tags">Tags</Label>
              <Input
                id="edit-profile-tags"
                value={tagsDraft}
                onChange={(event) => onTagsChange(event.target.value)}
                onBlur={() => void saveMetaNow()}
                disabled={disabled || loading}
                placeholder="Add tags"
              />
            </div>
          </section>

          <PluginCompositionFields
            libraryLoading={libraryLoading}
            libraryError={libraryError}
            resources={compositionMembers}
            resourceFilter={resourceFilter}
            onResourceFilter={setResourceFilter}
            selectedIds={selectedMembershipIds}
            onToggleResource={toggleMembership}
            onInspectResource={(resource) => {
              setInspectTarget({
                selector: resource.id,
                label: resourceDisplayName(resource, collidingPluginNames),
                pathHint: resource.filesystem_path ?? resource.source,
              });
            }}
            disabled={controlsDisabled}
            emptyUnfilteredLabel="Nothing in this profile yet."
            inherited={
              detail.upstream?.kind === "extends"
                ? { items: detail.inherited ?? [], parentName, onToggle: toggleInherited }
                : undefined
            }
            notice={
              detail.upstream?.kind === "extends" && detail.parent_missing ? (
                <div className="banner">{detail.parent_missing}</div>
              ) : null
            }
            footer={
              <ChromeTooltip content="Add to profile">
                <button
                  type="button"
                  className="scope-inventory-fab icon-action primary"
                  data-testid="edit-profile-composition-fab"
                  aria-label="Add to profile"
                  title="Add to profile"
                  disabled={controlsDisabled}
                  onClick={() => setAddModalOpen(true)}
                >
                  <Plus size={20} strokeWidth={2} aria-hidden />
                </button>
              </ChromeTooltip>
            }
          />
          <EditProfileParitySlots
            profileName={profileName}
            baseUrl={baseUrl}
            token={token}
            disabled={disabled || busy}
            onMutated={() => {
              void onMutated({ profileName, affectsApply: true });
            }}
            onCreateEnvironment={onCreateEnvironment}
          />
        </div>
      ) : null}
      <ResourceDetailPane
        open={Boolean(inspectTarget)}
        target={inspectTarget}
        baseUrl={baseUrl}
        token={token}
        disabled={controlsDisabled}
        onClose={() => setInspectTarget(null)}
        onSuccess={onSuccess}
        duplicatePluginNames={collidingPluginNames}
        onLibraryChanged={() => {
          if (!baseUrl) {
            return;
          }
          void Promise.all([
            fetchLibraryPlugins(baseUrl, token),
            fetchLibraryResources(baseUrl, token),
          ])
            .then(([nextPlugins, nextResources]) => {
              setPlugins(nextPlugins);
              setResources(nextResources);
            })
            .catch((loadError: unknown) => {
              setLibraryError(errorMessage(loadError, "Could not load library"));
            });
        }}
      />
      <ScopeAddToProfileModal
        open={addModalOpen}
        disabled={controlsDisabled}
        baseUrl={baseUrl}
        token={token}
        profileKeys={compositionAddExcludeKeys}
        title="Add to profile"
        addErrorFallback="Could not add to profile"
        excludeProfileName={profileName}
        onClose={() => setAddModalOpen(false)}
        onAdd={addLibraryItems}
      />
    </main>
  );
}
