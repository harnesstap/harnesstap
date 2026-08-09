import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface SelectionListItem {
  id: string;
  name: string;
  description?: string | null;
  leading?: ReactNode;
  trailing?: ReactNode;
  testId?: string;
}

export interface SelectionListProps {
  title: string;
  emptyLabel: string;
  items: SelectionListItem[];
  selectedIds: string[];
  disabled?: boolean;
  onToggle: (id: string) => void;
  idPrefix?: string;
  className?: string;
  listClassName?: string;
}

export function SelectionList({
  title,
  emptyLabel,
  items,
  selectedIds,
  disabled = false,
  onToggle,
  idPrefix,
  className,
  listClassName,
}: SelectionListProps) {
  const selected = new Set(selectedIds);
  return (
    <fieldset className={cn("selection-list m-0 min-w-0 border-0 p-0", className)} disabled={disabled}>
      <legend className="mb-1.5 p-0 text-xs font-semibold">{title}</legend>
      <div
        className={cn(
          "selection-list-rows max-h-[210px] overflow-y-auto rounded border border-border bg-background",
          listClassName,
        )}
      >
        {items.length === 0 ? (
          <p className="m-0 p-2.5 text-[11px] text-muted-foreground">{emptyLabel}</p>
        ) : (
          items.map((item) => {
            const checked = selected.has(item.id);
            const id = `selection-${idPrefix ?? title}-${item.id}`;
            return (
              <div
                key={item.id}
                className="selection-row flex items-start gap-2 border-b border-border px-2.5 py-2 last:border-b-0"
                data-testid={item.testId}
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={() => onToggle(item.id)}
                />
                <Label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 font-normal">
                  <span className="flex items-center gap-1.5">
                    {item.leading}
                    <strong className="text-xs font-semibold">{item.name}</strong>
                  </span>
                  {item.description ? (
                    <small className="text-[11px] font-normal text-muted-foreground">
                      {item.description}
                    </small>
                  ) : null}
                </Label>
                {item.trailing ? (
                  <span className="selection-row-trailing shrink-0 self-center">
                    {item.trailing}
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </fieldset>
  );
}
