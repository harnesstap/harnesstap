import { useEffect, useId, useState, type MouseEvent, type ReactNode } from "react";
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
import { HarnessScopeControl } from "./HarnessScopeControl";
import { displayNameForHarness, type HarnessScope, type SerializerTarget } from "../../lib/harness-scope-ui";
import { chipHarnessHint, chipHarnessLabel } from "../../lib/chip-harness";
import { HarnessMark } from "../HarnessIcons";
import { instructionHarnessParts } from "../../lib/resource-display";

const CHIP_STATUS_GLYPH_PX = 12;
const CHIP_ACTION_ICON_PX = 14;
const CHIP_HINT_ICON_PX = 10;

function stopChipActivate(event: MouseEvent) {
  event.stopPropagation();
}

function chipHover(
  item: ProfileInventoryItem,
  profileName: string | null,
  harnessText: string | null,
): ResourceHoverModel {
  const model = hoverModelFromProfileResource(item.resource);
  model.showName = true;
  // Which tools it is in: "Only in ..." for a subset, nothing when it is on
  // every tool. Replaces the generic harness row so the card says it once.
  model.harnessIds = [];
  if (harnessText) {
    model.extra = [{ kind: "note", text: harnessText }, ...model.extra];
  }
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
  registeredHarnesses?: readonly string[];
  harnessNames?: Readonly<Record<string, string>>;
  scopeTarget?: SerializerTarget;
  onHarnessScopeChange?: (scope: HarnessScope) => void | Promise<unknown>;
  scopePopoverOpen?: boolean;
  disableHover?: boolean;
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
  registeredHarnesses = [],
  harnessNames,
  scopeTarget = "global",
  onHarnessScopeChange,
  scopePopoverOpen = false,
  disableHover = false,
}: InventoryRowProps) {
  const inProfile = item.section === "active" || item.section === "inactive";
  const showScope =
    inProfile && Boolean(onHarnessScopeChange) && Boolean(item.resource.id);
  // The label follows the Tools popover at once; the saved value catches up.
  const [draftScope, setDraftScope] = useState<"all" | string[] | undefined>(undefined);
  useEffect(() => {
    setDraftScope(undefined);
  }, [item.resource.harness_scope]);
  const storedScope = draftScope ?? item.resource.harness_scope;
  const harnessLabel = inProfile
    ? chipHarnessLabel(storedScope, registeredHarnesses, (id) =>
        displayNameForHarness(id, harnessNames?.[id]),
      )
    : null;
  const harnessHint = inProfile ? chipHarnessHint(storedScope, registeredHarnesses) : null;
  const harnessTextId = useId();
  // `CLAUDE.md` plus the harness icon; the full `CLAUDE.md (Claude Code)` stays
  // in the hover card and the accessible name.
  const instructionParts = instructionHarnessParts(item.resource);
  const toolsControl = editMode && showScope && onHarnessScopeChange && item.resource.id ? (
    <HarnessScopeControl
      resourceName={item.label}
      resourceType={item.type}
      stored={storedScope}
      registered={registeredHarnesses}
      catalogNames={harnessNames}
      target={scopeTarget}
      disabled={pending}
      onChange={onHarnessScopeChange}
      onDraftChange={setDraftScope}
      initialOpen={scopePopoverOpen}
    />
  ) : null;
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
  // A running action stays visible; every other control waits for hover or focus.
  const spinner = pending ? <ButtonSpinner size={CHIP_ACTION_ICON_PX} /> : null;
  if (pending) {
    action = null;
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

  const chip = (
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
          aria-label={instructionParts ? item.label : undefined}
          aria-describedby={harnessLabel ? harnessTextId : undefined}
          onClick={(event) => {
            event.stopPropagation();
            activateChip();
          }}
        >
          {instructionParts ? instructionParts.file : item.label}
        </button>
        {instructionParts ? (
          <span
            className="inventory-chip-hint"
            data-testid="inventory-chip-instruction-harness"
            data-kind="instruction"
            aria-hidden="true"
          >
            <HarnessMark id={instructionParts.harnessId} size={CHIP_HINT_ICON_PX} />
          </span>
        ) : null}
        {harnessHint ? (
          <span
            className="inventory-chip-hint"
            data-testid="inventory-chip-hint"
            data-kind={harnessHint.kind}
            aria-hidden="true"
          >
            {harnessHint.kind === "icon" ? (
              <HarnessMark id={harnessHint.harnessId} size={CHIP_HINT_ICON_PX} />
            ) : (
              harnessHint.count
            )}
          </span>
        ) : null}
        {harnessLabel ? (
          <span id={harnessTextId} className="sr-only">
            {harnessLabel.full}
          </span>
        ) : null}
        {spinner}
        {action || toolsControl ? (
          // Absolutely positioned to the right of the badge: it overlays, so
          // the row never reflows. The cluster reserves room for it at row end.
          <span
            className="inventory-chip-actions inventory-chip-extension"
            data-testid={`resource-row-actions-${item.resource.name}`}
            onClick={stopChipActivate}
          >
            {toolsControl}
            {action}
          </span>
        ) : null}
      </div>
  );

  if (disableHover) {
    return chip;
  }
  return (
    <ResourceHoverCard model={chipHover(item, profileName, harnessLabel?.full ?? null)}>
      {chip}
    </ResourceHoverCard>
  );
}
