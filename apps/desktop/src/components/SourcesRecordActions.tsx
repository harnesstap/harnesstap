import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Library, Paperclip, Pin } from "lucide-react";
import type { SourcesHitActions } from "../lib/sources-record-actions";
import { IconActionButton } from "./IconActionButton";
import { SourcesSignInPrompt } from "./SourcesListPane";

export interface SourcesRecordActionsProps {
  actions: SourcesHitActions;
  busy?: boolean;
  disabled?: boolean;
  error?: string | null;
  authRequired?: boolean;
  collision?: boolean;
  asName?: string;
  onAsNameChange?: (value: string) => void;
  onSignIn?: () => void;
  onPull?: () => void;
  onPinToPlugin?: () => void;
  onAttachToPlugin?: () => void;
  onOpenInLibrary?: () => void;
}

export function SourcesRecordActions({
  actions,
  busy = false,
  disabled = false,
  error = null,
  authRequired = false,
  collision = false,
  asName = "",
  onAsNameChange,
  onSignIn,
  onPull,
  onPinToPlugin,
  onAttachToPlugin,
  onOpenInLibrary,
}: SourcesRecordActionsProps) {
  const controlsDisabled = disabled || busy;
  return (
    <div className="sources-record-actions">
      {authRequired ? (
        <SourcesSignInPrompt onSignIn={onSignIn} disabled={controlsDisabled} />
      ) : error ? (
        <div className="banner error" role="alert">
          {error}
        </div>
      ) : null}
      {collision ? (
        <div className="form-field gap-1.5">
          <Label htmlFor="sources-pull-as">Pull as</Label>
          <Input
            id="sources-pull-as"
            value={asName}
            onChange={(event) => onAsNameChange?.(event.target.value)}
            placeholder="local-plugin-name"
            disabled={controlsDisabled}
          />
        </div>
      ) : null}
      <div className="library-detail-actions sources-record-action-cluster">
        {actions.showPull ? (
          <IconActionButton
            primary
            busy={busy}
            spinnerSize={14}
            disabled={controlsDisabled || (collision && !asName.trim())}
            label="Pull"
            onClick={onPull}
            icon={<Download size={16} aria-hidden />}
          />
        ) : null}
        {actions.showPinToPlugin ? (
          <IconActionButton
            label="Pin to plugin"
            disabled={controlsDisabled}
            onClick={onPinToPlugin}
            icon={<Pin size={16} aria-hidden />}
          />
        ) : null}
        {actions.showAttachToPlugin ? (
          <IconActionButton
            label="Attach to plugin"
            disabled={controlsDisabled}
            onClick={onAttachToPlugin}
            icon={<Paperclip size={16} aria-hidden />}
          />
        ) : null}
        {actions.showOpenInLibrary ? (
          <IconActionButton
            label="Open in Library"
            disabled={controlsDisabled || !actions.openInLibrarySelector}
            onClick={onOpenInLibrary}
            icon={<Library size={16} aria-hidden />}
          />
        ) : null}
      </div>
    </div>
  );
}