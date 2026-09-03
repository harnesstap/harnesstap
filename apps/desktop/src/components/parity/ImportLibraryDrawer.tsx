import { useEffect, useMemo, useState } from "react";
import { open as openDirectoryDialog } from "@tauri-apps/plugin-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SourcePicker } from "@/components/ui/source-picker";
import { AgentApiError } from "../../lib/api/http";
import {
  commitLibraryImport,
  previewLibraryImport,
  type LibraryImportConflictPolicy,
  type LibraryImportKind,
  type LibraryImportPreview,
  type LibraryImportRequest,
} from "../../lib/api/import-library";
import { projectDisplayName } from "../../lib/recent-projects";
import { Check, FolderDown, FolderOpen, X } from "lucide-react";
import { ButtonSpinner } from "../ButtonSpinner";
import { FullScreenPanel } from "../FullScreenPanel";
import { IconActionButton } from "../IconActionButton";

export interface ImportLibraryDrawerProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  projectPath: string;
  selectedProfile: string | null;
  disabled?: boolean;
  onClose: () => void;
  onImported: (message: string) => void;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof AgentApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}

function conflictLabel(conflict: { type: string; name: string }): string {
  return `${conflict.type}: ${conflict.name}`;
}

function successMessage(
  kind: LibraryImportKind,
  totalImports: number,
  extra: {
    projectPath: string;
    namespace?: string;
    pluginName?: string;
    attachedProfile?: string;
  },
): string {
  let base = "";
  switch (kind) {
    case "scan":
      base = `Imported ${totalImports} resources from ${projectDisplayName(extra.projectPath) || extra.projectPath}`;
      break;
    case "add":
      base = `Imported ${totalImports} skills from ${extra.namespace ?? "package"}`;
      break;
    case "from_project":
      base = `Created plugin ${extra.pluginName ?? ""} (${totalImports} resources)`;
      break;
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
  if (extra.attachedProfile) {
    return `${base} · attached to ${extra.attachedProfile}`;
  }
  return base;
}

export function ImportLibraryDrawer({
  open,
  baseUrl,
  token,
  projectPath,
  selectedProfile,
  disabled = false,
  onClose,
  onImported,
}: ImportLibraryDrawerProps) {
  const [kind, setKind] = useState<LibraryImportKind>("scan");
  const [addSource, setAddSource] = useState("");
  const [pluginName, setPluginName] = useState("");
  const [pluginDescription, setPluginDescription] = useState("");
  const [preview, setPreview] = useState<LibraryImportPreview | null>(null);
  const [conflictPolicy, setConflictPolicy] =
    useState<LibraryImportConflictPolicy>("skip");
  const [attach, setAttach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setKind(projectPath.trim() ? "scan" : "add");
    setAddSource("");
    setPluginName("");
    setPluginDescription("");
    setPreview(null);
    setConflictPolicy("skip");
    setAttach(false);
    setError(null);
  }, [open, projectPath]);

  const hasProject = projectPath.trim().length > 0;
  const canAttach = Boolean(selectedProfile);

  const canContinue = useMemo(() => {
    if (!baseUrl || !token) {
      return false;
    }
    switch (kind) {
      case "scan":
        return hasProject;
      case "add":
        return addSource.trim().length > 0;
      case "from_project":
        return hasProject && pluginName.trim().length > 0;
      default: {
        const neverKind: never = kind;
        return neverKind;
      }
    }
  }, [addSource, baseUrl, hasProject, kind, pluginName, token]);

  const buildRequest = (includeAttach: boolean): LibraryImportRequest => {
    const attachProfile =
      includeAttach && attach && selectedProfile ? selectedProfile : undefined;
    switch (kind) {
      case "scan":
        return {
          kind: "scan",
          projectPath,
          conflictPolicy,
          ...(attachProfile ? { attachProfile } : {}),
        };
      case "add":
        return {
          kind: "add",
          source: addSource.trim(),
          conflictPolicy,
          ...(attachProfile ? { attachProfile } : {}),
        };
      case "from_project":
        return {
          kind: "from_project",
          projectPath,
          name: pluginName.trim(),
          description: pluginDescription.trim() || undefined,
          conflictPolicy,
          ...(attachProfile ? { attachProfile } : {}),
        };
      default: {
        const neverKind: never = kind;
        return neverKind;
      }
    }
  };

  const invalidatePreview = () => {
    setPreview(null);
    setError(null);
  };

  const runPreview = async () => {
    if (!baseUrl || !canContinue || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewLibraryImport(baseUrl, token, buildRequest(false)));
    } catch (previewError: unknown) {
      setError(errorMessage(previewError, "Could not preview import."));
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!baseUrl || !preview || busy || preview.totalImports === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await commitLibraryImport(baseUrl, token, buildRequest(true));
      onImported(
        successMessage(result.kind, result.totalImports, {
          projectPath,
          namespace: result.namespace,
          pluginName: result.plugin?.name,
          attachedProfile: result.attachedProfile,
        }),
      );
      onClose();
    } catch (importError: unknown) {
      setError(errorMessage(importError, "Could not import into library."));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return null;
  }

  const controlsDisabled = disabled || busy;

  return (
    <FullScreenPanel
      titleId="import-library-title"
      title="Import into library"
      eyebrow="Library"
      closeLabel="Close"
      closeDisabled={controlsDisabled}
      onClose={onClose}
      actions={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={controlsDisabled}>
            <X size={16} aria-hidden />
            Cancel
          </button>
          {preview ? (
            <button
              className={["btn", "primary", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
              type="button"
              data-testid="import-library-submit"
              onClick={() => void runImport()}
              disabled={controlsDisabled || preview.totalImports === 0}
              aria-busy={busy}
            >
              {busy ? <ButtonSpinner size={16} /> : <FolderDown size={16} aria-hidden />}
              {busy ? "Importing…" : "Import"}
            </button>
          ) : (
            <button
              className={["btn", "primary", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
              type="button"
              data-testid="import-library-submit"
              onClick={() => void runPreview()}
              disabled={!canContinue || controlsDisabled}
              aria-busy={busy}
            >
              {busy ? <ButtonSpinner size={16} /> : <Check size={16} aria-hidden />}
              {busy ? "Previewing…" : "Continue"}
            </button>
          )}
        </>
      }
    >
          <SourcePicker
            legend="Source"
            value={kind}
            disabled={controlsDisabled}
            onValueChange={(next) => {
              setKind(next as LibraryImportKind);
              invalidatePreview();
            }}
            options={[
              {
                value: "scan",
                title: "Project scan",
                description: "Import harness files from the selected project.",
                disabled: !hasProject,
                testId: "import-source-scan",
              },
              {
                value: "add",
                title: "Skill package",
                description: "Import skills from git or a local folder.",
                testId: "import-source-add",
              },
              {
                value: "from_project",
                title: "Plugin from-project",
                description: "Scan the project and create a plugin.",
                disabled: !hasProject,
                testId: "import-source-from-project",
              },
            ]}
          />
          {!hasProject ? (
            <p className="muted">
              Choose a project in the top bar to enable Project scan and Plugin from-project.
            </p>
          ) : null}

          {kind === "scan" || kind === "from_project" ? (
            <p className="muted" data-testid="import-project-path">{projectPath}</p>
          ) : null}

          {kind === "add" ? (
            <div className="flex flex-col gap-1.5">
              <Input
                data-testid="import-add-source"
                placeholder="owner/repo or git URL"
                value={addSource}
                disabled={controlsDisabled}
                onChange={(event) => {
                  setAddSource(event.target.value);
                  invalidatePreview();
                }}
              />
              <IconActionButton
                label="Choose folder…"
                disabled={controlsDisabled}
                onClick={() => {
                  void openDirectoryDialog({
                    directory: true,
                    multiple: false,
                    title: "Select skill package folder",
                  }).then((selected) => {
                    if (typeof selected === "string" && selected.length > 0) {
                      setAddSource(selected);
                      invalidatePreview();
                    }
                  });
                }}
                icon={<FolderOpen size={16} aria-hidden />}
              />
            </div>
          ) : null}

          {kind === "from_project" ? (
            <>
              <div>
                <Label htmlFor="import-plugin-name">Plugin name</Label>
                <Input
                  id="import-plugin-name"
                  placeholder="team-defaults"
                  value={pluginName}
                  disabled={controlsDisabled}
                  onChange={(event) => {
                    setPluginName(event.target.value);
                    invalidatePreview();
                  }}
                />
              </div>
              <div>
                <Label htmlFor="import-plugin-description">Description</Label>
                <Textarea
                  id="import-plugin-description"
                  rows={2}
                  value={pluginDescription}
                  disabled={controlsDisabled}
                  onChange={(event) => {
                    setPluginDescription(event.target.value);
                    invalidatePreview();
                  }}
                />
              </div>
            </>
          ) : null}

          {preview ? (
            <section className="create-preview" aria-label="Import preview">
              <div className="preview-count">
                <span>Ready to import</span>
                <strong>{preview.totalImports}</strong>
              </div>
              {preview.pluginExists ? (
                <div className="banner">Plugin exists</div>
              ) : null}
              {preview.warnings.map((warning) => (
                <div className="banner" key={warning}>{warning}</div>
              ))}
              <ul className={preview.items.length === 0 ? "muted" : undefined}>
                {preview.items.length === 0 ? (
                  <li className="muted">Nothing to import.</li>
                ) : (
                  preview.items.map((item, index) => (
                    <li key={`${item.type}-${item.name}-${index}`}>
                      {kind === "add"
                        ? `${item.name}${item.category ? ` · ${item.category}` : ""}${item.description ? ` — ${item.description}` : ""}`
                        : `${item.type} ${item.name}`}
                    </li>
                  ))
                )}
              </ul>
              {preview.conflicts.length > 0 ? (
                <>
                  <div>
                    <strong>{preview.conflicts.length} conflicts</strong>
                    <ul className="conflict-list">
                      {preview.conflicts.map((conflict, index) => (
                        <li key={`${conflictLabel(conflict)}-${index}`}>
                          {conflictLabel(conflict)}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <fieldset className="conflict-policy m-0 border-0 p-0" disabled={controlsDisabled}>
                    <legend className="mb-1.5 text-xs font-semibold">
                      When a resource already exists
                    </legend>
                    <RadioGroup
                      value={conflictPolicy}
                      onValueChange={(next) =>
                        setConflictPolicy(next as LibraryImportConflictPolicy)}
                      disabled={controlsDisabled}
                      className="flex flex-col gap-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem id="import-conflict-skip" value="skip" />
                        <Label htmlFor="import-conflict-skip" className="font-normal">
                          Keep the library version
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem id="import-conflict-overwrite" value="overwrite" />
                        <Label htmlFor="import-conflict-overwrite" className="font-normal">
                          Overwrite with imported content
                        </Label>
                      </div>
                    </RadioGroup>
                  </fieldset>
                </>
              ) : null}
              <div className="flex items-center gap-2">
                <input
                  id="import-attach-profile"
                  type="checkbox"
                  checked={attach && canAttach}
                  disabled={!canAttach || controlsDisabled}
                  onChange={(event) => setAttach(event.target.checked)}
                />
                <Label htmlFor="import-attach-profile" className="font-normal">
                  {canAttach
                    ? `Attach to ${selectedProfile}`
                    : "Attach to selected profile"}
                </Label>
              </div>
              {!canAttach ? (
                <p className="muted">Select a profile in the rail to attach.</p>
              ) : null}
            </section>
          ) : null}

          {error ? <div className="banner error">{error}</div> : null}
    </FullScreenPanel>
  );
}
