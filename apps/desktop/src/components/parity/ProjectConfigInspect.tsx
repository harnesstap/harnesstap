import { useEffect, useState } from "react";
import {
  fetchProjectConfig,
  type ProjectConfigInspectPayload,
  type ProjectConfigProfile,
} from "../../lib/api/project-config";

export interface ProjectConfigInspectProps {
  open?: boolean;
  baseUrl: string | null;
  token: string | null;
  projectPath: string | null;
  disabled?: boolean;
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
}: ProjectConfigInspectProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ProjectConfigInspectPayload | null>(null);

  useEffect(() => {
    if (!open || disabled) {
      return;
    }
    if (!projectPath || !baseUrl) {
      setPayload(null);
      setLoadError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
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

  return (
    <section className="settings-section" data-testid="project-config-inspect">
      <h3>Project config</h3>
      {!projectPath ? (
        <p className="muted">Select a project to inspect its config.</p>
      ) : loading ? (
        <p className="muted">Loading project config…</p>
      ) : loadError ? (
        <div className="banner error" role="alert">
          {loadError}
        </div>
      ) : config ? (
        <>
          <dl className="resource-detail-kv">
            <div>
              <dt>Config</dt>
              <dd className="mono">{config.config_path}</dd>
            </div>
            <div>
              <dt>Root</dt>
              <dd className="mono">{config.root_path}</dd>
            </div>
            {config.default_profile ? (
              <div>
                <dt>Default profile</dt>
                <dd>{config.default_profile}</dd>
              </div>
            ) : null}
            {config.default_environment ? (
              <div>
                <dt>Default environment</dt>
                <dd>{config.default_environment}</dd>
              </div>
            ) : null}
            <div>
              <dt>Environments</dt>
              <dd>{config.environment_count}</dd>
            </div>
            <div>
              <dt>Inline plugins</dt>
              <dd>{config.plugin_count}</dd>
            </div>
          </dl>
          {profiles.length === 0 ? (
            <p className="muted">No profiles configured.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>Profile</th>
                  <th>Source</th>
                  <th>Selector/plugin</th>
                  <th>Environment</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.name}>
                    <td>
                      {profile.name}
                      {profile.name === config.default_profile ? " *" : ""}
                    </td>
                    <td>{profile.source}</td>
                    <td>{profileTarget(profile)}</td>
                    <td>{profile.environment ?? config.default_environment ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {validation?.valid ? (
            <p className="muted">Config is valid.</p>
          ) : (
            <div className="banner error" role="alert">
              {(validation?.errors ?? []).map((item) => (
                <div key={item}>{item}</div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
