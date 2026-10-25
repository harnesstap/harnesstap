import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Eye, EyeOff, FilterX, Pencil, Plus, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "../ConfirmDialog";
import { EmptyState } from "../EmptyState";
import { IconActionButton } from "../IconActionButton";
import { LoadErrorState } from "../LoadErrorState";
import { WorkspaceBackButton } from "../WorkspaceBackButton";
import { WorkspaceRefreshButton } from "../WorkspaceRefreshButton";
import {
  deleteEnvironment,
  environmentApplyAvailable,
  environmentDeleteNeedsForce,
  fetchEnvironment,
  filterEnvironmentsByQuery,
  formatEnvironmentClipboard,
  isSecretLikeEnvKey,
  listEnvironments,
  useEnvironmentGlobally,
  type EnvironmentListRow,
  type EnvironmentShowPayload,
} from "../../lib/api/environments";
import { toast } from "../../state/toast-store";
import { useRegisterCommands } from "../../state/command-registry";
import { CLEAR_FILTER_LABEL, noResultsTitle } from "../../lib/empty-copy";
import { noSpellcheckProps } from "../../lib/no-spellcheck";
import { ENVIRONMENTS_EMPTY_COPY } from "../../lib/ui-copy";
import { EnvironmentDrawer } from "./EnvironmentDrawer";

const ACTION_ICON_SIZE = 16;
const LIST_SKELETON_COUNT = 6;

export interface EnvironmentsWorkspaceProps {
  baseUrl: string | null;
  token: string | null;
  connected?: boolean;
  switching?: boolean;
  projectPath: string | null;
  disabled?: boolean;
  /** Bump while mounted to clear the name filter and deselect (header re-click). */
  homeResetNonce?: number;
  autoOpenCreate?: boolean;
  onAutoOpenCreateConsumed?: () => void;
  onSuccess: (message: string) => void;
  onOpenPlugin?: (pluginName: string) => void;
  canWorkspaceBack?: boolean;
  onWorkspaceBack?: () => void;
  disconnected?: boolean;
}

