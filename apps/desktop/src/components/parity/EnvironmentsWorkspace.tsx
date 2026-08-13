import { useCallback, useEffect, useMemo, useState } from "react";
import { CirclePlay, Pencil, Plus, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "../ConfirmDialog";
import { ButtonSpinner } from "../ButtonSpinner";
import {
  deleteEnvironment,
  environmentDeleteNeedsForce,
  fetchEnvironment,
  fetchEnvironmentStatus,
  filterEnvironmentsByQuery,
  listEnvironments,
  sidecarStatusCopy,
  useEnvironmentGlobally,
  type EnvironmentListRow,
  type EnvironmentShowPayload,
  type EnvironmentStatusPayload,
} from "../../lib/api/environments";
import { EnvironmentDrawer } from "./EnvironmentDrawer";

const ICON_SIZE = 14;

export interface EnvironmentsWorkspaceProps {
  baseUrl: string | null;
  token: string | null;
  connected?: boolean;
  switching?: boolean;
  projectPath: string | null;
  disabled?: boolean;
  onSuccess: (message: string) => void;
}

export function EnvironmentsWorkspace({
  baseUrl,
  token,
  connected: connectedProp,
  switching: switchingProp,
  projectPath,
  disabled = false,
  onSuccess,
}: EnvironmentsWorkspaceProps) {
  const connected = connectedProp ?? Boolean(baseUrl && token);
  const switching = switchingProp ?? disabled;
  const controlsDisabled = switching || !connected || disabled;

  const [rows, setRows] = useState<EnvironmentListRow[]>([]);
  const [status, setStatus] = useState<EnvironmentStatusPayload | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
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
      setStatus(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      listEnvironments(baseUrl, token),
      fetchEnvironmentStatus(baseUrl, token),
    ])
      .then(([nextRows, nextStatus]) => {
        if (cancelled) {
          return;
        }
        setRows(nextRows);
        setStatus(nextStatus);
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
  const statusCopy = status
    ? sidecarStatusCopy(status)
    : { kind: "none" as const, text: "No active environment.", hint: "Use an environment to set it globally." };
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
          <div className="resources-panel-title">
            <span>Environments</span>
            <span className="muted resources-panel-scope">
              Reusable env vars, secrets, models, and permissions
            </span>
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
            <Plus size={16} aria-hidden />
          </button>
        </div>
        <p
          className={
            statusCopy.kind === "sync"
              ? "edit-active-badge"
              : statusCopy.kind === "drift"
                ? "banner"
                : "muted"
          }
        >
          {statusCopy.text}
        </p>
        {statusCopy.kind === "none" && statusCopy.hint ? (
          <p className="muted">{statusCopy.hint}</p>
        ) : null}
        <input
          className="resources-panel-filter"
          type="search"
          placeholder="Filter environments"
          aria-label="Filter environments"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={controlsDisabled}
        />
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="resources-panel-layout">
        <div className="resource-filter-sidebar">
          {filtered.length === 0 ? (
            <p className="muted">No environments yet.</p>
          ) : (
            <ul className="resources-list">
              {filtered.map((row) => {
                const rowBusy = busyName === row.name;
                return (
                  <li className="resources-list-item" key={row.id}>
                    <div className="resources-list-main">
                      <button
                        type="button"
                        className="resource-name-btn resources-list-name"
                        disabled={controlsDisabled}
                        onClick={() => setSelectedName(row.name)}
                      >
                        {row.name}
                        {row.is_global_active ? <span className="badge">Active</span> : null}
                      </button>
                      <button
                        type="button"
                        className={["icon-action", rowBusy ? "is-busy" : ""].filter(Boolean).join(" ")}
                        aria-label={`Use ${row.name} globally`}
                        title="Use globally"
                        disabled={controlsDisabled || rowBusy}
                        onClick={() => void onUse(row.name)}
                      >
                        {rowBusy ? <ButtonSpinner size={ICON_SIZE} /> : <CirclePlay size={ICON_SIZE} aria-hidden />}
                      </button>
                      <button
                        type="button"
                        className="icon-action"
                        aria-label={`Edit ${row.name}`}
                        title="Edit"
                        disabled={controlsDisabled}
                        onClick={() => {
                          setDrawerMode("edit");
                          setEditName(row.name);
                          setDrawerOpen(true);
                        }}
                      >
                        <Pencil size={ICON_SIZE} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="icon-action"
                        aria-label={`Delete ${row.name}`}
                        title="Delete"
                        disabled={controlsDisabled}
                        onClick={() => {
                          setSelectedName(row.name);
                          setDeleteTarget(row);
                          setForceChecked(false);
                        }}
                      >
                        <Trash2 size={ICON_SIZE} aria-hidden />
                      </button>
                    </div>
                    {row.description ? (
                      <span className="resources-list-desc muted">{row.description}</span>
                    ) : null}
                    <span className="resources-list-desc muted">
                      {row.value_count} values · {row.secret_ref_count} secrets · {row.reference_count} plugins
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="resources-panel-body">
          {detail ? (
            <EnvironmentDetail payload={detail} />
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

function EnvironmentDetail({ payload }: { payload: EnvironmentShowPayload }) {
  const envVars = Object.entries(payload.values.env_vars);
  const secrets = Object.entries(payload.secret_refs);
  const models = payload.values.model_configs;
  const permissions = payload.values.permissions;
  const plugins = payload.references.plugins;

  return (
    <div className="edit-profile-body">
      <section>
        <h3>Description</h3>
        <p className={payload.environment.description ? undefined : "muted"}>
          {payload.environment.description || "None"}
        </p>
      </section>
      <section>
        <h3>Env vars</h3>
        {envVars.length === 0 ? (
          <p className="muted">None</p>
        ) : (
          <ul>
            {envVars.map(([key, value]) => (
              <li key={key}>
                <code>{key}</code>={value}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3>Secret refs</h3>
        {secrets.length === 0 ? (
          <p className="muted">None</p>
        ) : (
          <ul>
            {secrets.map(([key, secret]) => (
              <li key={key}>
                <code>{key}</code> {secret.provider} {secret.ref}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3>Model configs</h3>
        {models.length === 0 ? (
          <p className="muted">None</p>
        ) : (
          <ul>
            {models.map((model) => (
              <li key={model.name}>
                {model.name}: {model.model}
                {model.provider ? ` (${model.provider})` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3>Permissions</h3>
        {permissions.length === 0 ? (
          <p className="muted">None</p>
        ) : (
          <ul>
            {permissions.map((permission) => (
              <li key={`${permission.action}:${permission.pattern}`}>
                {permission.action}:{permission.pattern}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3>Plugins</h3>
        {plugins.length === 0 ? (
          <p className="muted">None</p>
        ) : (
          <ul>
            {plugins.map((plugin) => (
              <li key={plugin.id}>{plugin.name}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
