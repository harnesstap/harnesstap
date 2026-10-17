import { useCallback, useEffect, useState } from "react";
import {
  fetchUpdateSettings,
  saveUpdateSettings,
  type UpdateSettings,
} from "../../lib/api/settings-updates";
import { updateSettingsSummary } from "../../lib/update-settings-copy";
import { toast } from "../../state/toast-store";
import { UpdatePreferenceFields } from "./UpdatePreferenceFields";

export interface PluginUpdateSettingsProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
}

/** Settings > Advanced: how plugin updates are checked and installed. Saves inline. */
export function PluginUpdateSettings({ open, baseUrl, token, disabled = false }: PluginUpdateSettingsProps) {
  const [settings, setSettings] = useState<UpdateSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!open || !baseUrl) return;
    try {
      setSettings(await fetchUpdateSettings(baseUrl, token));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load plugin update settings.");
    }
  }, [baseUrl, open, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Partial<UpdateSettings>) => {
    if (!baseUrl || !settings) return;
    setBusy(true);
    try {
      const next = await saveUpdateSettings(baseUrl, token, { ...patch, prompted: true });
      setSettings(next);
      setError(null);
      toast({ tone: "success", title: updateSettingsSummary(next) });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save plugin update settings.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" data-testid="plugin-update-settings">
      <h3>Plugin updates</h3>
      <p className="field-note muted">
        How HarnessTap checks pulled plugins and kept-in-sync profiles for newer versions.
      </p>
      {error ? (
        <div className="banner error" role="alert">
          {error}
        </div>
      ) : null}
      {settings ? (
        <UpdatePreferenceFields
          idPrefix="settings-updates"
          legend="Mode"
          className="mb-6"
          mode={settings.mode}
          frequency={settings.frequency}
          disabled={disabled || busy}
          onModeChange={(mode) => void save({ mode })}
          onFrequencyChange={(frequency) => void save({ frequency })}
        />
      ) : null}
    </section>
  );
}
