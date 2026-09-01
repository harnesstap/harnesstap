import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, FilterX, Pencil, Plus, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "../ConfirmDialog";
import { ButtonSpinner } from "../ButtonSpinner";
import { WorkspaceBackButton } from "../WorkspaceBackButton";
import {
  deleteEnvironment,
  environmentApplyAvailable,
  environmentDeleteNeedsForce,
  fetchEnvironment,
  filterEnvironmentsByQuery,
  listEnvironments,
  useEnvironmentGlobally,
  type EnvironmentListRow,
  type EnvironmentShowPayload,
} from "../../lib/api/environments";
import { EnvironmentDrawer } from "./EnvironmentDrawer";

const ACTION_ICON_SIZE = 16;

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
  canWorkspaceBack = false,
  onWorkspaceBack,
}: EnvironmentsWorkspaceProps) {
  const connected = connectedProp ?? Boolean(baseUrl && token);
  const switching = switchingProp ?? disabled;
  const controlsDisabled = switching || !connected || disabled;

  const [rows, setRows] = useState<EnvironmentListRow[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const homeResetNonceSeen = useRef(homeResetNonce);

  useEffect(() => {
    if (homeResetNonceSeen.current === homeResetNonce) {
      return;
    }
    homeResetNonceSeen.current = homeResetNonce;
    setQuery("");
    setSelectedName(null);
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create");
  const [editName, setEditName] = useState<string | undefined>(undefined);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnvironmentListRow | null>(null);
  const [forceChecked, setForceChecked] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => {
    setReloadKey((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!baseUrl) {
      setRows([]);
      return;
    }
    let cancelled = false;
    void listEnvironments(baseUrl, token)
      .then((nextRows) => {
        if (cancelled) {
          return;
        }
        setRows(nextRows);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load environments",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, reloadKey]);

  useEffect(() => {
    if (!baseUrl || !selectedName) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void fetchEnvironment(baseUrl, token, selectedName)
      .then((next) => {
        if (!cancelled) {
          setDetail(next);
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
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, selectedName, reloadKey]);

  const filtered = useMemo(
    () => filterEnvironmentsByQuery(rows, query),
    [query, rows],
  );
  const needsForce = deleteTarget ? environmentDeleteNeedsForce(deleteTarget) : false;
  const referencedNames = detail?.references.plugins.map((plugin) => plugin.name) ?? [];

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
    if (!baseUrl || !deleteTarget) {
      return;
    }
    setDeleteBusy(true);
    try {
      await deleteEnvironment(baseUrl, token, deleteTarget.name, needsForce);
      onSuccess(`Deleted environment ${deleteTarget.name}`);
      if (selectedName === deleteTarget.name) {
        setSelectedName(null);
      }
      setDeleteTarget(null);
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
    <main className="resources-panel" aria-label="Environments">
      <div className="resources-panel-header">
        <div className="resources-panel-header-row">
          <div className="resources-panel-title-cluster">
            <WorkspaceBackButton
              disabled={controlsDisabled || !canWorkspaceBack}
              onClick={onWorkspaceBack}
            />
            <div className="resources-panel-title">
              <span>Environments</span>
              <span className="muted resources-panel-scope">
                Reusable env vars, secrets, models, and permissions
              </span>
            </div>
          </div>
          <button
            type="button"
            className="icon-action"
            aria-label="Create environment"
            title="Create environment"
            disabled={controlsDisabled || !baseUrl}
            onClick={() => {
              setDrawerMode("create");
              setEditName(undefined);
              setDrawerOpen(true);
            }}
          >
            <Plus size={ACTION_ICON_SIZE} aria-hidden />
          </button>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

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
                placeholder="Filter environments"
                aria-label="Filter environments"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={controlsDisabled}
              />
              <button
                type="button"
                className="icon-action resource-filter-clear"
                aria-label="Clear filter"
                title="Clear filter"
                disabled={controlsDisabled || query.trim() === ""}
                onClick={() => setQuery("")}
              >
                <FilterX size={ACTION_ICON_SIZE} aria-hidden />
              </button>
            </div>
          </div>
          <div className="environment-list-scroll">
            {filtered.length === 0 ? (
              <p className="muted">
                {rows.length === 0
                  ? "No environments yet."
                  : "No matches."}
              </p>
            ) : (
              <ul className="resources-list">
                {filtered.map((row) => {
                  const selected = selectedName === row.name;
                  return (
                    <li className="resources-list-item" key={row.id}>
                      <button
                        type="button"
                        className={[
                          "resources-list-env",
                          selected ? "is-selected" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        disabled={controlsDisabled}
                        aria-current={selected ? "true" : undefined}
                        onClick={() => setSelectedName(row.name)}
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
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
        <div className="resources-panel-body">
          {detail ? (
            <EnvironmentDetail
              payload={detail}
              busy={busyName === detail.environment.name}
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
                setDeleteTarget(row);
                setForceChecked(false);
              }}
              onOpenPlugin={onOpenPlugin}
            />
          ) : (
            <p className="muted">Select an environment to inspect it.</p>
          )}
        </div>
      </div>

      <EnvironmentDrawer
        open={drawerOpen}
        mode={drawerMode}
        environmentName={editName}
        baseUrl={baseUrl}
        token={token}
        projectPath={projectPath}
        disabled={controlsDisabled}
        onClose={() => setDrawerOpen(false)}
        onSaved={(message) => {
          onSuccess(message);
          refresh();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete environment?"
        description={
          needsForce
            ? `${deleteTarget?.name} is still the default environment for these plugins: ${referencedNames.join(", ") || "configured plugins"}. Deleting it will clear those defaults.`
            : `This removes ${deleteTarget?.name} and its stored values. This cannot be undone.`
        }
        confirmLabel={deleteBusy ? "Deleting…" : "Delete"}
        confirmDisabled={needsForce && !forceChecked}
        confirmBusy={deleteBusy}
        onConfirm={() => void onConfirmDelete()}
        onCancel={() => {
          if (!deleteBusy) {
            setDeleteTarget(null);
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
              Delete even though plugins reference this environment
            </Label>
          </div>
        ) : null}
      </ConfirmDialog>
    </main>
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
  controlsDisabled,
  onApply,
  onEdit,
  onDelete,
  onOpenPlugin,
}: {
  payload: EnvironmentShowPayload;
  busy: boolean;
  controlsDisabled: boolean;
  onApply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenPlugin?: (pluginName: string) => void;
}) {
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
  const empty = !hasInventory && plugins.length === 0;

  return (
    <div className="edit-profile-body">
      <div className="edit-profile-header">
        <div className="edit-profile-title">
          <h2>{payload.environment.name}</h2>
          {payload.environment.description ? (
            <p className="muted">{payload.environment.description}</p>
          ) : null}
        </div>
        <div className="edit-profile-header-actions">
          {showApply ? (
            <button
              type="button"
              className={["icon-action", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
              data-testid="apply-environment"
              disabled={controlsDisabled || busy}
              aria-busy={busy}
              aria-label={`Apply ${payload.environment.name} globally`}
              title="Detected values differ from this environment"
              onClick={onApply}
            >
              {busy ? (
                <ButtonSpinner size={ACTION_ICON_SIZE} />
              ) : (
                <Check size={ACTION_ICON_SIZE} aria-hidden />
              )}
            </button>
          ) : null}
          <button
            type="button"
            className="icon-action"
            disabled={controlsDisabled}
            aria-label={`Edit ${payload.environment.name}`}
            title="Edit environment"
            onClick={onEdit}
          >
            <Pencil size={ACTION_ICON_SIZE} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-action"
            disabled={controlsDisabled}
            aria-label={`Delete ${payload.environment.name}`}
            title="Delete environment"
            onClick={onDelete}
          >
            <Trash2 size={ACTION_ICON_SIZE} aria-hidden />
          </button>
        </div>
      </div>
      {empty ? (
        <p className="muted">No values or secrets yet.</p>
      ) : hasInventory ? (
        <dl className="resource-detail-kv">
          {envVars.length > 0 ? (
            <div>
              <dt>Env vars</dt>
              <dd>
                <ul className="environment-kv-list">
                  {envVars.map(([key, value]) => (
                    <li key={key}>
                      <code>{key}</code>={value}
                    </li>
                  ))}
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
      ) : null}
      {plugins.length > 0 ? (
        <EnvironmentInventoryBlock title="Plugins referencing this environment">
          <ul className="environment-kv-list">
            {plugins.map((plugin) => (
              <li key={plugin.id}>
                {onOpenPlugin ? (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => onOpenPlugin(plugin.name)}
                  >
                    {plugin.name}
                  </button>
                ) : (
                  plugin.name
                )}
              </li>
            ))}
          </ul>
        </EnvironmentInventoryBlock>
      ) : null}
    </div>
  );
}
