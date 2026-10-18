import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { IconActionButton } from "../IconActionButton";
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
  DEFAULT_ENV_COPY,
  DEFAULT_ENV_CREATE,
  defaultEnvironmentFieldState,
  firstEnvironmentName,
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
  const state = defaultEnvironmentFieldState(value);
  const first = firstEnvironmentName(environments);
  const addDisabled = disabled || listLoading || Boolean(listError) || (!first && !onCreateEnvironment);
  // Keep keyboard focus on the field when Add or the x swaps the control.
  const rowRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    rowRef.current?.querySelector<HTMLElement>(state === "set" ? "#profile-default-environment" : "[data-testid=default-environment-add]")?.focus();
  }, [state]);

  return (
    <div className="form-field gap-1.5">
      <Label htmlFor={state === "set" ? "profile-default-environment" : undefined}>
        {DEFAULT_ENV_COPY.label}
      </Label>
      {listError ? (
        <div className="banner error" role="alert">
          {listError}
        </div>
      ) : null}
      {/* One fixed-height row for both states, so switching never shifts the pane. */}
      <div className="default-env-row" data-state={state} ref={rowRef}>
        {state === "empty" ? (
          <IconActionButton
            className="default-env-add"
            data-testid="default-environment-add"
            showLabel
            label={DEFAULT_ENV_COPY.add}
            title={DEFAULT_ENV_COPY.addTooltip}
            disabled={addDisabled}
            onClick={() => {
              if (first) {
                moveFocus.current = true;
                onChange(first);
              } else {
                onCreateEnvironment?.();
              }
            }}
            icon={<Plus size={16} strokeWidth={2} aria-hidden />}
          />
        ) : (
          <>
            <Select
              value={value ?? undefined}
              onValueChange={(next) => {
                const choice = interpretDefaultEnvironmentChoice(next);
                if (choice === "create") {
                  onCreateEnvironment?.();
                  return;
                }
                onChange(choice.name);
              }}
              disabled={disabled || listLoading || Boolean(listError)}
            >
              <SelectTrigger id="profile-default-environment" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {environments.map((environment) => (
                  <SelectItem key={environment.id} value={environment.name}>
                    {environment.name}
                  </SelectItem>
                ))}
                {onCreateEnvironment ? (
                  <SelectItem value={DEFAULT_ENV_CREATE}>
                    <Plus size={14} strokeWidth={2} aria-hidden />
                    {DEFAULT_ENV_COPY.create}
                  </SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            <IconActionButton
              data-testid="default-environment-clear"
              label={DEFAULT_ENV_COPY.remove}
              disabled={disabled || listLoading}
              onClick={() => {
                moveFocus.current = true;
                onClear();
              }}
              icon={<X size={16} strokeWidth={2} aria-hidden />}
            />
          </>
        )}
      </div>
      {empty && state === "empty" ? <p className="muted">{DEFAULT_ENV_COPY.none}</p> : null}
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
    <section className="edit-profile-section" aria-label={DEFAULT_ENV_COPY.label}>
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
