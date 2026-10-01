import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { filterComboboxOptions } from "@/lib/combobox";
import { noResultsTitle } from "@/lib/empty-copy";
import { isListboxNavKey, nextListboxIndex } from "@/lib/listbox-nav";
import { formatTrackedBranchesField } from "@/lib/sources-panels";
import { cn } from "@/lib/utils";
import { useOverlayLayer } from "../state/overlay-stack";

export interface MarketplaceTrackedBranchesFieldProps {
  id?: string;
  selected: readonly string[];
  branches: readonly string[];
  defaultBranch: string | null;
  disabled?: boolean;
  loading?: boolean;
  sourceReady?: boolean;
  onChange: (next: string[]) => void;
}

function toggleBranch(selected: readonly string[], branch: string): string[] {
  return selected.includes(branch)
    ? selected.filter((item) => item !== branch)
    : [...selected, branch];
}

export function MarketplaceTrackedBranchesField({
  id,
  selected,
  branches,
  defaultBranch,
  disabled = false,
  loading = false,
  sourceReady = false,
  onChange,
}: MarketplaceTrackedBranchesFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const listId = `${fieldId}-list`;
  const filterRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [menuWidth, setMenuWidth] = useState<number>();
  const rootRef = useOverlayLayer<HTMLDivElement>({
    open,
    onClose: () => setOpen(false),
    trapFocus: false,
    restoreFocus: true,
    initialFocusRef: filterRef,
  });

  const options = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{ value: string; label: string }> = [];
    for (const branch of [...selected, ...branches]) {
      if (seen.has(branch)) continue;
      seen.add(branch);
      rows.push({
        value: branch,
        label: branch === defaultBranch ? `${branch} (default)` : branch,
      });
    }
    return rows;
  }, [branches, defaultBranch, selected]);

  const visible = useMemo(
    () => filterComboboxOptions(options, query),
    [options, query],
  );

  useLayoutEffect(() => {
    if (!open || !rootRef.current) {
      return;
    }
    setMenuWidth(rootRef.current.offsetWidth);
  }, [open, rootRef]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setHighlightedIndex(0);
  }, [open, visible.length]);

  const closedLabel = formatTrackedBranchesField(selected);
  const placeholder = loading
    ? "Listing branches…"
    : sourceReady
      ? "Leave empty for the default branch"
      : "Type a URL or path to list branches";

  const emptyLabel = !sourceReady
    ? "Type a URL or path to list branches"
    : loading
      ? "Listing branches…"
      : options.length === 0
        ? "No branches found"
        : noResultsTitle(query);

  return (
    <Popover open={open} onOpenChange={(next) => !disabled && setOpen(next)} modal={false}>
      <PopoverAnchor asChild>
        <div ref={rootRef} className="relative w-full">
          <button
            id={fieldId}
            type="button"
            data-testid="marketplace-tracked-branches"
            className={cn(
              "relative h-8 w-full min-w-0 rounded border border-input bg-background py-1.5 pr-8 pl-2.5 text-left text-xs shadow-xs outline-none",
              "focus-visible:outline-none focus-visible:[box-shadow:var(--focus-ring)]",
              "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
              closedLabel ? "text-foreground" : "text-muted-foreground",
            )}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            disabled={disabled}
            onClick={() => {
              if (!disabled) {
                setQuery("");
                setOpen((current) => !current);
              }
            }}
          >
            <span className="block truncate">
              {closedLabel || placeholder}
            </span>
            <ChevronDownIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-1.5 size-4 -translate-y-1/2 text-muted-foreground opacity-50"
            />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        collisionPadding={8}
        style={menuWidth ? { width: menuWidth } : undefined}
        className="p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <Input
          ref={filterRef}
          data-testid="marketplace-tracked-branches-filter"
          placeholder="Filter branches"
          aria-label="Filter branches"
          value={query}
          className="mb-1"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return;
            }
            if (isListboxNavKey(event.key)) {
              event.preventDefault();
              setHighlightedIndex((current) =>
                nextListboxIndex(current, event.key, visible.length),
              );
              return;
            }
            if (event.key === "Enter") {
              const option = visible[highlightedIndex];
              if (!option) {
                return;
              }
              event.preventDefault();
              onChange(toggleBranch(selected, option.value));
            }
          }}
        />
        {visible.length === 0 ? (
          <p className="px-2 py-1.5 text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul id={listId} role="listbox" aria-multiselectable className="max-h-56 overflow-auto">
            {visible.map((option, index) => {
              const checked = selected.includes(option.value);
              const active = index === highlightedIndex;
              return (
                <li key={option.value} role="none">
                  <div
                    id={`${listId}-option-${index}`}
                    role="option"
                    aria-selected={checked}
                    className={cn(
                      "flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-2 text-xs outline-hidden select-none",
                      active && "bg-accent text-accent-foreground",
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onChange(toggleBranch(selected, option.value))}
                  >
                    <Checkbox
                      checked={checked}
                      tabIndex={-1}
                      aria-hidden
                      className="pointer-events-none"
                    />
                    <span className="min-w-0 flex-1 truncate" title={option.label}>
                      {option.label}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
