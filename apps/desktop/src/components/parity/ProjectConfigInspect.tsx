import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  fetchProjectConfig,
  type ProjectConfigInspectPayload,
  type ProjectConfigProfile,
} from "../../lib/api/project-config";
import { openResourcePath } from "../../lib/agent-client";
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

  useEffect(() => {
    if (!open || disabled) {
      return;
    }
    if (!projectPath || !baseUrl) {
      setPayload(null);
      setLoadError(null);
      setOpenError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setOpenError(null);
    void fetchProjectConfig(baseUrl, token, projectPath)
      .then((next) => {
        if (cancelled) return;
        setPayload(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPayload(null);
        setLoadError(errorMessage(error, "Could not load project config."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, baseUrl, token, projectPath, disabled]);

  const config = payload?.config;
  const validation = payload?.validation;
  const profiles = config?.profiles ?? [];
  const canOpen = Boolean(baseUrl && config && !disabled && !opening);

  async function handleOpenConfig(): Promise<void> {
    if (!baseUrl || !config || opening) {
      return;
    }
    setOpening(true);
    setOpenError(null);
    try {
      await openResourcePath(baseUrl, token, { path: config.config_path });
    } catch (error: unknown) {
      setOpenError(errorMessage(error, "Could not open file in editor"));
    } finally {
      setOpening(false);
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
      {config && !loading ? (
        <>
          <div className="project-config-actions">
            <button
              type="button"
              className="btn"
              disabled={!canOpen}
              onClick={() => void handleOpenConfig()}
            >
              Open config
            </button>
          </div>
          {profiles.length === 0 ? (
            <p className="muted">No profiles configured.</p>
          ) : (
            profiles.map((profile) => {
              const environment =
                profile.environment ?? config.default_environment ?? "";
              return (
                <article className="harness-block" key={profile.name}>
                  <h4 className="harness-header">
                    {profile.name}
                    {profile.name === config.default_profile ? (
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
