import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchLibraryPlugins,
  fetchLibraryResources,
  fetchMarketplaces,
  fetchMarketplacePlugins,
} from "../../lib/agent-client";
import {
  cutLibraryPlugin,
  deleteLibraryPlugin,
  fetchLibraryPluginDetail,
  fetchLibraryPluginHeads,
  forkLibraryPlugin,
  patchLibraryPluginAttachments,
  runLibraryPluginDoctor,
  type LibraryPluginDetail,
  type LibraryPluginHead,
  type PluginDoctorReport,
} from "../../lib/api/library-plugins";
import { validateCutRows } from "../../lib/cut-versions-form";
import type {
  CatalogPlugin,
  LibraryPlugin,
  LibraryResource,
  PluginMarketplaceEntry,
} from "../../lib/types";
import { ButtonSpinner } from "../ButtonSpinner";
import { ConfirmDialog } from "../ConfirmDialog";
import {
  ResourceSelectionList,
  SelectionList,
} from "../CompositionPickers";

export interface PluginsWorkspaceProps {
  baseUrl: string | null;
  token: string | null;
  selectedProfile: string | null;
  disabled?: boolean;
  onSuccess: (message: string) => void;
  onProfilesChanged: () => void;
}

function matchesFilter(plugin: LibraryPluginHead, query: string): boolean {
  const haystack = [plugin.name, plugin.description ?? "", ...plugin.tags]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function originArticle(origin: LibraryPluginHead["origin"]): string {
  return origin === "catalog" ? "a catalog" : "an upstream";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function PluginsWorkspace({
  baseUrl,
  token,
  selectedProfile: _selectedProfile,
  disabled = false,
  onSuccess,
  onProfilesChanged,
}: PluginsWorkspaceProps) {
  const [plugins, setPlugins] = useState<LibraryPluginHead[]>([]);
  const [filter, setFilter] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listEpoch, setListEpoch] = useState(0);

  const [detail, setDetail] = useState<LibraryPluginDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailEpoch, setDetailEpoch] = useState(0);

  const [libraryPlugins, setLibraryPlugins] = useState<LibraryPlugin[]>([]);
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

  const [busy, setBusy] = useState(false);
  const [doctorReport, setDoctorReport] = useState<PluginDoctorReport | null>(null);
  const [doctorBusy, setDoctorBusy] = useState(false);

  const [cutOpen, setCutOpen] = useState(false);
  const [cutVersion, setCutVersion] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [forkName, setForkName] = useState("");
  const [confirmBusy, setConfirmBusy] = useState(false);

  const controlsDisabled = disabled || busy;

  useEffect(() => {
    if (!baseUrl) {
      setPlugins([]);
      return;
    }
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    void fetchLibraryPluginHeads(baseUrl, token)
      .then((rows) => {
        if (!cancelled) {
          setPlugins(rows);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setListError(errorMessage(error, "Could not load plugins"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setListLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, listEpoch]);

  useEffect(() => {
    if (!baseUrl || !selectedName) {
      setDetail(null);
      setDoctorReport(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    void fetchLibraryPluginDetail(baseUrl, token, selectedName)
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
  }, [baseUrl, token, selectedName, detailEpoch]);

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
  }, [baseUrl, token, listEpoch]);

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

  const visible = useMemo(
    () => plugins.filter((plugin) => matchesFilter(plugin, filter)),
    [plugins, filter],
  );

  const authored = detail?.plugin.origin === "authored";
  const pickersDisabled = controlsDisabled || !authored;

  const pluginRows = useMemo(
    () =>
      libraryPlugins
        .filter((plugin) => plugin.name !== selectedName)
        .map((plugin) => ({
          id: plugin.id,
          name: plugin.name,
          description: plugin.description,
        })),
    [libraryPlugins, selectedName],
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

  const refreshAfterMutation = () => {
    setListEpoch((n) => n + 1);
    setDetailEpoch((n) => n + 1);
  };

  const runPatch = async (
    body: Parameters<typeof patchLibraryPluginAttachments>[3],
  ) => {
    if (!baseUrl || !selectedName || busy || disabled) {
      return;
    }
    setBusy(true);
    setDetailError(null);
    try {
      const next = await patchLibraryPluginAttachments(
        baseUrl,
        token,
        selectedName,
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
    if (!baseUrl || !selectedName || doctorBusy || disabled) {
      return;
    }
    setDoctorBusy(true);
    setDetailError(null);
    try {
      const report = await runLibraryPluginDoctor(baseUrl, token, selectedName);
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
      setSelectedName(null);
      setDetail(null);
      setListEpoch((n) => n + 1);
      if (taggedProfile) {
        onProfilesChanged();
      }
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
      setSelectedName(result.name);
      setListEpoch((n) => n + 1);
      setDetailEpoch((n) => n + 1);
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

  return (
    <main className="resources-panel" aria-label="Plugins">
      <div className="resources-panel-layout">
        <aside className="profiles-rail" aria-label="Plugin list">
          <div className="profiles-filter-row">
            <input
              className="profiles-filter"
              type="search"
              placeholder="Filter plugins…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              disabled={controlsDisabled || plugins.length === 0}
              aria-label="Filter plugins by name, description, or tags"
            />
          </div>
          <div className="profiles-list">
            {listError ? (
              <div className="empty-state">
                <p>{listError}</p>
              </div>
            ) : listLoading ? (
              <p className="muted">Loading plugins…</p>
            ) : plugins.length === 0 ? (
              <div className="empty-state">
                <p className="muted">No plugins in the local library.</p>
                <p className="muted">
                  Create via CLI <span className="mono">ht plugin create</span>{" "}
                  or fork an upstream plugin.
                </p>
              </div>
            ) : visible.length === 0 ? (
              <div className="empty-state">
                <p className="muted">No plugins match “{filter}”.</p>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setFilter("")}
                >
                  Clear filter
                </button>
              </div>
            ) : (
              visible.map((plugin) => {
                const selected = selectedName === plugin.name;
                return (
                  <button
                    key={plugin.id}
                    type="button"
                    className={`profile-row${selected ? " selected" : ""}`}
                    data-testid={`plugin-rail-${plugin.name}`}
                    disabled={controlsDisabled}
                    onClick={() =>
                      setSelectedName(selected ? null : plugin.name)
                    }
                  >
                    <span className="profile-row-name">{plugin.name}</span>
                    <span className="muted mono">
                      {plugin.version}
                      {plugin.dirty ? "*" : ""}
                    </span>
                    {plugin.tags.includes("profile") ? (
                      <span className="badge">profile</span>
                    ) : null}
                    {plugin.origin !== "authored" ? (
                      <span className="badge badge-meta">{plugin.origin}</span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </aside>
        <div className="resources-panel-body">
          {!selectedName ? (
            <p className="muted">Select a plugin to inspect.</p>
          ) : detailLoading && !detail ? (
            <p className="muted">Loading plugin…</p>
          ) : detailError && !detail ? (
            <div className="banner error">{detailError}</div>
          ) : detail ? (
            <div className="edit-profile-body">
              {detailError ? <div className="banner error">{detailError}</div> : null}
              {!authored ? (
                <div className="banner">
                  {detail.plugin.name} is {originArticle(detail.plugin.origin)}{" "}
                  plugin and cannot be edited directly.
                </div>
              ) : null}
              <div className="edit-profile-header">
                <div className="edit-profile-title">
                  <h2>
                    {detail.plugin.name}@{detail.plugin.version}
                    {detail.plugin.dirty ? "*" : ""}
                  </h2>
                  <p className="muted">{detail.plugin.origin}</p>
                  {detail.plugin.description ? (
                    <p>{detail.plugin.description}</p>
                  ) : null}
                </div>
                <div className="edit-profile-header-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled
                    title="Apply is provided by the apply-plugin slice"
                  >
                    Apply
                  </button>
                  {authored ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={controlsDisabled}
                      onClick={() => {
                        setCutVersion("");
                        setCutOpen(true);
                      }}
                    >
                      Cut version
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={controlsDisabled}
                      onClick={() => {
                        setForkName(`${detail.plugin.name}-fork`);
                        setForkOpen(true);
                      }}
                    >
                      Fork
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    disabled={controlsDisabled}
                    onClick={() => setDeleteOpen(true)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="form-field">
                <Label>Default environment</Label>
                <Select disabled>
                  <SelectTrigger>
                    <SelectValue placeholder="Default environment" />
                  </SelectTrigger>
                </Select>
              </div>

              {authored ? (
                <section className="edit-profile-section" aria-label="Marketplace plugins">
                  <h3>Marketplace plugins</h3>
                  {marketplaceLoading ? (
                    <p className="muted">Loading marketplaces…</p>
                  ) : marketplaceError ? (
                    <div className="banner error">{marketplaceError}</div>
                  ) : marketplaces.length === 0 ? (
                    <p className="muted">
                      No marketplaces registered. Add one in Settings.
                    </p>
                  ) : (
                    <div className="edit-plugin-pin">
                      {marketplaces.length > 1 ? (
                        <div className="form-field gap-1.5">
                          <Label htmlFor="plugin-marketplace">Marketplace</Label>
                          <Select
                            value={marketplaceName}
                            onValueChange={setMarketplaceName}
                            disabled={pickersDisabled || pluginsLoading}
                          >
                            <SelectTrigger
                              id="plugin-marketplace"
                              className="w-full"
                            >
                              <SelectValue placeholder="Select a marketplace…" />
                            </SelectTrigger>
                            <SelectContent>
                              {marketplaces.map((entry) => (
                                <SelectItem key={entry.name} value={entry.name}>
                                  {entry.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}
                      <div className="form-field gap-1.5">
                        <Label htmlFor="plugin-ref">Plugin</Label>
                        {pluginsLoading ? (
                          <p className="muted">Loading plugins…</p>
                        ) : catalogPlugins.length === 0 ? (
                          <p className="muted">No plugins in this marketplace.</p>
                        ) : (
                          <Select
                            value={pluginRef}
                            onValueChange={setPluginRef}
                            disabled={pickersDisabled}
                          >
                            <SelectTrigger
                              id="plugin-ref"
                              className="w-full"
                            >
                              <SelectValue placeholder="Select a plugin…" />
                            </SelectTrigger>
                            <SelectContent>
                              {catalogPlugins.map((plugin) => (
                                <SelectItem key={plugin.ref} value={plugin.ref}>
                                  {plugin.name}
                                  {plugin.version ? ` @ ${plugin.version}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={pinMarketplacePlugin}
                        disabled={pluginControlsDisabled}
                      >
                        {busy ? <ButtonSpinner size={14} /> : null}
                        Pin plugin
                      </button>
                    </div>
                  )}
                </section>
              ) : null}

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
                        title="Plugins"
                        emptyLabel="No plugins available."
                        rows={pluginRows}
                        selectedIds={selectedPluginIds}
                        disabled={pickersDisabled}
                        onToggle={togglePlugin}
                      />
                      <ResourceSelectionList
                        resources={composeResources}
                        filter={resourceFilter}
                        onFilterChange={setResourceFilter}
                        selectedIds={selectedResourceIds}
                        disabled={pickersDisabled}
                        onToggle={toggleResource}
                      />
                    </>
                  )}
                </div>
              </section>

              <section className="edit-profile-section" aria-label="Doctor">
                <h3>Doctor</h3>
                <button
                  type="button"
                  className="btn"
                  disabled={controlsDisabled || doctorBusy}
                  onClick={() => {
                    void runDoctor();
                  }}
                >
                  {doctorBusy ? <ButtonSpinner size={14} /> : null}
                  Run doctor
                </button>
                {doctorReport ? (
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
                ) : null}
              </section>
            </div>
          ) : (
            <p className="muted">Detail for {selectedName}</p>
          )}
        </div>
      </div>

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
    </main>
  );
}
