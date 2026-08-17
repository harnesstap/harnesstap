import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { AlignLeft } from "lucide-react";
import { fieldKeyAction } from "../lib/library-field-edit";
import { LibraryDetailChrome } from "./LibraryDetailChrome";
import { LibraryFieldRow } from "./LibraryFieldRow";

export interface PluginCreateDraftProps {
  titleId: string;
  name: string;
  description: string;
  nameError: string | null;
  disabled?: boolean;
  busy?: boolean;
  onDraftChange: (next: { name: string; description: string }) => void;
  onNameCommit: (reason: "enter" | "blur") => void;
  onBack: () => void;
  onLeavePointerDown: () => void;
  onFieldEditingChange: (editing: boolean) => void;
}

function descriptionNeedsTextarea(value: string): boolean {
  return value.includes("\n") || value.length > 80;
}

export function PluginCreateDraft({
  titleId,
  name,
  description,
  nameError,
  disabled = false,
  busy = false,
  onDraftChange,
  onNameCommit,
  onBack,
  onLeavePointerDown,
  onFieldEditingChange,
}: PluginCreateDraftProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const descriptionSnapshotRef = useRef(description);
  const descriptionEditingRef = useRef(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(description);
  const fieldsLocked = disabled || busy;

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    onFieldEditingChange(editingDescription);
  }, [editingDescription, onFieldEditingChange]);

  useEffect(() => {
    if (editingDescription) {
      descriptionRef.current?.focus();
    }
  }, [editingDescription]);

  function startDescriptionEdit(): void {
    if (fieldsLocked) {
      return;
    }
    descriptionSnapshotRef.current = description;
    descriptionEditingRef.current = true;
    setDescriptionDraft(description);
    setEditingDescription(true);
  }

  function commitDescription(value: string): void {
    if (!descriptionEditingRef.current) {
      return;
    }
    descriptionEditingRef.current = false;
    setEditingDescription(false);
    onDraftChange({ name, description: value });
  }

  function cancelDescription(): void {
    descriptionEditingRef.current = false;
    const previous = descriptionSnapshotRef.current;
    setDescriptionDraft(previous);
    setEditingDescription(false);
    onDraftChange({ name, description: previous });
  }

  function onNameKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const action = fieldKeyAction(event.key);
    switch (action) {
      case "commit":
        event.preventDefault();
        onNameCommit("enter");
        return;
      case "cancel":
      case null:
        return;
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  }

  function onDescriptionKeyDown(
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void {
    const action = fieldKeyAction(event.key, {
      multiline: event.currentTarget.tagName === "TEXTAREA",
    });
    switch (action) {
      case "commit":
        event.preventDefault();
        commitDescription(event.currentTarget.value);
        return;
      case "cancel":
        event.preventDefault();
        event.stopPropagation();
        cancelDescription();
        return;
      case null:
        return;
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  }

  const descriptionMultiline = descriptionNeedsTextarea(descriptionDraft);
  const descriptionEditor: ReactNode = descriptionMultiline ? (
    <textarea
      ref={descriptionRef as Ref<HTMLTextAreaElement>}
      className="library-field-editor"
      value={descriptionDraft}
      aria-label="Description"
      disabled={fieldsLocked}
      rows={4}
      onChange={(event) => {
        setDescriptionDraft(event.target.value);
        onDraftChange({ name, description: event.target.value });
      }}
      onBlur={(event) => commitDescription(event.target.value)}
      onKeyDown={onDescriptionKeyDown}
    />
  ) : (
    <input
      ref={descriptionRef as Ref<HTMLInputElement>}
      className="library-field-editor"
      value={descriptionDraft}
      aria-label="Description"
      disabled={fieldsLocked}
      onChange={(event) => {
        setDescriptionDraft(event.target.value);
        onDraftChange({ name, description: event.target.value });
      }}
      onBlur={(event) => commitDescription(event.target.value)}
      onKeyDown={onDescriptionKeyDown}
    />
  );

  return (
    <LibraryDetailChrome
      titleId={titleId}
      typeLabel="plugin"
      onBack={onBack}
      onBackPointerDown={onLeavePointerDown}
      preserveFocusOnBack
      backDisabled={busy}
      title={
        <input
          ref={nameRef}
          className="library-detail-title-input"
          value={name}
          aria-label="Name"
          aria-invalid={nameError ? true : undefined}
          disabled={fieldsLocked}
          onChange={(event) =>
            onDraftChange({ name: event.target.value, description })
          }
          onBlur={() => onNameCommit("blur")}
          onKeyDown={onNameKeyDown}
        />
      }
    >
      {nameError ? (
        <p className="library-field-error">{nameError}</p>
      ) : null}
      <LibraryFieldRow
        icon={<AlignLeft size={16} aria-hidden />}
        fieldName="Description"
        readOnly={fieldsLocked}
        display={description}
        placeholder="No description"
        editing={editingDescription}
        onStartEdit={startDescriptionEdit}
      >
        {descriptionEditor}
      </LibraryFieldRow>
      <p className="muted">Composition unlocks after the plugin is named.</p>
    </LibraryDetailChrome>
  );
}