export function EnvironmentsWorkspace({
  baseUrl,
  token,
  connected: connectedProp,
  switching: switchingProp,
  projectPath,
  disabled = false,
  homeResetNonce = 0,
  autoOpenCreate = false,
  onAutoOpenCreateConsumed,
  onSuccess,
  onOpenPlugin,
  canWorkspaceBack: _canWorkspaceBack = false,
  onWorkspaceBack,
  disconnected = false,
}: EnvironmentsWorkspaceProps) {
  const connected = connectedProp ?? Boolean(baseUrl && token);
  const switching = switchingProp ?? disabled;
  const controlsDisabled = switching || !connected || disabled;

  const [rows, setRows] = useState<EnvironmentListRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const listLoadedRef = useRef(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Set when the list itself failed to load; replaces the empty state. */
  const [listError, setListError] = useState<string | null>(null);
  const [inspectedName, setInspectedName] = useState<string | null>(null);
  const homeResetNonceSeen = useRef(homeResetNonce);

  useEffect(() => {
    if (homeResetNonceSeen.current === homeResetNonce) {
      return;
    }
    homeResetNonceSeen.current = homeResetNonce;
    setQuery("");
    setInspectedName(null);
  }, [homeResetNonce]);

  useEffect(() => {
    if (!autoOpenCreate) {
      return;
    }
    setDrawerMode("create");
    setEditName(undefined);
    setDrawerOpen(true);
    onAutoOpenCreateConsumed?.();
  }, [autoOpenCreate, onAutoOpenCreateConsumed]);
  const [detail, setDetail] = useState<EnvironmentShowPayload | null>(null);
  const [detailRefreshing, setDetailRefreshing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create");
  const [editName, setEditName] = useState<string | undefined>(undefined);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<EnvironmentListRow[]>([]);
  const [forceChecked, setForceChecked] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useRegisterCommands(
    "environments",
    useMemo(
      () => [
        {
          id: "environments-create",
          section: "actions" as const,
          label: "Create environment",
          disabled: controlsDisabled || !baseUrl,
          run: () => {
            setDrawerMode("create");
            setEditName(undefined);
            setDrawerOpen(true);
          },
        },
      ],
      [baseUrl, controlsDisabled],
    ),
  );

  const refresh = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!baseUrl) {
      setRows([]);
      setListLoading(false);
      listLoadedRef.current = false;
      return;
    }
    let cancelled = false;
    if (!listLoadedRef.current) {
      setListLoading(true);
    }
    void listEnvironments(baseUrl, token)
      .then((nextRows) => {
        if (cancelled) {
          return;
        }
        setRows(nextRows);
        listLoadedRef.current = true;
        setListError(null);
        setInspectedName((current) => {
          if (current !== null) {
            return current;
          }
          return nextRows.length === 1 ? nextRows[0]!.name : current;
        });
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setListError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load environments",
          );
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
  }, [baseUrl, token, reloadKey]);

  useEffect(() => {
    if (!baseUrl || !inspectedName) {
      setDetail(null);
      setDetailRefreshing(false);
      return;
    }
    let cancelled = false;
    setDetail((current) => (current?.environment.name === inspectedName ? current : null));
    setDetailRefreshing(true);
    void fetchEnvironment(baseUrl, token, inspectedName)
      .then((next) => {
        if (!cancelled) {
          setDetail(next);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load environment",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailRefreshing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, inspectedName, reloadKey]);

  const filtered = useMemo(
    () => filterEnvironmentsByQuery(rows, query),
    [query, rows],
  );
  const needsForce = deleteTargets.some((row) => environmentDeleteNeedsForce(row));
  const deleteNames = deleteTargets.map((row) => row.name);
  const referencedNames = detail?.references.plugins.map((plugin) => plugin.name) ?? [];
  const showListSkeleton = listLoading && rows.length === 0;
  const listFailed = listError !== null && !listLoadedRef.current && !listLoading;
  const listEmpty = !listFailed && !showListSkeleton && rows.length === 0;
  const showDetailSkeleton = Boolean(inspectedName) && (!detail || detail.environment.name !== inspectedName);
  const openCreate = () => {
    setDrawerMode("create");
    setEditName(undefined);
    setDrawerOpen(true);
  };

  const inspectEnvironment = (name: string) => {
    if (name === inspectedName) {
      return;
    }
    setInspectedName(name);
    setDetail(null);
    setDetailRefreshing(true);
  };

  const onUse = async (name: string) => {
    if (!baseUrl || controlsDisabled) {
      return;
    }
    setBusyName(name);
    try {
      await useEnvironmentGlobally(baseUrl, token, name);
      onSuccess(`Set global environment ${name}`);
      refresh();
    } catch (useError: unknown) {
      setError(useError instanceof Error ? useError.message : "Could not use environment");
    } finally {
      setBusyName(null);
    }
  };

  const onConfirmDelete = async () => {
    if (!baseUrl || deleteTargets.length === 0) {
      return;
    }
    setDeleteBusy(true);
    try {
      const names = deleteTargets.map((row) => row.name);
      for (const row of deleteTargets) {
        await deleteEnvironment(baseUrl, token, row.name, needsForce);
      }
      onSuccess(
        names.length === 1
          ? `Deleted environment ${names[0]}`
          : `Deleted ${names.length} environments`,
      );
      if (inspectedName && names.includes(inspectedName)) {
        setInspectedName(null);
      }
      setDeleteTargets([]);
      setForceChecked(false);
      refresh();
    } catch (deleteError: unknown) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Could not delete environment",
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <main
      className={["resources-panel", disconnected ? "is-disconnected" : ""]
        .filter(Boolean)
        .join(" ")}
      aria-label="Environments"
    >
      <div className="resources-panel-header">
        <div className="resources-panel-header-row">
          <div className="resources-panel-title-cluster">
            <WorkspaceBackButton
              hidden
              disabled={controlsDisabled}
              onClick={onWorkspaceBack}
            />
            <div className="resources-panel-title">
              <span>Environments</span>
              <span className="muted resources-panel-scope">
                Reusable env vars, secrets, models, and permissions
              </span>
            </div>
          </div>
          <div className="resources-panel-header-actions">
            <WorkspaceRefreshButton
              testId="environments-refresh"
              label="Refresh environments"
              disabled={controlsDisabled || !baseUrl}
              onRefresh={() => {
                refresh();
              }}
            />
            {listFailed ? null : (
              <IconActionButton
                label="Create environment"
                primary
                data-testid="create-environment"
                disabled={controlsDisabled || !baseUrl}
                onClick={openCreate}
                icon={<Plus size={ACTION_ICON_SIZE} aria-hidden />}
              />
            )}
          </div>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      {listFailed ? (
        <div className="resources-panel-body">
          <LoadErrorState
            noun="environments"
            testId="environments-load-error"
            retryDisabled={controlsDisabled || !baseUrl}
            onRetry={refresh}
          />
        </div>
      ) : listEmpty ? (
        <div className="resources-panel-body">
          <EmptyState
            testId="environments-empty"
            title={ENVIRONMENTS_EMPTY_COPY.title}
            body={ENVIRONMENTS_EMPTY_COPY.body}
            action={{
              label: ENVIRONMENTS_EMPTY_COPY.action,
              primary: true,
              disabled: controlsDisabled || !baseUrl,
              onClick: openCreate,
              icon: <Plus size={ACTION_ICON_SIZE} aria-hidden />,
            }}
          />
        </div>
      ) : (
      <div className="resources-panel-layout">
        <aside
          className="resource-filter-sidebar environment-list-sidebar"
          aria-label="Environment list"
        >
          <div className="resource-filter-section">
            <div className="resource-filter-search-row">
              <input
                className="resources-panel-filter"
                type="search"
                placeholder="Filter by name or description"
                aria-label="Filter environments"
                value={query}
                data-workspace-filter=""
                onChange={(event) => setQuery(event.target.value)}
                disabled={controlsDisabled}
                {...noSpellcheckProps}
              />
            </div>
          </div>
          <div className="environment-list-scroll">
            {showListSkeleton ? (
              <ul className="resources-list" aria-busy="true" aria-label="Loading environments">
                {Array.from({ length: LIST_SKELETON_COUNT }, (_, index) => (
                  <li className="resources-list-item" key={`env-skel-${index}`}>
                    <SkeletonRow />
                  </li>
                ))}
              </ul>
            ) : filtered.length === 0 ? (
              <EmptyState
                variant="no-match"
                title={noResultsTitle(query)}
                body="Clear the filter to see every environment."
                action={{
                  label: CLEAR_FILTER_LABEL,
                  onClick: () => setQuery(""),
                  icon: <FilterX size={ACTION_ICON_SIZE} aria-hidden />,
                }}
              />
            ) : (
              <ul className="resources-list">
                {filtered.map((row) => {
                  const inspected = inspectedName === row.name;
                  return (
                    <li className="resources-list-item" key={row.id}>
                      <div className="environment-list-row">
                        <button
                          type="button"
                          className={[
                            "resources-list-env",
                            inspected ? "is-current" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          disabled={controlsDisabled}
                          aria-current={inspected ? "true" : undefined}
                          data-testid="environment-row"
                          onClick={() => inspectEnvironment(row.name)}
                        >
                          <span className="resources-list-name">
                            {row.name}
                            {row.is_global_active ? (
                              <span className="badge">active</span>
                            ) : null}
                          </span>
                          {row.description ? (
                            <span className="resources-list-desc muted">
                              {row.description}
                            </span>
                          ) : null}
                          <span className="resources-list-desc muted">
                            {row.value_count} values · {row.secret_ref_count} secrets
                          </span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
        <div className="resources-panel-body">
          {showDetailSkeleton ? (
            <div className="environment-detail-skeleton" aria-busy="true" aria-label="Loading environment">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : detail ? (
            <EnvironmentDetail
              payload={detail}
              busy={busyName === detail.environment.name}
              refreshing={detailRefreshing}
              controlsDisabled={controlsDisabled}
              onApply={() => void onUse(detail.environment.name)}
              onEdit={() => {
                setDrawerMode("edit");
                setEditName(detail.environment.name);
                setDrawerOpen(true);
              }}
              onDelete={() => {
                const row = rows.find((item) => item.name === detail.environment.name);
                if (!row) {
                  return;
                }
                setDeleteTargets([row]);
                setForceChecked(false);
              }}
              onOpenPlugin={onOpenPlugin}
            />
          ) : (
            <p className="muted">Click an environment to inspect it.</p>
          )}
        </div>
      </div>
      )}

      <EnvironmentDrawer
        open={drawerOpen}
        mode={drawerMode}
        environmentName={editName}
        baseUrl={baseUrl}
        token={token}
        projectPath={projectPath}
        disabled={controlsDisabled}
        onClose={() => setDrawerOpen(false)}
        onSaved={(message, name) => {
          onSuccess(message);
          setInspectedName(name);
          setDetail(null);
          setDetailRefreshing(true);
          refresh();
        }}
      />

      <ConfirmDialog
        open={deleteTargets.length > 0}
        title={`Delete "${deleteNames[0] ?? ""}"?`}
        description={
          needsForce
            ? `It is the default environment for ${referencedNames.join(", ") || "some profiles"}. Deleting it clears those defaults and its stored values. This can't be undone.`
            : "Its stored values are deleted too. This can't be undone."
        }
        tone="destructive"
        confirmLabel={deleteBusy ? "Deleting..." : "Delete environment"}
        confirmDisabled={needsForce && !forceChecked}
        confirmBusy={deleteBusy}
        onConfirm={() => void onConfirmDelete()}
        onCancel={() => {
          if (!deleteBusy) {
            setDeleteTargets([]);
            setForceChecked(false);
          }
        }}
      >
        {needsForce ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="env-delete-force"
              checked={forceChecked}
              onCheckedChange={(value) => setForceChecked(value === true)}
            />
            <Label htmlFor="env-delete-force" className="font-normal text-muted-foreground">
              Delete even though profiles use this environment
            </Label>
          </div>
        ) : null}
      </ConfirmDialog>
    </main>
  );
}

function SkeletonRow() {
  return (
    <div className="environment-skeleton-row">
      <div className="m-skeleton environment-skeleton-line" />
      <div className="m-skeleton environment-skeleton-line is-short" />
    </div>
  );
}

function EnvironmentInventoryBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="harness-block">
      <h3 className="harness-header">{title}</h3>
      <div className="harness-body">{children}</div>
    </section>
  );
}

function EnvironmentDetail({
  payload,
  busy,
  refreshing,
  controlsDisabled,
  onApply,
  onEdit,
  onDelete,
  onOpenPlugin,
}: {
  payload: EnvironmentShowPayload;
  busy: boolean;
  refreshing: boolean;
  controlsDisabled: boolean;
  onApply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenPlugin?: (pluginName: string) => void;
}) {
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setRevealedKeys({});
  }, [payload.environment.name]);
  const envVars = Object.entries(payload.values.env_vars);
  const secrets = Object.entries(payload.secret_refs);
  const models = payload.values.model_configs;
  const permissions = payload.values.permissions;
  const plugins = payload.references.plugins;
  const showApply = environmentApplyAvailable(payload);
  const hasInventory =
    envVars.length > 0
    || secrets.length > 0
    || models.length > 0
    || permissions.length > 0;
  const empty = !hasInventory;
  const clipboard = formatEnvironmentClipboard(payload);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(clipboard);
      toast({ tone: "success", title: "Copied environment values" });
    } catch {
      toast({ tone: "error", title: "Could not copy environment values" });
    }
  };

  const toggleReveal = (key: string) => {
    setRevealedKeys((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div
      className={["edit-profile-body", "environment-detail", refreshing ? "is-refreshing" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="edit-profile-header">
        <div className="edit-profile-title">
          <h2>{payload.environment.name}</h2>
          {payload.environment.description ? (
            <p className="muted">{payload.environment.description}</p>
          ) : null}
        </div>
        <div className="edit-profile-header-actions">
          {showApply ? (
            <IconActionButton
              data-testid="apply-environment"
              busy={busy}
              disabled={controlsDisabled}
              label={`Apply ${payload.environment.name} globally`}
              title="Detected values differ from this environment"
              onClick={onApply}
              icon={<Check size={ACTION_ICON_SIZE} aria-hidden />}
            />
          ) : null}
          <IconActionButton
            disabled={controlsDisabled || clipboard.length === 0}
            label="Copy all"
            title="Copy all"
            onClick={() => void copyAll()}
            icon={<Copy size={ACTION_ICON_SIZE} aria-hidden />}
          />
          <IconActionButton
            disabled={controlsDisabled}
            label={`Edit ${payload.environment.name}`}
            title="Edit environment"
            onClick={onEdit}
            icon={<Pencil size={ACTION_ICON_SIZE} aria-hidden />}
          />
          <IconActionButton
            disabled={controlsDisabled}
            label={`Delete ${payload.environment.name}`}
            title="Delete environment"
            onClick={onDelete}
            icon={<Trash2 size={ACTION_ICON_SIZE} aria-hidden />}
          />
        </div>
      </div>
      {empty ? (
        <p className="muted">No values or secrets yet.</p>
      ) : (
        <dl className="resource-detail-kv">
          {envVars.length > 0 ? (
            <div>
              <dt>Env vars</dt>
              <dd>
                <ul className="environment-kv-list">
                  {envVars.map(([key, value]) => {
                    const secretLike = isSecretLikeEnvKey(key);
                    const revealed = revealedKeys[key] === true;
                    const display = secretLike && !revealed ? "••••" : value;
                    return (
                      <li key={key} className="environment-kv-row">
                        <code>{key}</code>={display}
                        {secretLike ? (
                          <IconActionButton
                            label={revealed ? `Hide ${key}` : `Show ${key}`}
                            onClick={() => toggleReveal(key)}
                            icon={
                              revealed
                                ? <EyeOff size={ACTION_ICON_SIZE} aria-hidden />
                                : <Eye size={ACTION_ICON_SIZE} aria-hidden />
                            }
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </dd>
            </div>
          ) : null}
          {secrets.length > 0 ? (
            <div>
              <dt>Secret refs</dt>
              <dd>
                <ul className="environment-kv-list">
                  {secrets.map(([key, secret]) => (
                    <li key={key}>
                      <code>{key}</code> {secret.provider} {secret.ref}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          {models.length > 0 ? (
            <div>
              <dt>Model configs</dt>
              <dd>
                <ul className="environment-kv-list">
                  {models.map((model) => (
                    <li key={model.name}>
                      {model.name}: {model.model}
                      {model.provider ? ` (${model.provider})` : ""}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          {permissions.length > 0 ? (
            <div>
              <dt>Permissions</dt>
              <dd>
                <ul className="environment-kv-list">
                  {permissions.map((permission) => (
                    <li key={`${permission.action}:${permission.pattern}`}>
                      {permission.action}:{permission.pattern}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>
      )}
      <EnvironmentInventoryBlock title="Used by profiles">
        {plugins.length > 0 ? (
          <ul className="environment-profile-pills" aria-label="Used by profiles">
            {plugins.map((plugin) => (
              <li key={plugin.id}>
                {onOpenPlugin ? (
                  <button
                    type="button"
                    className="inventory-chip environment-profile-pill"
                    title={`Open ${plugin.name}`}
                    onClick={() => onOpenPlugin(plugin.name)}
                  >
                    {plugin.name}
                  </button>
                ) : (
                  <span className="inventory-chip environment-profile-pill">{plugin.name}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No profiles use this environment yet.</p>
        )}
      </EnvironmentInventoryBlock>
    </div>
  );
}
