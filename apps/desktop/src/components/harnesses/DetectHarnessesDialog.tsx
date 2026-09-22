import { useEffect, useId, useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  canRemoveHarness,
  defaultProposalChoice,
  diskPresenceLabel,
  KEEP_ONE_HARNESS_HINT,
  type DetectProposal,
  type HarnessEntry,
  type HarnessId,
  type HarnessSelection,
} from "../../lib/harness-inventory";
import { ConfirmDialog } from "../ConfirmDialog";
import { HarnessIcon } from "../HarnessIcons";

export interface DetectHarnessesDialogProps {
  proposal: DetectProposal | null;
  selection: HarnessSelection | null;
  busy: boolean;
  onApply: (chosen: ReadonlySet<HarnessId>) => void;
  onCancel: () => void;
}

const EMPTY_CHOICE: ReadonlySet<HarnessId> = new Set();

function toggled(current: ReadonlySet<HarnessId>, id: HarnessId, on: boolean): ReadonlySet<HarnessId> {
  const next = new Set(current);
  if (on) {
    next.add(id);
  } else {
    next.delete(id);
  }
  return next;
}

function ProposalGroup({
  title,
  idPrefix,
  rows,
  chosen,
  disabled,
  disabledHint,
  onToggle,
}: {
  title: string;
  idPrefix: string;
  rows: readonly HarnessEntry[];
  chosen: ReadonlySet<HarnessId>;
  disabled: boolean;
  disabledHint: (entry: HarnessEntry) => string | null;
  onToggle: (id: HarnessId, on: boolean) => void;
}): ReactNode {
  if (rows.length === 0) {
    return null;
  }
  return (
    <fieldset className="detect-harness-group">
      <legend className="detect-harness-group-title">{title}</legend>
      <ul className="detect-harness-rows">
        {rows.map((entry) => {
          const inputId = `${idPrefix}-${entry.id}`;
          const hint = disabledHint(entry);
          return (
            <li key={entry.id} className="detect-harness-row">
              <Checkbox
                id={inputId}
                checked={chosen.has(entry.id)}
                disabled={disabled || hint !== null}
                onCheckedChange={(value) => onToggle(entry.id, value === true)}
              />
              <Label htmlFor={inputId} className="detect-harness-label font-normal">
                <HarnessIcon id={entry.id} tooltip={false} />
                <span className="detect-harness-name">{entry.name}</span>
                <span className="muted detect-harness-meta">
                  {hint ?? diskPresenceLabel(entry.disk)}
                </span>
              </Label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

export function DetectHarnessesDialog({
  proposal,
  selection,
  busy,
  onApply,
  onCancel,
}: DetectHarnessesDialogProps) {
  const idPrefix = useId();
  const [chosen, setChosen] = useState<ReadonlySet<HarnessId>>(EMPTY_CHOICE);

  useEffect(() => {
    setChosen(proposal ? defaultProposalChoice(proposal) : EMPTY_CHOICE);
  }, [proposal]);

  const toggle = (id: HarnessId, on: boolean) => {
    setChosen((current) => toggled(current, id, on));
  };

  return (
    <ConfirmDialog
      open={proposal !== null}
      title="Detected changes"
      description="Harnesses found on this machine differ from your list. Choose what to apply. Files on disk stay."
      confirmLabel="Apply"
      confirmDisabled={chosen.size === 0}
      confirmHint="Choose at least one change"
      confirmBusy={busy}
      onConfirm={() => onApply(chosen)}
      onCancel={onCancel}
    >
      {proposal ? (
        <div className="detect-harness-groups" data-testid="detect-harnesses-dialog">
          <ProposalGroup
            title="Add"
            idPrefix={`${idPrefix}-add`}
            rows={proposal.add}
            chosen={chosen}
            disabled={busy}
            disabledHint={() => null}
            onToggle={toggle}
          />
          <ProposalGroup
            title="Remove"
            idPrefix={`${idPrefix}-remove`}
            rows={proposal.remove}
            chosen={chosen}
            disabled={busy}
            disabledHint={(entry) =>
              canRemoveHarness(selection, entry.id).ok ? null : KEEP_ONE_HARNESS_HINT}
            onToggle={toggle}
          />
        </div>
      ) : null}
    </ConfirmDialog>
  );
}
