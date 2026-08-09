import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export interface SourcePickerOption {
  value: string;
  title: string;
  description: string;
  disabled?: boolean;
}

export interface SourcePickerProps {
  legend: string;
  value: string;
  options: SourcePickerOption[];
  disabled?: boolean;
  onValueChange: (value: string) => void;
  className?: string;
}

export function SourcePicker({
  legend,
  value,
  options,
  disabled = false,
  onValueChange,
  className,
}: SourcePickerProps) {
  return (
    <fieldset className={cn("m-0 min-w-0 border-0 p-0", className)} disabled={disabled}>
      <legend className="mb-1.5 p-0 text-xs font-semibold">{legend}</legend>
      <RadioGroup
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        className="grid grid-cols-3 gap-1.5"
      >
        {options.map((option) => {
          const selected = option.value === value;
          const id = `source-${option.value}`;
          return (
            <Label
              key={option.value}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-start gap-1.5 rounded border border-border bg-background p-2.5",
                selected && "border-primary bg-primary/10",
                option.disabled && "cursor-not-allowed opacity-40",
              )}
            >
              <RadioGroupItem id={id} value={option.value} disabled={option.disabled || disabled} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <strong className="text-xs font-semibold">{option.title}</strong>
                <small className="text-[11px] font-normal text-muted-foreground">
                  {option.description}
                </small>
              </span>
            </Label>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}
