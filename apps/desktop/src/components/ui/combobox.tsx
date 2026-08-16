import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  commitCustomOnClose,
  customComboboxOption,
  filterComboboxOptions,
  type ComboboxOption,
} from "@/lib/combobox";

export type { ComboboxOption };

export interface ComboboxProps {
  id?: string;
  value: string;
  options: ComboboxOption[];
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  allowCustom?: boolean;
  onValueChange: (value: string) => void;
}

export function Combobox({
  id,
  value,
  options,
  disabled = false,
  placeholder,
  emptyLabel = "No matches.",
  allowCustom = false,
  onValueChange,
}: ComboboxProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const listId = `${fieldId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [edited, setEdited] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [menuWidth, setMenuWidth] = useState<number>();
  const skipDismissCommitRef = useRef(false);

  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? value;

  const filtered = useMemo(
    () => (edited ? filterComboboxOptions(options, query) : options),
    [edited, options, query],
  );
  const visible = useMemo(() => {
    if (!allowCustom || !edited) {
      return filtered;
    }
    const custom = customComboboxOption(filtered, query);
    return custom ? [custom, ...filtered] : filtered;
  }, [allowCustom, edited, filtered, query]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      return;
    }
    setMenuWidth(anchorRef.current.offsetWidth);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const selectedIndex = visible.findIndex((option) => option.value === value);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [visible, open, value]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const optionId = `${listId}-option-${highlightedIndex}`;
    document.getElementById(optionId)?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, listId, open]);

  const close = (
    nextLabel = selectedLabel,
    closeOptions?: { cancelled?: boolean; alreadyCommitted?: boolean },
  ) => {
    skipDismissCommitRef.current = true;
    let label = nextLabel;
    if (!closeOptions?.cancelled && !closeOptions?.alreadyCommitted) {
      const custom = commitCustomOnClose({
        allowCustom,
        query,
        cancelled: false,
        currentValue: value,
      });
      if (custom !== null) {
        onValueChange(custom);
        const known = options.find((option) => option.value === custom);
        label = known?.label ?? custom;
      }
    }
    setOpen(false);
    setEdited(false);
    setQuery(label);
  };

  const commit = (option: ComboboxOption) => {
    onValueChange(option.value);
    close(option.label, { alreadyCommitted: true });
  };

  const openMenu = () => {
    if (disabled) {
      return;
    }
    skipDismissCommitRef.current = false;
    setQuery(selectedLabel);
    setEdited(false);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      openMenu();
      return;
    }
    if (skipDismissCommitRef.current) {
      skipDismissCommitRef.current = false;
      return;
    }
    close();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        if (!open) {
          openMenu();
          return;
        }
        if (visible.length === 0) {
          return;
        }
        setHighlightedIndex((current) =>
          current >= visible.length - 1 ? 0 : current + 1,
        );
        return;
      }
      case "ArrowUp": {
        event.preventDefault();
        if (!open) {
          openMenu();
          return;
        }
        if (visible.length === 0) {
          return;
        }
        setHighlightedIndex((current) =>
          current <= 0 ? visible.length - 1 : current - 1,
        );
        return;
      }
      case "Home": {
        if (!open || visible.length === 0) {
          return;
        }
        event.preventDefault();
        setHighlightedIndex(0);
        return;
      }
      case "End": {
        if (!open || visible.length === 0) {
          return;
        }
        event.preventDefault();
        setHighlightedIndex(visible.length - 1);
        return;
      }
      case "Enter": {
        if (!open) {
          return;
        }
        event.preventDefault();
        const option = visible[highlightedIndex];
        if (option) {
          commit(option);
        }
        return;
      }
      case "Escape": {
        if (!open) {
          return;
        }
        event.preventDefault();
        close(selectedLabel, { cancelled: true });
        return;
      }
      case "Tab": {
        if (!open) {
          return;
        }
        const option = visible[highlightedIndex];
        if (option) {
          commit(option);
        } else {
          close();
        }
        return;
      }
      default:
        return;
    }
  };

  const highlighted = visible[highlightedIndex];
  const activeDescendant =
    open && highlighted ? `${listId}-option-${highlightedIndex}` : undefined;
  const inputValue = open ? query : selectedLabel;

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="relative w-full">
          <Input
            ref={inputRef}
            id={fieldId}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={activeDescendant}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            placeholder={placeholder}
            value={inputValue}
            className="pr-8"
            onFocus={() => {
              if (!open) {
                openMenu();
              }
            }}
            onChange={(event) => {
              if (!open) {
                openMenu();
              }
              setEdited(true);
              setQuery(event.target.value);
            }}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            aria-label="Show options"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (open) {
                close();
                return;
              }
              inputRef.current?.focus();
              openMenu();
            }}
          >
            <ChevronDownIcon className="size-4 opacity-50" />
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
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) {
            event.preventDefault();
          }
        }}
      >
        {visible.length === 0 ? (
          <p className="px-2 py-1.5 text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul id={listId} role="listbox" className="max-h-56 overflow-auto">
            {visible.map((option, index) => {
              const selectedOption = option.value === value;
              const active = index === highlightedIndex;
              return (
                <li
                  key={option.value}
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={selectedOption}
                  className={cn(
                    "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-xs outline-hidden select-none",
                    active && "bg-accent text-accent-foreground",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => commit(option)}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {selectedOption ? (
                    <span className="absolute right-2 flex size-3.5 items-center justify-center">
                      <CheckIcon className="size-4" />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
