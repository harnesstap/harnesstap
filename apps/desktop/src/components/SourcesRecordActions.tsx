import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Library, Pin, Plus } from "lucide-react";
import {
  DISCOVER_ADD_TO_LIBRARY_LABEL,
  discoverActionHelper,
  discoverAddToProfileLabel,
  discoverAddToProfileTooltip,
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
  /** False when there is no profile to add to yet. */
  hasProfiles?: boolean;
  onAsNameChange?: (value: string) => void;
  onSignIn?: () => void;
  onAddToLibrary?: () => void;
  onAddToProfile?: () => void;
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
  hasProfiles = true,
  onAsNameChange,
  onSignIn,
  onAddToLibrary,
  onAddToProfile,
  onPinToPlugin,
  onOpenInLibrary,
}: SourcesRecordActionsProps) {
  const controlsDisabled = disabled || busy;
  const compact = variant === "list";
  const showHelper = variant === "detail";
  const showAddToLibrary = actions.showAddToLibrary;
  // Rows stay light: Add to profile and Add to Library as icons; Pin lives in the detail view.
  const showPinToPlugin = !compact && actions.showPinToPlugin;
  const showOpenInLibrary = !compact && actions.showOpenInLibrary;
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
        {actions.showAddToProfile ? (
          <IconActionButton
            primary={!compact}
            showLabel={!compact}
            busy={busy}
            spinnerSize={14}
            disabled={controlsDisabled || !hasProfiles || (collision && !asName.trim())}
            label={discoverAddToProfileLabel()}
            title={discoverAddToProfileTooltip(hasProfiles)}
            onClick={onAddToProfile}
            icon={<Plus size={16} aria-hidden />}
          />
        ) : null}
        {showAddToLibrary ? (
          <IconActionButton
            showLabel={!compact}
            busy={busy}
            spinnerSize={14}
            disabled={controlsDisabled || (collision && !asName.trim())}
            label={DISCOVER_ADD_TO_LIBRARY_LABEL}
            title={DISCOVER_ADD_TO_LIBRARY_LABEL}
            onClick={onAddToLibrary}
            icon={<Download size={16} aria-hidden />}
          />
        ) : null}
        {showPinToPlugin ? (
          <IconActionButton
            label="Pin to plugin"
            title={PIN_TO_PLUGIN_TOOLTIP}
            disabled={controlsDisabled}
            onClick={onPinToPlugin}
            icon={<Pin size={16} aria-hidden />}
          />
        ) : null}
        {showOpenInLibrary ? (
          <IconActionButton
            primary={!actions.showAddToLibrary && !actions.showAddToProfile}
            showLabel={!actions.showAddToLibrary && !actions.showAddToProfile}
            label="Open in Library"
            disabled={controlsDisabled || !actions.openInLibrarySelector}
            onClick={onOpenInLibrary}
            icon={<Library size={16} aria-hidden />}
          />
        ) : null}
      </div>
      {showHelper ? (
        <p className="muted sources-action-helper" data-testid="discover-action-helper">
          {discoverActionHelper()}
        </p>
      ) : null}
    </div>
  );
}
