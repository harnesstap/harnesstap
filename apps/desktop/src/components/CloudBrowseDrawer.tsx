import { useEffect, useState } from "react";
import {
  AgentApiError,
  pullCloudProfile,
  searchCloudProfiles,
  tagProfile,
} from "../lib/agent-client";
import type {
  CloudProfile,
  CloudProfilePullResult,
} from "../lib/types";
import { ButtonSpinner } from "./ButtonSpinner";

interface CloudBrowseDrawerProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onClose: () => void;
  onPull: (profileName: string, used: boolean) => void | Promise<void>;
  onRequestSignIn?: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function suggestedName(profile: CloudProfile): string {
  const path = profile.selector.split("@")[0] ?? profile.name;
  const slug = path.split("/").at(-1) ?? profile.name;
  return `${slug}-copy`;
}

function catalogKind(profile: CloudProfile): "profile" | "layer" {
  return (profile.tags ?? []).includes("profile") ? "profile" : "layer";
}

export function CloudBrowseDrawer({
  open,
  baseUrl,
  token,
  disabled = false,
  onClose,
  onPull,
  onRequestSignIn,
}: CloudBrowseDrawerProps) {
  const [query, setQuery] = useState("");
  const [profiles, setProfiles] = useState<CloudProfile[]>([]);
  const [selected, setSelected] = useState<CloudProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collision, setCollision] = useState(false);
  const [rename, setRename] = useState("");
  const [pulled, setPulled] = useState<CloudProfilePullResult | null>(null);
  const [pendingUse, setPendingUse] = useState(false);
  const [taggedMessage, setTaggedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setQuery("");
    setProfiles([]);
    setSelected(null);
    setAuthRequired(false);
    setError(null);
    setCollision(false);
    setRename("");
    setPulled(null);
    setPendingUse(false);
    setTaggedMessage(null);
  }, [open]);

  useEffect(() => {
    if (!open || !baseUrl) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void searchCloudProfiles(baseUrl, token, query)
        .then((nextProfiles) => {
          if (cancelled) {
            return;
          }
          setAuthRequired(false);
          setProfiles(nextProfiles);
          setSelected((current) => {
            if (current) {
              const match = nextProfiles.find(
                (profile) => profile.selector === current.selector,
              );
              if (match) {
                return match;
              }
            }
            return nextProfiles[0] ?? null;
          });
        })
        .catch((loadError: unknown) => {
          if (cancelled) {
            return;
          }
          setProfiles([]);
          setSelected(null);
          if (
            loadError instanceof AgentApiError
            && loadError.code === "auth_required"
          ) {
            setAuthRequired(true);
            return;
          }
          setError(errorMessage(loadError, "Could not browse catalog layers."));
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [baseUrl, open, query, token]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !disabled) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, disabled, onClose, open]);

  const selectProfile = (profile: CloudProfile) => {
    setSelected(profile);
    setCollision(false);
    setRename("");
    setPulled(null);
    setPendingUse(false);
    setTaggedMessage(null);
    setError(null);
  };

  const runPull = async (use: boolean) => {
    if (!baseUrl || !selected || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setTaggedMessage(null);
    setPendingUse(use);
    try {
      const result = await pullCloudProfile(baseUrl, token, {
        selector: selected.selector,
        ...(collision && rename.trim() ? { as: rename.trim() } : {}),
        use: false,
      });
      setPulled(result);
      setCollision(false);
      await onPull(result.profile.name, use && result.tagged);
      if (!result.warning) {
        onClose();
      }
    } catch (pullError) {
      if (
        pullError instanceof AgentApiError
        && pullError.code === "name_collision"
      ) {
        setCollision(true);
        setRename((current) => current || suggestedName(selected));
        setError(
          "A local profile or layer already uses this name. Choose a new name.",
        );
      } else if (
        pullError instanceof AgentApiError
        && pullError.code === "auth_required"
      ) {
        setAuthRequired(true);
        setProfiles([]);
        setSelected(null);
      } else {
        setError(errorMessage(pullError, "Could not pull catalog layer."));
      }
    } finally {
      setBusy(false);
    }
  };

  const runTag = async () => {
    if (!baseUrl || !pulled || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await tagProfile(baseUrl, token, pulled.profile.name);
      setPulled({ ...pulled, tagged: true, warning: undefined });
      setTaggedMessage(
        pendingUse
          ? `Tagged ${pulled.profile.name}; starting switch.`
          : `Tagged ${pulled.profile.name} as a profile.`,
      );
      await onPull(pulled.profile.name, pendingUse);
      if (pendingUse) {
        onClose();
      }
    } catch (tagError) {
      setError(errorMessage(tagError, "Could not tag profile."));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return null;
  }

  const controlsDisabled = disabled || busy;
  const pullDisabled =
    controlsDisabled
    || !selected
    || (collision && !rename.trim());

  return (
    <div
      className="dialog-backdrop create-profile-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !controlsDisabled) {
          onClose();
        }
      }}
    >
      <div
        className="dialog create-profile-dialog cloud-browse-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-browse-title"
      >
        <div className="create-profile-header">
          <div>
            <div className="eyebrow">Cloud catalog</div>
            <h2 id="cloud-browse-title">Browse Cloud</h2>
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label="Close cloud browser"
            onClick={onClose}
            disabled={controlsDisabled}
          >
            ×
          </button>
        </div>

        <div className="create-profile-body cloud-browse-body">
          <label className="form-field">
            <span>Search catalog</span>
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={controlsDisabled || authRequired}
              placeholder="Search by name or description"
            />
          </label>

          {authRequired ? (
            <div className="cloud-auth-state">
              <h3>Cloud sign-in required</h3>
              <p className="muted">
                Sign in to HarnessTap Cloud to browse and pull shared layers.
              </p>
              {onRequestSignIn ? (
                <div className="cloud-account-actions">
                  <button
                    className="btn primary"
                    type="button"
                    onClick={onRequestSignIn}
                    disabled={controlsDisabled}
                  >
                    Sign in
                  </button>
                </div>
              ) : (
                <p className="muted">
                  Sign in with <span className="mono">ht auth login</span>, then
                  reopen this drawer.
                </p>
              )}
            </div>
          ) : (
            <div className="cloud-browser">
              <div
                className="cloud-results"
                role="listbox"
                aria-label="Catalog layers"
              >
                {loading ? (
                  <p className="muted cloud-list-message">Searching…</p>
                ) : profiles.length === 0 ? (
                  <p className="muted cloud-list-message">
                    No catalog layers found.
                  </p>
                ) : (
                  profiles.map((profile) => {
                    const kind = catalogKind(profile);
                    return (
                      <button
                        key={profile.selector}
                        className={`cloud-result${
                          selected?.selector === profile.selector ? " selected" : ""
                        }`}
                        type="button"
                        role="option"
                        aria-selected={selected?.selector === profile.selector}
                        onClick={() => selectProfile(profile)}
                        disabled={controlsDisabled}
                      >
                        <strong>
                          {profile.name}
                          <span className="pill cloud-kind-pill">{kind}</span>
                        </strong>
                        <small>
                          {profile.orgSlug}/{profile.catalogSlug} ·{" "}
                          {profile.version || "latest"}
                        </small>
                      </button>
                    );
                  })
                )}
              </div>

              <section className="cloud-preview" aria-label="Layer preview">
                {selected ? (
                  <>
                    <div>
                      <div className="eyebrow">Preview</div>
                      <h3>
                        {selected.name}
                        <span className="pill cloud-kind-pill">
                          {catalogKind(selected)}
                        </span>
                      </h3>
                      <p className="mono">{selected.selector}</p>
                    </div>
                    <p className="muted">
                      {selected.description || "No description provided."}
                    </p>
                    <div className="cloud-tags">
                      {(selected.tags ?? []).map((tag) => (
                        <span className="pill" key={tag}>{tag}</span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="muted">Select a layer to preview it.</p>
                )}
              </section>
            </div>
          )}

          {collision ? (
            <label className="form-field">
              <span>Pull under a new name</span>
              <input
                value={rename}
                onChange={(event) => setRename(event.target.value)}
                disabled={controlsDisabled}
                placeholder="profile-copy"
              />
            </label>
          ) : null}

          {pulled?.warning ? (
            <div className="banner">
              <div>
                <strong>Profile pulled with a warning</strong>
                <div>
                  {pendingUse
                    ? "Pulled but not tagged as a profile — tag it to apply."
                    : pulled.warning}
                </div>
              </div>
              <button
                className={["btn", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
                type="button"
                onClick={() => void runTag()}
                disabled={controlsDisabled}
                aria-busy={busy}
              >
                {busy ? <ButtonSpinner size={16} /> : null}
                {busy ? "Tagging…" : "Tag as profile"}
              </button>
            </div>
          ) : null}
          {taggedMessage ? (
            <div className="success-flash">{taggedMessage}</div>
          ) : null}
          {error ? <div className="banner error">{error}</div> : null}
        </div>

        <div className="dialog-actions create-profile-actions">
          <button
            className="btn"
            type="button"
            onClick={onClose}
            disabled={controlsDisabled}
          >
            Close
          </button>
          {!authRequired && !pulled ? (
            <>
              <button
                className={[
                  "btn",
                  busy && !pendingUse ? "is-busy" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                type="button"
                onClick={() => void runPull(false)}
                disabled={pullDisabled}
                aria-busy={busy && !pendingUse}
              >
                {busy && !pendingUse ? <ButtonSpinner size={16} /> : null}
                {busy && !pendingUse ? "Pulling…" : "Pull"}
              </button>
              <button
                className={[
                  "btn",
                  "primary",
                  busy && pendingUse ? "is-busy" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                type="button"
                onClick={() => void runPull(true)}
                disabled={pullDisabled}
                aria-busy={busy && pendingUse}
              >
                {busy && pendingUse ? <ButtonSpinner size={16} /> : null}
                {busy && pendingUse ? "Pulling…" : "Pull & use"}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
