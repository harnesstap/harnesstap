import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Library, Link, Pin, Plus } from "lucide-react";
import {
  DISCOVER_ADD_TO_LIBRARY_LABEL,
  DISCOVER_ADD_TO_LIBRARY_TOOLTIP,
  DISCOVER_IN_LIBRARY_LINK_TOOLTIP,
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
  hitName?: string;
  currentProfileName?: string | null;
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
  hitName = "",
  currentProfileName = null,
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
  const showPinToPlugin = compact
    ? actions.showPinToPlugin && !actions.showAddToLibrary
    : actions.showPinToPlugin;
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
            primary
            showLabel
            busy={busy}
            spinnerSize={14}
            disabled={controlsDisabled || !currentProfileName || (collision && !asName.trim())}
            label={discoverAddToProfileLabel()}
            title={discoverAddToProfileTooltip(hitName, currentProfileName)}
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
            label={compact ? DISCOVER_ADD_TO_LIBRARY_TOOLTIP : DISCOVER_ADD_TO_LIBRARY_LABEL}
            title={compact ? DISCOVER_ADD_TO_LIBRARY_TOOLTIP : undefined}
            onClick={onAddToLibrary}
            icon={<Download size={16} aria-hidden />}
          />
        ) : null}
        {showPinToPlugin ? (
          <IconActionButton
            label={compact ? DISCOVER_IN_LIBRARY_LINK_TOOLTIP : "Pin to plugin"}
            title={compact ? DISCOVER_IN_LIBRARY_LINK_TOOLTIP : PIN_TO_PLUGIN_TOOLTIP}
            disabled={controlsDisabled}
            onClick={onPinToPlugin}
            icon={compact ? <Link size={16} aria-hidden /> : <Pin size={16} aria-hidden />}
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
          {discoverActionHelper(currentProfileName)}
        </p>
      ) : null}
    </div>
  );
}
