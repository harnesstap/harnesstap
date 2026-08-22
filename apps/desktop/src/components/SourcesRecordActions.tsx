import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SourcesHitActions } from "../lib/sources-record-actions";
import { ButtonSpinner } from "./ButtonSpinner";
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
          <button
            type="button"
            className={["btn", "primary", busy ? "is-busy" : ""]
              .filter(Boolean)
              .join(" ")}
            disabled={controlsDisabled || (collision && !asName.trim())}
            onClick={onPull}
            aria-busy={busy}
          >
            {busy ? <ButtonSpinner size={14} /> : null}
            Pull
          </button>
        ) : null}
        {actions.showPinToPlugin ? (
          <button
            type="button"
            className="btn"
            disabled={controlsDisabled}
            onClick={onPinToPlugin}
          >
            Pin to plugin
          </button>
        ) : null}
        {actions.showAttachToPlugin ? (
          <button
            type="button"
            className="btn"
            disabled={controlsDisabled}
            onClick={onAttachToPlugin}
          >
            Attach to plugin
          </button>
        ) : null}
        {actions.showOpenInLibrary ? (
          <button
            type="button"
            className="btn"
            disabled={controlsDisabled || !actions.openInLibrarySelector}
            onClick={onOpenInLibrary}
          >
            Open in Library
          </button>
        ) : null}
      </div>
    </div>
  );
}