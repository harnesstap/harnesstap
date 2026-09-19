import type { MouseEvent, ReactNode } from "react";
import { CircleAlert, FileDiff, Plus, Power, Trash2 } from "lucide-react";
import {
  inventoryMembershipCaption,
  profileInventoryOpenTarget,
  type ProfileInventoryItem,
} from "../../lib/profile-inventory";
import { hoverModelFromProfileResource } from "../../lib/resource-hover";
import { ButtonSpinner } from "../ButtonSpinner";
import { ChromeTooltip } from "../ChromeTooltip";
import { IconActionButton } from "../IconActionButton";
import { TypeIcon } from "../TypeIcon";
import {
  ResourceRowDescription,
  ResourceRowIdentity,
  ResourceRowLeading,
  ResourceRowRoot,
  ResourceRowTrailing,
} from "../ui/resource-row";
import type { ResourceDetailTarget } from "../ResourceDetailPane";
import { ICON_SIZE, resourceDetailTarget } from "./shared";

function stopRowActivate(event: MouseEvent) {
  event.stopPropagation();
}

export interface InventoryRowProps {
  item: ProfileInventoryItem;
  editMode: boolean;
  profileName: string | null;
  pending: boolean;
  selectedIsActive: boolean;
  onAdd?: () => void;
  onActivate?: () => void;
  onOpenResource: (target: ResourceDetailTarget) => void;
  onOpenPlugin?: (pluginName: string) => void;
  onDiff?: () => void;
  onRemoveFromProfile?: () => void;
}

export function InventoryRow({
  item,
  editMode,
  profileName,
  pending,
  selectedIsActive,
  onAdd,
  onActivate,
  onOpenResource,
  onOpenPlugin,
  onDiff,
  onRemoveFromProfile,
}: InventoryRowProps) {
  const inProfile = item.section !== "not_in_profile";
  const membershipCaption = inventoryMembershipCaption(item.pluginName, profileName);
  const drifted = item.section === "active" && item.drifted;
  const showActivate =
    !editMode && item.section === "inactive" && selectedIsActive && Boolean(onActivate);
  const openRow = () => {
    const target = profileInventoryOpenTarget(item);
    if (target.kind === "plugin-package") {
      if (target.name) {
        onOpenPlugin?.(target.name);
      }
      return;
    }
    onOpenResource(resourceDetailTarget(target.resource));
  };

  let action: ReactNode = null;
  if (pending) {
    action = <ButtonSpinner size={ICON_SIZE} />;
  } else if (drifted && onDiff) {
    action = (
      <IconActionButton
        className="file-change-diff-btn"
        label={`View changes for ${item.label}`}
        title="View changes"
        onClick={onDiff}
        icon={<FileDiff size={ICON_SIZE} strokeWidth={2} aria-hidden />}
      />
    );
  } else if (item.section === "not_in_profile" && onAdd) {
    action = (
      <IconActionButton
        className="untracked-add-btn"
        showLabel
        spinnerSize={ICON_SIZE}
        label="Add"
        title={`Add ${item.label} to this profile`}
        onClick={onAdd}
        icon={<Plus size={ICON_SIZE} strokeWidth={2} aria-hidden />}
      />
    );
  } else if (showActivate && onActivate) {
    action = (
      <IconActionButton
        showLabel
        spinnerSize={ICON_SIZE}
        label="Activate"
        title={`Activate ${item.label}`}
        onClick={onActivate}
        icon={<Power size={ICON_SIZE} strokeWidth={2} aria-hidden />}
      />
    );
  }

  return (
    <ResourceRowRoot
      hover={hoverModelFromProfileResource(item.resource)}
      testId={`resource-row-${item.resource.name}`}
      className={[
        "inventory-row",
        drifted ? "inventory-row-drifted m-status" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onActivate={openRow}
    >
      <ResourceRowLeading className="inventory-row-lead">
        {drifted ? (
          <ChromeTooltip content="Active, differs from disk" side="top">
            <span
              className="inventory-row-icon inventory-status-glyph m-status"
              aria-label="Active, differs from disk"
              role="img"
            >
              <CircleAlert size={ICON_SIZE} strokeWidth={2} aria-hidden />
            </span>
          </ChromeTooltip>
        ) : null}
        <span className="inventory-row-icon" aria-hidden>
          <TypeIcon type={item.type} />
        </span>
      </ResourceRowLeading>
      <ResourceRowIdentity label={item.label}>
        {membershipCaption ? (
          <ResourceRowDescription>{membershipCaption}</ResourceRowDescription>
        ) : null}
      </ResourceRowIdentity>
      <ResourceRowTrailing>
        <span className="inventory-row-action" onClick={stopRowActivate}>
          {inProfile ? (
            <span className="inventory-row-remove-slot">
              {editMode && onRemoveFromProfile ? (
                <IconActionButton
                  className="profile-resource-remove-btn"
                  label={`Remove ${item.label} from ${profileName}`}
                  title="Remove from profile"
                  busy={pending}
                  spinnerSize={ICON_SIZE}
                  onClick={onRemoveFromProfile}
                  icon={<Trash2 size={ICON_SIZE} strokeWidth={2} aria-hidden />}
                />
              ) : (
                <span className="inventory-row-remove-placeholder" aria-hidden />
              )}
            </span>
          ) : null}
          {action}
        </span>
      </ResourceRowTrailing>
    </ResourceRowRoot>
  );
}
