import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  AgentApiError,
  fetchProjectConfig,
  fetchProjectConfigRaw,
  putProjectConfigRaw,
  type ProjectConfigInspectPayload,
  type ProjectConfigProfile,
  type ProjectConfigValidation,
} from "../../lib/api/project-config";
import { openResourcePath } from "../../lib/agent-client";
import { ExternalLink, Save } from "lucide-react";
import { ButtonSpinner } from "../ButtonSpinner";
import { IconActionButton } from "../IconActionButton";
import { ProjectPicker } from "../ProjectPicker";

export interface ProjectConfigInspectProps {
  open?: boolean;
  baseUrl: string | null;
  token: string | null;
  projectPath: string | null;
  disabled?: boolean;
  onSelectProject: (path: string) => void;
  onBrowseProject: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function profileTarget(entry: ProjectConfigProfile): string {
  switch (entry.source) {
    case "catalog":
    case "local":
      return entry.selector ?? "";
    case "inline":
      return entry.plugin ?? "";
    default: {
      const unhandledSource: never = entry.source;
      throw new Error(`Unhandled profile source: ${unhandledSource}`);
    }
  }
}

export function ProjectConfigInspect({
  open = true,
  baseUrl,
  token,
  projectPath,
  disabled = false,
  onSelectProject,
  onBrowseProject,
}: ProjectConfigInspectProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [payload, setPayload] = useState<ProjectConfigInspectPayload | null>(null);
  const [draft, setDraft] = useState("");
  const [savedContents, setSavedContents] = useState("");
  const [rawPath, setRawPath] = useState<string | null>(null);
  const [hasRaw, setHasRaw] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [paneValidation, setPaneValidation] = useState<ProjectConfigValidation | null>(
    null,
  );

  useEffect(() => {
    if (!open || disabled) {
      return;
    }
    if (!projectPath || !baseUrl) {
      setPayload(null);
      setLoadError(null);
      setOpenError(null);
      setDraft("");
      setSavedContents("");
      setRawPath(null);
      setHasRaw(false);
      setSaveErrors([]);
      setPaneValidation(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setOpenError(null);
    setSaveErrors([]);
    void Promise.allSettled([
      fetchProjectConfig(baseUrl, token, projectPath),
      fetchProjectConfigRaw(baseUrl, token, projectPath),
    ])
      .then(([inspectResult, rawResult]) => {
        if (cancelled) return;
        if (inspectResult.status === "fulfilled") {
          setPayload(inspectResult.value);
          setPaneValidation(inspectResult.value.validation);
        } else {
          setPayload(null);
          setLoadError(errorMessage(inspectResult.reason, "Could not load project config."));
        }
        if (rawResult.status === "fulfilled") {
          setDraft(rawResult.value.contents);
          setSavedContents(rawResult.value.contents);
          setRawPath(rawResult.value.path);
          setHasRaw(true);
          setPaneValidation(rawResult.value.validation);
          if (inspectResult.status === "rejected") {
            setLoadError(null);
          }
        } else if (inspectResult.status === "rejected") {
          setHasRaw(false);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, baseUrl, token, projectPath, disabled]);

  const config = payload?.config;
  const validation = paneValidation ?? payload?.validation;
  const profiles = config?.profiles ?? [];
  const dirty = draft !== savedContents;
  const canOpen = Boolean(baseUrl && (rawPath || config) && !disabled && !opening);
  const canSave = Boolean(
    baseUrl && token && projectPath && hasRaw && dirty && !disabled && !saveBusy,
  );

  async function handleOpenConfig(): Promise<void> {
    const path = rawPath ?? config?.config_path;
    if (!baseUrl || !path || opening) {
      return;
    }
    setOpening(true);
    setOpenError(null);
    try {
      await openResourcePath(baseUrl, token, { path });
    } catch (error: unknown) {
      setOpenError(errorMessage(error, "Could not open file in editor"));
    } finally {
      setOpening(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (!baseUrl || !token || !projectPath || !canSave) {
      return;
    }
    setSaveBusy(true);
    setSaveErrors([]);
    setOpenError(null);
    try {
      const saved = await putProjectConfigRaw(baseUrl, token, {
        projectPath,
        contents: draft,
      });
      setDraft(saved.contents);
      setSavedContents(saved.contents);
      setRawPath(saved.path);
      setPaneValidation(saved.validation);
      if (saved.config) {
        setPayload({
          config: saved.config,
          validation: saved.validation,
        });
      }
    } catch (error: unknown) {
      const message = error instanceof AgentApiError
        ? error.message
        : errorMessage(error, "Could not save apm.yml.");
      setSaveErrors(message.split("\n").filter((line) => line.length > 0));
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <section className="settings-section" data-testid="project-config-inspect">
      <h3>Project config</h3>
      <div className="form-field">
        <Label htmlFor="project-config-path">Project</Label>
        <ProjectPicker
          projectPath={projectPath ?? ""}
          disabled={disabled}
          testId="project-config-path"
          onSelect={onSelectProject}
          onBrowse={onBrowseProject}
        />
      </div>
      {!projectPath ? (
        <p className="muted">Select a project to inspect its config.</p>
      ) : loading ? (
        <p className="muted">Loading project config…</p>
      ) : null}
      {loadError ?? openError ? (
        <div className="banner error" role="alert">
          {loadError ?? openError}
        </div>
      ) : null}
      {hasRaw && !loading ? (
        <div className="form-field" data-testid="project-config-yaml">
          <Label htmlFor="project-config-yaml">apm.yml</Label>
          <textarea
            id="project-config-yaml"
            className="library-field-editor library-field-editor-content mono"
            value={draft}
            rows={15}
            disabled={disabled || saveBusy}
            spellCheck={false}
            aria-label="apm.yml"
            aria-invalid={saveErrors.length > 0 || validation?.valid === false}
            onChange={(event) => {
              setDraft(event.target.value);
              setSaveErrors([]);
            }}
          />
        </div>
      ) : null}
      {(config || hasRaw) && !loading ? (
        <>
          <div className="project-config-actions">
            <IconActionButton
              label="Open config"
              disabled={!canOpen}
              onClick={() => void handleOpenConfig()}
              icon={<ExternalLink size={16} aria-hidden />}
            />
            <button
              type="button"
              className={["btn", "primary", saveBusy ? "is-busy" : ""]
                .filter(Boolean)
                .join(" ")}
              disabled={!canSave}
              aria-busy={saveBusy}
              data-testid="project-config-save"
              onClick={() => void handleSave()}
            >
              {saveBusy ? <ButtonSpinner size={16} /> : <Save size={16} aria-hidden />}
              {saveBusy ? "Saving…" : "Save"}
            </button>
          </div>
          {saveErrors.length > 0 ? (
            <div className="banner error" role="alert" data-testid="project-config-save-errors">
              {saveErrors.map((item) => (
                <div key={item}>{item}</div>
              ))}
            </div>
          ) : null}
          {profiles.length === 0 ? (
            <p className="muted">No profiles configured.</p>
          ) : (
            profiles.map((profile) => {
              const environment =
                profile.environment ?? config?.default_environment ?? "";
              return (
                <article className="harness-block" key={profile.name}>
                  <h4 className="harness-header">
                    {profile.name}
                    {profile.name === config?.default_profile ? (
                      <span className="badge">default</span>
                    ) : null}
                  </h4>
                  <dl className="resource-detail-kv">
                    <div>
                      <dt>Source</dt>
                      <dd>{profile.source}</dd>
                    </div>
                    <div>
                      <dt>Selector/plugin</dt>
                      <dd>{profileTarget(profile)}</dd>
                    </div>
                    {environment ? (
                      <div>
                        <dt>Environment</dt>
                        <dd>{environment}</dd>
                      </div>
                    ) : null}
                  </dl>
                </article>
              );
            })
          )}
          {validation && !validation.valid ? (
            <div className="banner error" role="alert">
              {validation.errors.map((item) => (
                <div key={item}>{item}</div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
