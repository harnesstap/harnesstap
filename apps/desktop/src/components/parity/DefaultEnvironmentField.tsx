import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentApiError, fetchEnvironments } from "../../lib/agent-client";
import {
  fetchProfileDefaultEnvironment,
  patchProfileDefaultEnvironment,
} from "../../lib/api/profile-default-env";
import {
  DEFAULT_ENV_CREATE,
  DEFAULT_ENV_NONE,
  defaultEnvironmentSelectValue,
  interpretDefaultEnvironmentChoice,
} from "../../lib/default-environment-picker";
import type { LibraryEnvironment } from "../../lib/types";

export interface DefaultEnvironmentFieldProps {
  profileName: string;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onMutated?: (input: {
    profileName: string;
    affectsApply: boolean;
  }) => void | Promise<void>;
  onCreateEnvironment?: () => void;
}

export interface DefaultEnvironmentPickerProps {
  value: string | null;
  environments: LibraryEnvironment[];
  disabled?: boolean;
  listLoading?: boolean;
  listError?: string | null;
  onChange: (name: string) => void;
  onClear: () => void;
  onCreateEnvironment?: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof AgentApiError && error.message) {
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}

export function DefaultEnvironmentPicker({
  value,
  environments,
  disabled = false,
  listLoading = false,
  listError = null,
  onChange,
  onClear,
  onCreateEnvironment,
}: DefaultEnvironmentPickerProps) {
  const empty = !listLoading && environments.length === 0;
  const selectDisabled = disabled || listLoading || Boolean(listError);
  const clearDisabled = disabled || value === null || listLoading;

  return (
    <div className="form-field gap-1.5">
      <Label htmlFor="profile-default-environment">Default environment</Label>
      {listError ? (
        <div className="banner error" role="alert">
          {listError}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="icon-action"
          data-testid="default-environment-clear"
          disabled={clearDisabled}
          onClick={onClear}
          aria-label="Clear"
          title="Clear"
        >
          <X size={16} strokeWidth={2} aria-hidden />
        </button>
        <Select
          value={defaultEnvironmentSelectValue(value)}
          onValueChange={(next) => {
            const choice = interpretDefaultEnvironmentChoice(next);
            if (choice === "create") {
              onCreateEnvironment?.();
              return;
            }
            if (choice === "none") {
              onClear();
              return;
            }
            onChange(choice.name);
          }}
          disabled={selectDisabled}
        >
          <SelectTrigger id="profile-default-environment" className="w-full">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_ENV_NONE}>None</SelectItem>
            {environments.map((environment) => (
              <SelectItem key={environment.id} value={environment.name}>
                {environment.name}
              </SelectItem>
            ))}
            {onCreateEnvironment ? (
              <SelectItem value={DEFAULT_ENV_CREATE}>
                <Plus size={14} strokeWidth={2} aria-hidden />
                Create a new environment
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
      </div>
      {empty ? <p className="muted">No environments yet.</p> : null}
    </div>
  );
}

export function DefaultEnvironmentField({
  profileName,
  baseUrl,
  token,
  disabled = false,
  onMutated,
  onCreateEnvironment,
}: DefaultEnvironmentFieldProps) {
  const [value, setValue] = useState<string | null>(null);
  const [environments, setEnvironments] = useState<LibraryEnvironment[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mutateError, setMutateError] = useState<string | null>(null);

  useEffect(() => {
    if (!baseUrl) {
      return;
    }
    let cancelled = false;
    setListLoading(true);
    setListError(null);
    setMutateError(null);
    void fetchProfileDefaultEnvironment(baseUrl, token, profileName)
      .then((binding) => {
        if (!cancelled) {
          setValue(binding.defaultEnvironment);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setMutateError(
            errorMessage(loadError, "Could not load default environment"),
          );
        }
      });
    void fetchEnvironments(baseUrl, token)
      .then((list) => {
        if (!cancelled) {
          setEnvironments(list.environments);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setListError(errorMessage(loadError, "Could not load environments"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setListLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token, profileName]);

  const commit = async (next: string | null) => {
    if (!baseUrl) {
      return;
    }
    const previous = value;
    setBusy(true);
    setMutateError(null);
    setValue(next);
    try {
      const result = await patchProfileDefaultEnvironment(
        baseUrl,
        token,
        profileName,
        next,
      );
      setValue(result.defaultEnvironment);
      await onMutated?.({ profileName, affectsApply: true });
    } catch (commitError: unknown) {
      setValue(previous);
      setMutateError(
        errorMessage(commitError, "Could not update default environment"),
      );
    } finally {
      setBusy(false);
    }
  };

  const controlsDisabled = disabled || busy || !baseUrl;

  return (
    <section className="edit-profile-section" aria-label="Default environment">
      {mutateError ? (
        <div className="banner error" role="alert">
          {mutateError}
        </div>
      ) : null}
      <DefaultEnvironmentPicker
        value={value}
        environments={environments}
        disabled={controlsDisabled}
        listLoading={listLoading}
        listError={listError}
        onChange={(name) => {
          void commit(name);
        }}
        onClear={() => {
          void commit(null);
        }}
        onCreateEnvironment={onCreateEnvironment}
      />
    </section>
  );
}
