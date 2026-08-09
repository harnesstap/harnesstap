import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AgentApiError,
  attachProfileComposition,
  detachProfileComposition,
  fetchLibraryLayers,
  fetchLibraryResources,
  fetchProfileDetail,
  patchProfileMetadata,
  renameProfile,
} from "../lib/agent-client";
import type {
  LibraryLayer,
  LibraryResource,
  ProfileDetail,
} from "../lib/types";
import {
  ResourceSelectionList,
  SelectionList,
} from "./CompositionPickers";

export interface EditProfilePaneProps {
  profileName: string;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onClose: () => void;
  onProfileRenamed: (nextName: string) => void;
  onMutated: (input: {
    profileName: string;
    affectsApply: boolean;
  }) => void | Promise<void>;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof AgentApiError && error.code === "layer_exists") {
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
}: EditProfilePaneProps) {
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(profileName);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [layers, setLayers] = useState<LibraryLayer[]>([]);
  const [resources, setResources] = useState<LibraryResource[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [resourceFilter, setResourceFilter] = useState("");

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
      fetchLibraryLayers(baseUrl, token),
      fetchLibraryResources(baseUrl, token),
    ])
      .then(([nextLayers, nextResources]) => {
        if (!cancelled) {
          setLayers(nextLayers);
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

  const layerRows = useMemo(
    () =>
      layers
        .filter(
          (layer) =>
            layer.name !== profileName && !layer.tags.includes("profile"),
        )
        .map((layer) => ({
          id: layer.id,
          name: layer.name,
          description: layer.description,
        })),
    [layers, profileName],
  );

  const selectedLayerIds = useMemo(() => {
    if (!detail) {
      return [];
    }
    const byName = new Map(layers.map((layer) => [layer.name, layer.id]));
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
  }, [detail, layers]);

  const selectedResourceIds = useMemo(
    () => detail?.resources.map((resource) => resource.id) ?? [],
    [detail],
  );

  const composeResources = useMemo(
    () => resources.filter((resource) => resource.type !== "layer"),
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

  const toggleLayer = (layerId: string) => {
    if (!baseUrl || !detail) {
      return;
    }
    const selected = selectedLayerIds.includes(layerId);
    const layer = layers.find((entry) => entry.id === layerId);
    if (!layer) {
      return;
    }
    void runMutation(
      () =>
        selected
          ? detachProfileComposition(baseUrl, token, profileName, {
              dependencyName: layer.name,
            })
          : attachProfileComposition(baseUrl, token, profileName, {
              layerId,
            }),
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

  return (
    <main className="edit-profile-pane" aria-label={`Edit ${profileName}`}>
      <div className="edit-profile-header">
        <div className="edit-profile-title">
          <h2>
            Edit · {profileName}
            {detail?.active ? (
              <span className="badge edit-active-badge">active</span>
            ) : null}
          </h2>
          <p className="muted">Changes save automatically.</p>
        </div>
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

      {error ? <div className="banner error">{error}</div> : null}
      {loading && !detail ? <p className="muted">Loading profile…</p> : null}

      {detail ? (
        <div className="edit-profile-body">
          <details className="edit-metadata-details">
            <summary>Metadata</summary>
            <div className="edit-metadata-body">
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
            </div>
          </details>

          <section className="edit-profile-section" aria-label="Composition">
            <h3>Composition</h3>
            <div className="compose-library">
              {libraryLoading ? (
                <p className="muted">Loading local library…</p>
              ) : libraryError ? (
                <div className="banner error">{libraryError}</div>
              ) : (
                <>
                  <SelectionList
                    title="Layers"
                    emptyLabel="No layers available."
                    rows={layerRows}
                    selectedIds={selectedLayerIds}
                    disabled={controlsDisabled}
                    onToggle={toggleLayer}
                  />
                  <ResourceSelectionList
                    resources={composeResources}
                    filter={resourceFilter}
                    onFilterChange={setResourceFilter}
                    selectedIds={selectedResourceIds}
                    disabled={controlsDisabled}
                    onToggle={toggleResource}
                  />
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
