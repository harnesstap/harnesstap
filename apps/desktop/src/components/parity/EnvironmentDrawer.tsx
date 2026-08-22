import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SourcePicker } from "@/components/ui/source-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentApiError, fetchLibraryPlugins } from "../../lib/agent-client";
import type { LibraryPlugin } from "../../lib/types";
import { ButtonSpinner } from "../ButtonSpinner";
import { FullScreenPanel } from "../FullScreenPanel";
import { SelectionList } from "../CompositionPickers";
import {
  canSubmitEnvironmentCreate,
  createEnvironment,
  fetchEnvironment,
  putEnvironment,
  type EnvironmentCreateMode,
} from "../../lib/api/environments";

export interface EnvironmentDrawerProps {
  open: boolean;
  mode: "create" | "edit";
  environmentName?: string;
  baseUrl: string | null;
  token: string | null;
  projectPath: string | null;
  disabled?: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

type SecretProvider = "keychain" | "env" | "file";
type PermissionAction = "allow" | "deny" | "ask";

interface EnvVarRow {
  key: string;
  value: string;
}

interface SecretRow {
  key: string;
  provider: SecretProvider;
  ref: string;
}

interface ModelRow {
  name: string;
  model: string;
  provider: string;
}

interface PermissionRow {
  name: string;
  action: PermissionAction;
  pattern: string;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof AgentApiError && error.code === "environment_exists") {
    return "A environment with this name already exists.";
  }
  return error instanceof Error ? error.message : fallback;
}

