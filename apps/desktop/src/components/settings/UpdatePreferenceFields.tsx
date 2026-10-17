import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SourcePicker } from "@/components/ui/source-picker";
import type { UpdateFrequency, UpdateMode } from "../../lib/api/settings-updates";
import { UPDATE_FREQUENCY_OPTIONS, UPDATE_MODE_OPTIONS } from "../../lib/update-settings-copy";

export interface UpdatePreferenceFieldsProps {
  idPrefix: string;
  legend: string;
  className?: string;
  mode: UpdateMode;
  frequency: UpdateFrequency;
  disabled?: boolean;
  onModeChange: (mode: UpdateMode) => void;
  onFrequencyChange: (frequency: UpdateFrequency) => void;
}

/** Mode and frequency, shared by Settings and the dialog after Update all. */
export function UpdatePreferenceFields({
  idPrefix,
  legend,
  className,
  mode,
  frequency,
  disabled = false,
  onModeChange,
  onFrequencyChange,
}: UpdatePreferenceFieldsProps) {
  const frequencyId = `${idPrefix}-frequency`;
  return (
    <div className={["flex flex-col gap-3", className].filter(Boolean).join(" ")}>
      <SourcePicker
        legend={legend}
        value={mode}
        disabled={disabled}
        onValueChange={(next) => onModeChange(next as UpdateMode)}
        options={UPDATE_MODE_OPTIONS.map((option) => ({
          ...option,
          testId: `${idPrefix}-mode-${option.value}`,
        }))}
      />
      <div className="flex items-center gap-2">
        <Label htmlFor={frequencyId}>Check</Label>
        <Select
          value={frequency}
          disabled={disabled || mode === "off"}
          onValueChange={(next) => onFrequencyChange(next as UpdateFrequency)}
        >
          <SelectTrigger id={frequencyId} data-testid={frequencyId} aria-label="Check frequency" style={{ width: "auto" }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UPDATE_FREQUENCY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
