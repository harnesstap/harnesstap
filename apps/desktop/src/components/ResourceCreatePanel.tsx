import { useMemo, useRef, useState } from "react";
import { ButtonSpinner } from "./ButtonSpinner";
import { ConfirmDialog } from "./ConfirmDialog";
import { FullScreenPanel } from "./FullScreenPanel";
import { createLibraryResource } from "../lib/api/resource-create";
import { createLibraryPlugin } from "../lib/api/library-plugins";
import { AgentApiError } from "../lib/api/http";
import {
  buildCreateRequestBody,
  getResourceCreateSchema,
  initialValuesFor,
  validateValues,
  valuesAreDirty,
  visibleFields,
  type CreateFieldSpec,
  type CreateFormValues,
  type CreateResourceType,
} from "../lib/resource-create-schema";

export interface PickerResource {
  id: string;
  type: string;
  name: string;
  namespace: string | null;
}

export interface ResourceCreateTarget {
  kind: "resource" | "plugin-package";
  selector: string;
  label: string;
}

export interface ResourceCreatePanelProps {
  titleId: string;
  type: CreateResourceType;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  /** Profile targeted by the attach-and-apply checkbox; hidden when null. */
  attachProfileName: string | null;
  pickerResources: PickerResource[];
  onClose: () => void;
  onCreated: (target: ResourceCreateTarget) => void;
  onAddToProfile: (resource: { type: string; name: string }) => Promise<void>;
  onSuccess?: (message: string) => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function resourceSelector(resource: PickerResource): string {
  return resource.namespace
    ? `${resource.name}@${resource.namespace}`
    : resource.name;
}

interface FieldControlProps {
  id: string | undefined;
  spec: CreateFieldSpec;
  value: string | boolean;
  invalid: boolean;
  locked: boolean;
  onChange: (next: string | boolean) => void;
  onTouch: () => void;
}

function FieldControl({
  id,
  spec,
  value,
  invalid,
  locked,
  onChange,
  onTouch,
}: FieldControlProps) {
  const testId = `resource-create-field-${spec.key}`;
  if (spec.kind === "textarea") {
    return (
      <textarea
        id={id}
        className="resource-create-textarea"
        data-testid={testId}
        aria-label={spec.label}
        aria-invalid={invalid || undefined}
        placeholder={spec.placeholder}
        disabled={locked}
        value={String(value)}
        onBlur={onTouch}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (spec.kind === "select") {
    return (
      <select
        id={id}
        className="resource-create-select"
        data-testid={testId}
        aria-label={spec.label}
        disabled={locked}
        value={String(value)}
        onBlur={onTouch}
        onChange={(event) => {
          onTouch();
          onChange(event.target.value);
        }}
      >
        {(spec.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (spec.kind === "checkbox") {
    return (
      <span className="resource-create-checkline">
        <input
          type="checkbox"
          data-testid={testId}
          aria-label={spec.label}
          disabled={locked}
          checked={value === true}
          onChange={(event) => {
            onTouch();
            onChange(event.target.checked);
          }}
        />
        <span>{spec.placeholder ?? spec.label}</span>
      </span>
    );
  }
  return (
    <input
      id={id}
      className="resource-create-input"
      data-testid={testId}
      aria-label={spec.label}
      aria-invalid={invalid || undefined}
      type={spec.kind === "number" ? "number" : "text"}
      placeholder={spec.placeholder}
      disabled={locked}
      value={String(value)}
      onBlur={onTouch}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function ResourceCreatePanel({
  titleId,
  type,
  baseUrl,
  token,
  disabled = false,
  attachProfileName,
  pickerResources,
  onClose,
  onCreated,
  onAddToProfile,
  onSuccess,
}: ResourceCreatePanelProps) {
  const schema = getResourceCreateSchema(type);
  const initialRef = useRef<CreateFormValues>(initialValuesFor(schema));
  const [values, setValues] = useState<CreateFormValues>(initialRef.current);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [attachChecked, setAttachChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [nameServerError, setNameServerError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const errors = useMemo(() => validateValues(schema, values), [schema, values]);
  const isValid = Object.keys(errors).length === 0;
  const dirty = valuesAreDirty(values, initialRef.current);
  const locked = disabled || busy;
  const showAttachCheckbox = attachProfileName !== null && type !== "plugin";

  function requestClose(): void {
    if (busy) {
      return;
    }
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }

  function setValue(key: string, next: string | boolean): void {
    setValues((previous) => ({ ...previous, [key]: next }));
    if (key === "name") {
      setNameServerError(null);
    }
  }

  function touch(key: string): void {
    setTouched((previous) => ({ ...previous, [key]: true }));
  }

  function togglePicked(id: string): void {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function submit(): Promise<void> {
    if (!baseUrl || busy || disabled || !isValid) {
      return;
    }
    setBusy(true);
    setTopError(null);
    setNameServerError(null);
    const name = String(values.name).trim();
    try {
      let target: ResourceCreateTarget;
      if (type === "plugin") {
        const description = String(values.description).trim();
        const resources = pickerResources
          .filter((resource) => selectedIds.has(resource.id))
          .map((resource) => ({
            type: resource.type,
            selector: resourceSelector(resource),
          }));
        const created = await createLibraryPlugin(baseUrl, token, {
          name,
          ...(description ? { description } : {}),
          ...(resources.length > 0 ? { resources } : {}),
        });
        target = {
          kind: "plugin-package",
          selector: created.name,
          label: created.name,
        };
      } else {
        const created = await createLibraryResource(
          baseUrl,
          token,
          buildCreateRequestBody(schema, values),
        );
        target = {
          kind: "resource",
          selector: `${created.type}:${created.name}`,
          label: created.name,
        };
      }
      if (showAttachCheckbox && attachChecked && attachProfileName) {
        try {
          await onAddToProfile({ type, name });
        } catch (attachError: unknown) {
          onSuccess?.(
            `Created ${name}, but could not add it to ${attachProfileName}: ${errorMessage(attachError, "unknown error")}`,
          );
        }
      }
      onCreated(target);
    } catch (error: unknown) {
      if (error instanceof AgentApiError && error.code === "resource_conflict") {
        setNameServerError(errorMessage(error, "Could not create resource"));
      } else {
        setTopError(errorMessage(error, "Could not create resource"));
      }
    } finally {
      setBusy(false);
    }
  }

  const pickerGroups = useMemo(() => {
    const groups = new Map<string, PickerResource[]>();
    for (const resource of pickerResources) {
      const list = groups.get(resource.type) ?? [];
      list.push(resource);
      groups.set(resource.type, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [pickerResources]);

  return (
    <>
      <FullScreenPanel
        titleId={titleId}
        eyebrow="Library"
        title={`Create ${schema.title}`}
        subtitle={schema.description}
        closeLabel="Cancel resource creation"
        closeDisabled={busy}
        onClose={requestClose}
        testId="resource-create-panel"
        actions={
          <>
            <button
              type="button"
              className="btn"
              data-testid="resource-create-cancel"
              disabled={busy}
              onClick={requestClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className={busy ? "btn primary is-busy" : "btn primary"}
              data-testid="resource-create-submit"
              disabled={!isValid || busy || disabled}
              aria-busy={busy || undefined}
              onClick={() => {
                void submit();
              }}
            >
              {busy ? <ButtonSpinner size={14} /> : null}
              Create
            </button>
          </>
        }
      >
        {topError ? (
          <div className="banner error resource-create-banner" role="alert">
            {topError}
          </div>
        ) : null}
        <div className="resource-create-fields">
          {visibleFields(schema, values).map((spec) => {
            const error = spec.key === "name" && nameServerError
              ? nameServerError
              : touched[spec.key]
              ? errors[spec.key]
              : undefined;
            const controlId =
              spec.kind === "checkbox" ? undefined : `${titleId}-${spec.key}`;
            return (
              <div className="resource-create-field" key={spec.key}>
                {spec.kind !== "checkbox" ? (
                  <label htmlFor={controlId}>{spec.label}</label>
                ) : null}
                <FieldControl
                  id={controlId}
                  spec={spec}
                  value={values[spec.key] ?? ""}
                  invalid={Boolean(error)}
                  locked={locked}
                  onChange={(next) => setValue(spec.key, next)}
                  onTouch={() => touch(spec.key)}
                />
                {error ? (
                  <p className="resource-create-error" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}

          {schema.supportsComposition ? (
            <fieldset className="resource-create-field">
              <legend>Compose from library</legend>
              {pickerGroups.length === 0 ? (
                <p className="resource-picker-empty muted">
                  No library resources yet. The plugin can be composed later.
                </p>
              ) : (
                pickerGroups.map(([groupName, group]) => (
                  <div key={groupName}>
                    <p className="resource-picker-group">{groupName}</p>
                    {group.map((resource) => (
                      <label key={resource.id} className="resource-picker-row">
                        <input
                          type="checkbox"
                          data-testid={`resource-picker-row-${resource.type}-${resource.name}`}
                          disabled={locked}
                          checked={selectedIds.has(resource.id)}
                          onChange={() => togglePicked(resource.id)}
                        />
                        <span>{resourceSelector(resource)}</span>
                      </label>
                    ))}
                  </div>
                ))
              )}
            </fieldset>
          ) : null}

          {showAttachCheckbox ? (
            <span className="resource-create-checkline">
              <input
                type="checkbox"
                data-testid="resource-create-attach-profile"
                disabled={locked}
                checked={attachChecked}
                onChange={(event) => setAttachChecked(event.target.checked)}
              />
              <span>Add to {attachProfileName} and apply</span>
            </span>
          ) : null}
        </div>
      </FullScreenPanel>

      <ConfirmDialog
        open={discardOpen}
        title="Discard this resource?"
        description="This resource has not been created yet. Entered values will be lost."
        confirmLabel="Discard"
        onConfirm={() => {
          setDiscardOpen(false);
          onClose();
        }}
        onCancel={() => setDiscardOpen(false)}
      />
    </>
  );
}
