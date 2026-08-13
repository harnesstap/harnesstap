import { useCallback, useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  fetchCatalogBindings,
  putCatalogBindings,
  type CatalogBindingsView,
  type CatalogBindingMode,
  type PublishCatalogRef,
} from "../../lib/api/publish";

export interface ProfileCatalogBindingsProps {
  profileName: string | null;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function catalogKey(catalog: Pick<PublishCatalogRef, "org" | "catalog">): string {
  return `${catalog.org}/${catalog.catalog}`;
}

export function ProfileCatalogBindings({
  profileName,
  baseUrl,
  token,
  disabled = false,
}: ProfileCatalogBindingsProps) {
  const [view, setView] = useState<CatalogBindingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadBindings = useCallback(async () => {
    if (!profileName || !baseUrl) {
      setView(null);
      return;
    }
    try {
      const next = await fetchCatalogBindings(baseUrl, token, profileName);
      setView(next);
      setError(null);
    } catch (loadError) {
      setView(null);
      setError(errorMessage(loadError, "Could not load catalog bindings."));
    }
  }, [baseUrl, profileName, token]);

  useEffect(() => {
    void loadBindings();
  }, [loadBindings]);

  if (!profileName) {
    return null;
  }

  const controlsDisabled = disabled || saving || !baseUrl;
  const mode: CatalogBindingMode = view?.mode ?? "all_registered";

  const save = async (
    body:
      | { mode: "all_registered" }
      | { mode: "explicit"; allowList: Array<{ org: string; catalog: string }> },
  ) => {
    if (!baseUrl || saving) {
      return;
    }
    setSaving(true);
    setHint(null);
    try {
      const next = await putCatalogBindings(baseUrl, token, profileName, body);
      setView(next);
      setError(null);
    } catch (saveError) {
      setError(errorMessage(saveError, "Could not save catalog bindings."));
    } finally {
      setSaving(false);
    }
  };

  const onModeChange = (nextMode: string) => {
    if (nextMode === mode || controlsDisabled) {
      return;
    }
    if (nextMode === "all_registered") {
      void save({ mode: "all_registered" });
      return;
    }
    if (!view || view.registered.length === 0) {
      setHint("Register catalogs in Settings first.");
      return;
    }
    const seed = (view.allowList.length > 0 ? view.allowList : view.registered).map(
      (entry) => ({ org: entry.org, catalog: entry.catalog }),
    );
    void save({ mode: "explicit", allowList: seed });
  };

  const selectedKeys = new Set(
    (view?.allowList.length ? view.allowList : view?.registered ?? []).map(catalogKey),
  );

  const onToggle = (catalog: PublishCatalogRef, checked: boolean) => {
    if (!view || controlsDisabled) {
      return;
    }
    const current = view.allowList.length > 0 ? view.allowList : view.registered;
    if (!checked && current.length <= 1) {
      setHint("Select at least one catalog, or use all registered.");
      return;
    }
    const next = checked
      ? [...current.filter((entry) => catalogKey(entry) !== catalogKey(catalog)), catalog]
      : current.filter((entry) => catalogKey(entry) !== catalogKey(catalog));
    void save({
      mode: "explicit",
      allowList: next.map((entry) => ({ org: entry.org, catalog: entry.catalog })),
    });
  };

  return (
    <details className="edit-metadata-details" data-testid="profile-catalog-bindings">
      <summary>Advanced</summary>
      <section aria-label="Publish catalogs">
        <h3>Publish catalogs</h3>
        {error ? (
          <div className="banner error" role="alert">
            {error}
          </div>
        ) : null}
        {hint ? <p className="muted">{hint}</p> : null}
        <RadioGroup
          value={mode}
          onValueChange={onModeChange}
          disabled={controlsDisabled}
          className="flex flex-col gap-1.5"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem id="publish-all-registered" value="all_registered" />
            <Label htmlFor="publish-all-registered" className="font-normal">
              All registered catalogs
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem id="publish-explicit" value="explicit" />
            <Label htmlFor="publish-explicit" className="font-normal">
              Selected catalogs
            </Label>
          </div>
        </RadioGroup>
        {mode === "explicit" && view && view.registered.length === 0 ? (
          <p className="muted">Register catalogs in Settings first.</p>
        ) : null}
        {mode === "explicit" && view && view.registered.length > 0 ? (
          <ul className="publish-binding-list">
            {view.registered.map((catalog) => {
              const key = catalogKey(catalog);
              return (
                <li key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={`publish-binding-${key}`}
                    checked={selectedKeys.has(key)}
                    disabled={controlsDisabled}
                    onCheckedChange={(next) => onToggle(catalog, next === true)}
                  />
                  <Label htmlFor={`publish-binding-${key}`} className="font-normal">
                    {key}
                  </Label>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </details>
  );
}
