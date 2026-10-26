import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { MigrateScopeOption } from "../lib/migrate-defaults";
import type { MigrateScope } from "../lib/types";

export interface MigrateScopeRadiosProps {
  idPrefix: string;
  heading: string;
  options: readonly MigrateScopeOption[];
  value: MigrateScope;
  onValueChange: (value: MigrateScope) => void;
  disabled?: boolean;
}

/** Step 1 of Export and Import: a heading plus one radio per scope, each with a one-line description. */
export function MigrateScopeRadios({
  idPrefix,
  heading,
  options,
  value,
  onValueChange,
  disabled,
}: MigrateScopeRadiosProps) {
  const headingId = `${idPrefix}-heading`;
  return (
    <div className="migrate-scope-step">
      <h3 id={headingId} className="migrate-step-heading">
        {heading}
      </h3>
      <RadioGroup
        value={value}
        onValueChange={(next) => onValueChange(next as MigrateScope)}
        disabled={disabled}
        aria-labelledby={headingId}
      >
        {options.map((option) => {
          const id = `${idPrefix}-${option.value}`;
          return (
            <div key={option.value} className="migrate-scope-option">
              <RadioGroupItem value={option.value} id={id} />
              <div className="migrate-scope-option-text">
                <Label htmlFor={id} className="font-normal">
                  {option.label}
                </Label>
                <p className="muted m-0 text-[11px]">{option.description}</p>
              </div>
            </div>
          );
        })}
      </RadioGroup>
    </div>
  );
}
