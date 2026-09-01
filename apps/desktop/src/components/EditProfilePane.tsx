import { useEffect, useMemo, useState } from "react";
import { Tag, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AgentApiError,
  addProfilePlugin,
  attachProfileComposition,
  detachProfileComposition,
  fetchLibraryPlugins,
  fetchLibraryResources,
  fetchMarketplacePlugins,
  fetchMarketplaces,
  fetchProfileDetail,
  patchProfileMetadata,
  renameProfile,
} from "../lib/agent-client";
import { resourceDisplayName } from "../lib/resource-search";
import type {
  CatalogPlugin,
  LibraryPlugin,
  LibraryResource,
  PluginMarketplaceEntry,
  ProfileDetail,
} from "../lib/types";
import { EditProfileParitySlots } from "./parity/EditProfileParitySlots";
import { PluginCompositionFields } from "./parity/PluginCompositionFields";
import { ProfileDeleteControls } from "./parity/ProfileDeleteControls";
import { ResourceDetailPane } from "./ResourceDetailPane";

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
  projectPath = null,
  disabled = false,
  onClose,
  onProfileRenamed,
  onMutated,
  onDeleted,
  onCreateEnvironment,
  onSuccess,
  onRequestCut,
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
  const [marketplaces, setMarketplaces] = useState<PluginMarketplaceEntry[]>([]);
  const [marketplaceName, setMarketplaceName] = useState("");
  const [catalogPlugins, setCatalogPlugins] = useState<CatalogPlugin[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [pluginRef, setPluginRef] = useState("");
  const [inspectTarget, setInspectTarget] = useState<{
    selector: string;
    label: string;
    pathHint?: string | null;
  } | null>(null);

  const applyDetail = (next: ProfileDetail) => {
    setDetail(next);
    setNameDraft(next.profile.name);
    setDescriptionDraft(next.profile.description);
    setTagsDraft(
      next.profile.tags.filter((tag) => tag !== "profile").join(", "),
    );
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
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setMarketplaces([]);
          setMarketplaceName("");
          setMarketplaceError(
            errorMessage(loadError, "Could not load marketplaces"),
          );
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
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setCatalogPlugins([]);
          setPluginRef("");
          setMarketplaceError(
            errorMessage(loadError, "Could not load marketplace plugins"),
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
      plugins
        .filter(
          (plugin) =>
            plugin.name !== profileName && !plugin.tags.includes("profile"),
        )
        .map((plugin) => ({
          id: plugin.id,
          name: plugin.name,
          description: plugin.description,
        })),
    [plugins, profileName],
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

  const composeResources = useMemo(
    () => resources.filter((resource) => resource.type !== "plugin"),
    [resources],
  );

  const runMutation = async (
    action: () => Promise<ProfileDetail | void>,
    options: { affectsApply: boolean; nextName?: string },
  ) => {
    if (busy || disabled || !baseUrl) {
      return;
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
    } finally {
      setBusy(false);
    }
  };

  const commitName = () => {
    const nextName = nameDraft.trim();
    if (!nextName || nextName === profileName || !baseUrl) {
      setNameDraft(profileName);
      return;
    }
    void runMutation(
      async () => {
        const result = await renameProfile(baseUrl, token, profileName, nextName);
        onProfileRenamed(result.name);
        return fetchProfileDetail(baseUrl, token, result.name);
      },
      { affectsApply: true, nextName },
    );
  };

  const commitDescription = () => {
    if (!detail || !baseUrl) {
      return;
    }
    if (descriptionDraft === detail.profile.description) {
      return;
    }
    void runMutation(
      () =>
        patchProfileMetadata(baseUrl, token, profileName, {
          description: descriptionDraft,
        }),
      { affectsApply: false },
    );
  };

  const commitTags = () => {
    if (!detail || !baseUrl) {
      return;
    }
    const tags = tagsDraft
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const current = detail.profile.tags.filter((tag) => tag !== "profile");
    if (
      tags.length === current.length
      && tags.every((tag, index) => tag === current[index])
    ) {
      return;
    }
    void runMutation(
      () => patchProfileMetadata(baseUrl, token, profileName, { tags }),
      { affectsApply: false },
    );
  };

  const togglePlugin = (pluginId: string) => {
    if (!baseUrl || !detail) {
      return;
    }
    const selected = selectedPluginIds.includes(pluginId);
    const plugin = plugins.find((entry) => entry.id === pluginId);
    if (!plugin) {
      return;
    }
    void runMutation(
      () =>
        selected
          ? detachProfileComposition(baseUrl, token, profileName, {
              dependencyName: plugin.name,
            })
          : attachProfileComposition(baseUrl, token, profileName, {
              pluginId,
            }),
      { affectsApply: true },
    );
  };

  const addPluginPin = () => {
    const ref = pluginRef.trim();
    if (!baseUrl || !detail || !ref) {
      return;
    }
    void runMutation(
      async () => {
        await addProfilePlugin(baseUrl, token, profileName, {
          ref,
          ...(projectPath ? { projectPath } : {}),
        });
        return fetchProfileDetail(baseUrl, token, profileName);
      },
      { affectsApply: true },
    );
  };

  const toggleResource = (resourceId: string) => {
    if (!baseUrl || !detail) {
      return;
    }
    const selected = selectedResourceIds.includes(resourceId);
    void runMutation(
      () =>
        selected
          ? detachProfileComposition(baseUrl, token, profileName, {
              resourceId,
            })
          : attachProfileComposition(baseUrl, token, profileName, {
              resourceId,
            }),
      { affectsApply: true },
    );
  };

  const controlsDisabled = disabled || busy || loading;
  const pluginControlsDisabled =
    controlsDisabled
    || !token
    || marketplaceLoading
    || pluginsLoading
    || !pluginRef.trim()
    || catalogPlugins.length === 0;

  return (
    <main className="edit-profile-pane" aria-label={`Edit ${profileName}`}>
      <div className="edit-profile-header">
        <div className="edit-profile-title">
          <h2>
            Edit · {profileName}
            {detail?.active ? (
              <span className="badge edit-active-badge">active</span>
            ) : null}
            {detail?.profile.version ? (
              <span className="badge badge-meta">
                v{detail.profile.version}
                {detail.profile.dirty ? "*" : ""}
              </span>
            ) : null}
          </h2>
          <p className="muted">Changes save automatically.</p>
        </div>
        <div className="edit-profile-header-actions">
          {detail && onRequestCut ? (
            <button
              type="button"
              className="icon-action"
              onClick={() =>
                onRequestCut(detail.profile.name, detail.profile.version)
              }
              disabled={controlsDisabled}
              aria-label="Cut version"
              title={
                detail.profile.dirty
                  ? "Cut unpublished edits to a new version"
                  : "Cut a new version (fork current state)"
              }
            >
              <Tag size={18} strokeWidth={2} aria-hidden />
            </button>
          ) : null}
          <ProfileDeleteControls
            profileName={profileName}
            baseUrl={baseUrl}
            token={token}
            disabled={disabled || busy}
            variant="icon"
            onDeleted={(result, message) => onDeleted?.(result, message)}
          />
          <button
          type="button"
          className="icon-action"
          onClick={onClose}
          disabled={busy}
          aria-label="Done editing"
          title="Done"
        >
          <X size={18} strokeWidth={2} aria-hidden />
        </button>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {loading && !detail ? <p className="muted">Loading profile…</p> : null}

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
                }}
                disabled={controlsDisabled}
              />
            </div>
            <div className="form-field gap-1.5">
              <Label htmlFor="edit-profile-description">Description</Label>
              <Textarea
                id="edit-profile-description"
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
                onBlur={commitDescription}
                disabled={controlsDisabled}
                rows={3}
              />
            </div>
            <div className="form-field gap-1.5">
              <Label htmlFor="edit-profile-tags">Tags</Label>
              <Input
                id="edit-profile-tags"
                value={tagsDraft}
                onChange={(event) => setTagsDraft(event.target.value)}
                onBlur={commitTags}
                disabled={controlsDisabled}
                placeholder="comma-separated (profile tag kept automatically)"
              />
            </div>
          </section>

          <PluginCompositionFields
            showMarketplace={true}
            marketplaceLoading={marketplaceLoading}
            marketplaceError={marketplaceError}
            marketplaces={marketplaces}
            marketplaceName={marketplaceName}
            onMarketplaceName={setMarketplaceName}
            catalogPlugins={catalogPlugins}
            pluginsLoading={pluginsLoading}
            pluginRef={pluginRef}
            onPluginRef={setPluginRef}
            onPin={addPluginPin}
            pinDisabled={pluginControlsDisabled}
            marketplaceSelectId="edit-plugin-marketplace"
            pluginSelectId="edit-plugin-ref"
            pluginRefTestId="edit-plugin-ref"
            pinTestId="edit-plugin-add"
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
            onInspectResource={(resource) => {
              setInspectTarget({
                selector: resource.id,
                label: resourceDisplayName(resource),
                pathHint: resource.source,
              });
            }}
            disabled={controlsDisabled}
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
        onLibraryChanged={() => {
          if (!baseUrl) {
            return;
          }
          void fetchLibraryResources(baseUrl, token)
            .then((nextResources) => {
              setResources(nextResources);
            })
            .catch((loadError: unknown) => {
              setLibraryError(errorMessage(loadError, "Could not load library"));
            });
        }}
      />
    </main>
  );
}
