import type { MouseEvent, ReactNode } from "react";
import { CircleAlert, FileDiff, Plus, Power, X } from "lucide-react";
import {
  inventoryMembershipCaption,
  profileInventoryOpenTarget,
  type ProfileInventoryItem,
} from "../../lib/profile-inventory";
import {
  hoverModelFromProfileResource,
  type ResourceHoverModel,
} from "../../lib/resource-hover";
import { ButtonSpinner } from "../ButtonSpinner";
import { IconActionButton } from "../IconActionButton";
import { Checkbox } from "../ui/checkbox";
import { ResourceHoverCard } from "../ui/resource-hover-card";
import type { ResourceDetailTarget } from "../ResourceDetailPane";
import { resourceDetailTarget } from "./shared";

const CHIP_STATUS_GLYPH_PX = 12;
const CHIP_ACTION_ICON_PX = 14;

function stopChipActivate(event: MouseEvent) {
  event.stopPropagation();
}

function chipHover(
  item: ProfileInventoryItem,
  profileName: string | null,
): ResourceHoverModel {
  const model = hoverModelFromProfileResource(item.resource);
  model.showName = true;
  const caption = inventoryMembershipCaption(item.pluginName, profileName);
  if (caption) {
    model.extra = [...model.extra, { kind: "note", text: caption }];
  }
  return model;
}

export interface InventoryRowProps {
  item: ProfileInventoryItem;
  editMode: boolean;
  profileName: string | null;
  pending: boolean;
  selectedIsActive: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
  onAdd?: () => void;
  onDiscard?: () => void;
  onActivate?: () => void;
  onOpenResource: (target: ResourceDetailTarget) => void;
  onOpenPlugin?: (pluginName: string) => void;
  onDiff?: () => void;
}

export function InventoryRow({
  item,
  editMode,
  profileName,
  pending,
  selectedIsActive,
  selected = false,
  onToggleSelected,
  onAdd,
  onDiscard,
  onActivate,
  onOpenResource,
  onOpenPlugin,
  onDiff,
}: InventoryRowProps) {
  const inProfile = item.section !== "not_in_profile";
  const drifted = item.section === "active" && item.drifted;
  const showActivate =
    !editMode && item.section === "inactive" && selectedIsActive && Boolean(onActivate);
  const showSelect = inProfile && editMode && Boolean(onToggleSelected);
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
    action = <ButtonSpinner size={CHIP_ACTION_ICON_PX} />;
  } else if (drifted && onDiff && item.driftChange) {
    action = (
      <IconActionButton
        className="file-change-diff-btn"
        label={`View changes for ${item.label}`}
        title="View changes"
        onClick={onDiff}
        icon={<FileDiff size={CHIP_ACTION_ICON_PX} strokeWidth={2} aria-hidden />}
      />
    );
  } else if (item.section === "not_in_profile" && (onAdd || onDiscard || (onDiff && item.driftChange))) {
    action = (
      <span className="inventory-chip-not-in-profile-actions">
        {onDiff && item.driftChange ? (
          <IconActionButton
            className="file-change-diff-btn"
            label={`View changes for ${item.label}`}
            title="View changes"
            onClick={onDiff}
            icon={<FileDiff size={CHIP_ACTION_ICON_PX} strokeWidth={2} aria-hidden />}
          />
        ) : null}
        {onAdd ? (
          <IconActionButton
            className="untracked-add-btn"
            spinnerSize={CHIP_ACTION_ICON_PX}
            label="Add"
            title={`Add ${item.label} to this profile`}
            onClick={onAdd}
            icon={<Plus size={CHIP_ACTION_ICON_PX} strokeWidth={2} aria-hidden />}
          />
        ) : null}
        {onDiscard ? (
          <IconActionButton
            className="profile-remove-action"
            spinnerSize={CHIP_ACTION_ICON_PX}
            label="Discard"
            title={`Discard ${item.label} from live setup`}
            onClick={onDiscard}
            icon={<X size={CHIP_ACTION_ICON_PX} strokeWidth={2} aria-hidden />}
          />
        ) : null}
      </span>
    );
  } else if (showActivate && onActivate) {
    action = (
      <IconActionButton
        spinnerSize={CHIP_ACTION_ICON_PX}
        label="Activate"
        title={`Activate ${item.label}`}
        onClick={onActivate}
        icon={<Power size={CHIP_ACTION_ICON_PX} strokeWidth={2} aria-hidden />}
      />
    );
  }

  const activateChip = showSelect && onToggleSelected ? onToggleSelected : openRow;

  return (
    <ResourceHoverCard model={chipHover(item, profileName)}>
      <div
        className={[
          "inventory-chip",
          drifted ? "inventory-chip-drifted m-status" : "",
          selected ? "is-selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid={`resource-row-${item.resource.name}`}
        onClick={activateChip}
      >
        {showSelect && onToggleSelected ? (
          <span className="resource-row-checkbox" onClick={stopChipActivate}>
            <Checkbox
              data-testid={`inventory-row-select-${item.key}`}
              aria-label={`Select ${item.label}`}
              checked={selected}
              disabled={pending}
              onCheckedChange={() => {
                onToggleSelected();
              }}
            />
          </span>
        ) : null}
        {drifted ? (
          <span
            className="inventory-chip-status inventory-status-glyph m-status"
            aria-label="Active, differs from disk"
            role="img"
          >
            <CircleAlert size={CHIP_STATUS_GLYPH_PX} strokeWidth={2} aria-hidden />
          </span>
        ) : null}
        <button
          type="button"
          className="inventory-chip-name"
          onClick={(event) => {
            event.stopPropagation();
            activateChip();
          }}
        >
          {item.label}
        </button>
        {action ? (
          <span className="inventory-chip-actions" onClick={stopChipActivate}>
            {action}
          </span>
        ) : null}
      </div>
    </ResourceHoverCard>
  );
}