export function EnvironmentDrawer({
  open,
  mode,
  environmentName,
  baseUrl,
  token,
  projectPath,
  disabled = false,
  onClose,
  onSaved,
}: EnvironmentDrawerProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState<EnvironmentCreateMode>("blank");
  const [pluginIds, setPluginIds] = useState<string[]>([]);
  const [plugins, setPlugins] = useState<LibraryPlugin[]>([]);
  const [useAfterCreate, setUseAfterCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [envVars, setEnvVars] = useState<EnvVarRow[]>([{ key: "", value: "" }]);
  const [secrets, setSecrets] = useState<SecretRow[]>([
    { key: "", provider: "env", ref: "" },
  ]);
  const [models, setModels] = useState<ModelRow[]>([
    { name: "default", model: "", provider: "" },
  ]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([
    { name: "", action: "allow", pattern: "" },
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    setWarning(null);
    setBusy(false);
    if (mode === "create") {
      setName("");
      setDescription("");
      setSource("blank");
      setPluginIds([]);
      setUseAfterCreate(false);
    }
  }, [mode, open]);

  useEffect(() => {
    if (!open || mode !== "edit" || !environmentName || !baseUrl) {
      return;
    }
    let cancelled = false;
    void fetchEnvironment(baseUrl, token, environmentName)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setName(payload.environment.name);
        setDescription(payload.environment.description);
        const vars = Object.entries(payload.values.env_vars);
        setEnvVars(vars.length > 0 ? vars.map(([key, value]) => ({ key, value })) : [{ key: "", value: "" }]);
        const secretEntries = Object.entries(payload.secret_refs);
        setSecrets(
          secretEntries.length > 0
            ? secretEntries.map(([key, secret]) => ({
                key,
                provider: (secret.provider === "keychain" || secret.provider === "file"
                  ? secret.provider
                  : "env") as SecretProvider,
                ref: secret.ref,
              }))
            : [{ key: "", provider: "env", ref: "" }],
        );
        setModels(
          payload.values.model_configs.length > 0
            ? payload.values.model_configs.map((row) => ({
                name: row.name,
                model: row.model,
                provider: row.provider ?? "",
              }))
            : [{ name: "default", model: "", provider: "" }],
        );
        setPermissions(
          payload.values.permissions.length > 0
            ? payload.values.permissions.map((row) => ({
                name: row.name,
                action: (row.action === "deny" || row.action === "ask" ? row.action : "allow") as PermissionAction,
                pattern: row.pattern,
              }))
            : [{ name: "", action: "allow", pattern: "" }],
        );
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(errorMessage(loadError, "Could not load environment"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, environmentName, mode, open, token]);

  useEffect(() => {
    if (!open || mode !== "create" || !baseUrl) {
      return;
    }
    let cancelled = false;
    void fetchLibraryPlugins(baseUrl, token)
      .then((next) => {
        if (!cancelled) {
          setPlugins(next);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(errorMessage(loadError, "Could not load the local library."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, mode, open, token]);

  const selectedPluginNames = useMemo(
    () =>
      plugins
        .filter((plugin) => pluginIds.includes(plugin.id))
        .map((plugin) => plugin.name),
    [pluginIds, plugins],
  );

  const canSubmit = canSubmitEnvironmentCreate({
    name,
    mode: source,
    projectPath,
    plugins: selectedPluginNames,
  });
  const controlsDisabled = disabled || busy;
  const title = mode === "create" ? "Create environment" : `Edit ${environmentName ?? name}`;

  const runCreate = async () => {
    if (!baseUrl || !canSubmit || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const result = await createEnvironment(baseUrl, token, {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        mode: source,
        ...(source === "from-project" && projectPath ? { projectPath } : {}),
        ...(source === "from-plugin" ? { plugins: selectedPluginNames } : {}),
        useAfterCreate,
      });
      if (result.missing_keys.length > 0) {
        setWarning(
          `Missing keys: ${result.missing_keys.map((row) => row.key).join(", ")}`,
        );
        return;
      }
      onSaved(`Created environment ${name.trim()}`);
      onClose();
    } catch (createError: unknown) {
      setError(errorMessage(createError, "Could not create environment"));
    } finally {
      setBusy(false);
    }
  };

  const runSave = async () => {
    if (!baseUrl || !environmentName || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const env_vars: Record<string, string> = {};
      for (const row of envVars) {
        if (row.key.trim()) {
          env_vars[row.key.trim()] = row.value;
        }
      }
      const secret_refs: Record<string, { provider: SecretProvider; ref: string }> = {};
      for (const row of secrets) {
        if (row.key.trim() && row.ref.trim()) {
          secret_refs[row.key.trim()] = { provider: row.provider, ref: row.ref.trim() };
        }
      }
      await putEnvironment(baseUrl, token, environmentName, {
        description,
        env_vars,
        model_configs: models
          .filter((row) => row.model.trim())
          .map((row) => ({
            name: row.name.trim() || "default",
            model: row.model.trim(),
            ...(row.provider.trim() ? { provider: row.provider.trim() } : {}),
          })),
        permissions: permissions
          .filter((row) => row.pattern.trim())
          .map((row) => ({
            ...(row.name.trim() ? { name: row.name.trim() } : {}),
            action: row.action,
            pattern: row.pattern.trim(),
          })),
        secret_refs,
      });
      onSaved(`Updated environment ${environmentName}`);
      onClose();
    } catch (saveError: unknown) {
      setError(errorMessage(saveError, "Could not save environment"));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <FullScreenPanel
      titleId="environment-drawer-title"
      title={title}
      eyebrow="Environments"
      closeLabel="Close environment drawer"
      closeDisabled={controlsDisabled}
      onClose={onClose}
      actions={
        <>
          <button
            className="btn"
            type="button"
            onClick={onClose}
            disabled={controlsDisabled}
          >
            Cancel
          </button>
          {mode === "create" ? (
            <button
              className={["btn", "primary", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
              type="button"
              onClick={() => void runCreate()}
              disabled={!canSubmit || controlsDisabled}
              aria-busy={busy}
            >
              {busy ? <ButtonSpinner size={16} /> : null}
              {busy ? "Creating…" : "Create environment"}
            </button>
          ) : (
            <button
              className={["btn", "primary", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
              type="button"
              onClick={() => void runSave()}
              disabled={controlsDisabled}
              aria-busy={busy}
            >
              {busy ? <ButtonSpinner size={16} /> : null}
              {busy ? "Saving…" : "Save environment"}
            </button>
          )}
        </>
      }
    >
          <div className="form-field gap-1.5">
            <Label htmlFor="environment-name">Name</Label>
            <Input
              id="environment-name"
              autoFocus={mode === "create"}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={controlsDisabled || mode === "edit"}
              readOnly={mode === "edit"}
            />
          </div>
          <div className="form-field gap-1.5">
            <Label htmlFor="environment-description">
              Description <span className="muted">(optional)</span>
            </Label>
            <Textarea
              id="environment-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={controlsDisabled}
              rows={2}
            />
          </div>

          {mode === "create" ? (
            <>
              <SourcePicker
                legend="Source"
                value={source}
                disabled={controlsDisabled}
                onValueChange={(next) => setSource(next as EnvironmentCreateMode)}
                options={[
                  {
                    value: "blank",
                    title: "Blank",
                    description: "Empty environment.",
                  },
                  {
                    value: "from-project",
                    title: "From project",
                    description: "Capture from the selected project directory.",
                    disabled: !projectPath,
                  },
                  {
                    value: "from-plugin",
                    title: "From plugin",
                    description: "Collect keys required by selected plugins.",
                  },
                ]}
              />
              {!projectPath ? (
                <p className="field-note muted" title="Choose a project directory">
                  Choose a project directory
                </p>
              ) : null}
              {source === "from-plugin" ? (
                <SelectionList
                  title="Plugins"
                  emptyLabel="No plugins available."
                  rows={plugins}
                  selectedIds={pluginIds}
                  disabled={controlsDisabled}
                  onToggle={(id) =>
                    setPluginIds((current) =>
                      current.includes(id)
                        ? current.filter((entry) => entry !== id)
                        : [...current, id],
                    )}
                />
              ) : null}
              <div className="switch-after-create flex items-center gap-2 border-t border-border pt-2.5">
                <Switch
                  id="use-after-create"
                  checked={useAfterCreate}
                  onCheckedChange={setUseAfterCreate}
                  disabled={controlsDisabled}
                />
                <Label htmlFor="use-after-create">Use after create</Label>
              </div>
            </>
          ) : (
            <>
              <RepeatableSection
                title="Env vars"
                onAdd={() => setEnvVars((rows) => [...rows, { key: "", value: "" }])}
                disabled={controlsDisabled}
              >
                {envVars.map((row, index) => (
                  <div className="flex gap-2" key={`env-${index}`}>
                    <Input
                      placeholder="KEY"
                      value={row.key}
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        setEnvVars((rows) =>
                          rows.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, key: event.target.value } : entry,
                          ),
                        )}
                    />
                    <Input
                      placeholder="VALUE"
                      value={row.value}
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        setEnvVars((rows) =>
                          rows.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, value: event.target.value } : entry,
                          ),
                        )}
                    />
                    <button
                      className="btn"
                      type="button"
                      disabled={controlsDisabled}
                      onClick={() => setEnvVars((rows) => rows.filter((_, entryIndex) => entryIndex !== index))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </RepeatableSection>
              <RepeatableSection
                title="Secret refs"
                onAdd={() =>
                  setSecrets((rows) => [...rows, { key: "", provider: "env", ref: "" }])}
                disabled={controlsDisabled}
              >
                {secrets.map((row, index) => (
                  <div className="flex gap-2" key={`secret-${index}`}>
                    <Input
                      placeholder="KEY"
                      value={row.key}
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        setSecrets((rows) =>
                          rows.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, key: event.target.value } : entry,
                          ),
                        )}
                    />
                    <Select
                      value={row.provider}
                      onValueChange={(value) =>
                        setSecrets((rows) =>
                          rows.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, provider: value as SecretProvider }
                              : entry,
                          ),
                        )}
                      disabled={controlsDisabled}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="keychain">keychain</SelectItem>
                        <SelectItem value="env">env</SelectItem>
                        <SelectItem value="file">file</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="ref"
                      value={row.ref}
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        setSecrets((rows) =>
                          rows.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, ref: event.target.value } : entry,
                          ),
                        )}
                    />
                    <button
                      className="btn"
                      type="button"
                      disabled={controlsDisabled}
                      onClick={() => setSecrets((rows) => rows.filter((_, entryIndex) => entryIndex !== index))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </RepeatableSection>
              <RepeatableSection
                title="Model configs"
                onAdd={() =>
                  setModels((rows) => [...rows, { name: "", model: "", provider: "" }])}
                disabled={controlsDisabled}
              >
                {models.map((row, index) => (
                  <div className="flex gap-2" key={`model-${index}`}>
                    <Input
                      placeholder="name"
                      value={row.name}
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        setModels((rows) =>
                          rows.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, name: event.target.value } : entry,
                          ),
                        )}
                    />
                    <Input
                      placeholder="model"
                      value={row.model}
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        setModels((rows) =>
                          rows.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, model: event.target.value } : entry,
                          ),
                        )}
                    />
                    <Input
                      placeholder="provider"
                      value={row.provider}
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        setModels((rows) =>
                          rows.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, provider: event.target.value } : entry,
                          ),
                        )}
                    />
                    <button
                      className="btn"
                      type="button"
                      disabled={controlsDisabled}
                      onClick={() => setModels((rows) => rows.filter((_, entryIndex) => entryIndex !== index))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </RepeatableSection>
              <RepeatableSection
                title="Permissions"
                onAdd={() =>
                  setPermissions((rows) => [...rows, { name: "", action: "allow", pattern: "" }])}
                disabled={controlsDisabled}
              >
                {permissions.map((row, index) => (
                  <div className="flex gap-2" key={`perm-${index}`}>
                    <Select
                      value={row.action}
                      onValueChange={(value) =>
                        setPermissions((rows) =>
                          rows.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, action: value as PermissionAction }
                              : entry,
                          ),
                        )}
                      disabled={controlsDisabled}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="allow">allow</SelectItem>
                        <SelectItem value="deny">deny</SelectItem>
                        <SelectItem value="ask">ask</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="pattern"
                      value={row.pattern}
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        setPermissions((rows) =>
                          rows.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, pattern: event.target.value } : entry,
                          ),
                        )}
                    />
                    <button
                      className="btn"
                      type="button"
                      disabled={controlsDisabled}
                      onClick={() =>
                        setPermissions((rows) => rows.filter((_, entryIndex) => entryIndex !== index))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </RepeatableSection>
            </>
          )}

          {warning ? <div className="banner">{warning}</div> : null}
          {error ? <div className="banner error">{error}</div> : null}
    </FullScreenPanel>
  );
}

function RepeatableSection({
  title,
  onAdd,
  disabled,
  children,
}: {
  title: string;
  onAdd: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <section className="form-field gap-1.5">
      <div className="flex items-center justify-between">
        <h3>{title}</h3>
        <button className="btn" type="button" onClick={onAdd} disabled={disabled}>
          Add
        </button>
      </div>
      {children}
    </section>
  );
}
