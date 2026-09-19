import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Library, Pin } from "lucide-react";
import {
  DISCOVER_ACTION_HELPER,
  PIN_TO_PLUGIN_TOOLTIP,
  type SourcesHitActions,
} from "../lib/sources-record-actions";
import { IconActionButton } from "./IconActionButton";
import { SourcesSignInPrompt } from "./SourcesListPane";

export interface SourcesRecordActionsProps {
  actions: SourcesHitActions;
  variant?: "list" | "detail";
  busy?: boolean;
  disabled?: boolean;
  error?: string | null;
  authRequired?: boolean;
  collision?: boolean;
  asName?: string;
  onAsNameChange?: (value: string) => void;
  onSignIn?: () => void;
  onAddToLibrary?: () => void;
  onPinToPlugin?: () => void;
  onOpenInLibrary?: () => void;
}

export function SourcesRecordActions({
  actions,
  variant = "detail",
  busy = false,
  disabled = false,
  error = null,
  authRequired = false,
  collision = false,
  asName = "",
  onAsNameChange,
  onSignIn,
  onAddToLibrary,
  onPinToPlugin,
  onOpenInLibrary,
}: SourcesRecordActionsProps) {
  const controlsDisabled = disabled || busy;
  const compact = variant === "list";
  const showHelper = variant === "detail";
  return (
    <div
      className="sources-record-actions"
      onClick={(event) => event.stopPropagation()}
    >
      {!compact && authRequired ? (
        <SourcesSignInPrompt onSignIn={onSignIn} disabled={controlsDisabled} />
      ) : !compact && error ? (
        <div className="banner error" role="alert">
          {error}
        </div>
      ) : null}
      {!compact && collision ? (
        <div className="form-field gap-1.5">
          <Label htmlFor="sources-add-as">Add as</Label>
          <Input
            id="sources-add-as"
            value={asName}
            onChange={(event) => onAsNameChange?.(event.target.value)}
            placeholder="local-plugin-name"
            disabled={controlsDisabled}
          />
        </div>
      ) : null}
      <div className="library-detail-actions sources-record-action-cluster">
        {actions.showAddToLibrary ? (
          <IconActionButton
            primary
            showLabel
            busy={busy}
            spinnerSize={14}
            disabled={controlsDisabled || (collision && !asName.trim())}
            label="Add to Library"
            onClick={onAddToLibrary}
            icon={<Download size={16} aria-hidden />}
          />
        ) : null}
        {actions.showPinToPlugin ? (
          <IconActionButton
            label="Pin to plugin"
            title={PIN_TO_PLUGIN_TOOLTIP}
            disabled={controlsDisabled}
            onClick={onPinToPlugin}
            icon={<Pin size={16} aria-hidden />}
          />
        ) : null}
        {actions.showOpenInLibrary ? (
          <IconActionButton
            primary={!actions.showAddToLibrary}
            showLabel={!actions.showAddToLibrary}
            label="Open in Library"
            disabled={controlsDisabled || !actions.openInLibrarySelector}
            onClick={onOpenInLibrary}
            icon={<Library size={16} aria-hidden />}
          />
        ) : null}
      </div>
      {showHelper ? (
        <p className="muted sources-action-helper" data-testid="discover-action-helper">
          {DISCOVER_ACTION_HELPER}
        </p>
      ) : null}
    </div>
  );
}
