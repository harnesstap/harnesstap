import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ListFilter } from "lucide-react";
import {
  harnessMarketplaceFilterOptions,
  harnessOriginFilterOptions,
  type HarnessEntry,
  type HarnessFilterOption,
} from "../../lib/harness-inventory";
import { useOverlayLayer } from "../../state/overlay-stack";
import { ChromeTooltip } from "../ChromeTooltip";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

const ICON_SIZE = 14;

export interface HarnessFilterMenuProps {
  entry: HarnessEntry;
  originIds: readonly string[];
  marketplaceIds: readonly string[];
  disabled?: boolean;
  onOriginsChange: (next: readonly string[]) => void;
  onMarketplacesChange: (next: readonly string[]) => void;
}

function toggleId(current: readonly string[], id: string): readonly string[] {
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
}

function menuItemsIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')).filter(
    (element) => !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true",
  );
}

function FilterSection({
  title,
  options,
  selected,
  emptyLabel,
  emptyTooltip,
  testId,
  onToggle,
}: {
  title: string;
  options: readonly HarnessFilterOption[];
  selected: readonly string[];
  emptyLabel: string;
  emptyTooltip: string;
  testId: string;
  onToggle: (id: string) => void;
}): ReactNode {
  return (
    <section className="harness-filter-section" aria-label={title}>
      <h3 className="eyebrow">{title}</h3>
      {options.length === 0 ? (
        <ChromeTooltip content={emptyTooltip}>
          <button
            type="button"
            role="menuitemcheckbox"
            className="header-more-item"
            aria-checked={false}
            aria-label={emptyLabel}
            data-testid={`${testId}-empty`}
            disabled
          >
            <span className="harness-filter-check" aria-hidden />
            {emptyLabel}
          </button>
        </ChromeTooltip>
      ) : (
        options.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              role="menuitemcheckbox"
              className="header-more-item"
              aria-checked={checked}
              data-testid={`${testId}-${option.id}`}
              onClick={() => {
                onToggle(option.id);
              }}
            >
              <span className="harness-filter-check" aria-hidden>
                {checked ? <Check size={ICON_SIZE} strokeWidth={2} /> : null}
              </span>
              {option.label}
            </button>
          );
        })
      )}
    </section>
  );
}

export function HarnessFilterMenu({
  entry,
  originIds,
  marketplaceIds,
  disabled = false,
  onOriginsChange,
  onMarketplacesChange,
}: HarnessFilterMenuProps): ReactNode {
  const [open, setOpen] = useState(false);
  const contentRef = useOverlayLayer<HTMLDivElement>({
    open,
    onClose: () => setOpen(false),
    trapFocus: false,
  });
  const origins = harnessOriginFilterOptions(entry);
  const marketplaces = harnessMarketplaceFilterOptions(entry);
  const active = originIds.length > 0 || marketplaceIds.length > 0;

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const root = contentRef.current;
    if (!root) {
      return;
    }
    const entries = menuItemsIn(root);
    if (entries.length === 0) {
      return;
    }
    const focused = document.activeElement;
    const index = focused instanceof HTMLElement ? entries.indexOf(focused) : -1;
    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const next = entries[(index + 1) % entries.length] ?? entries[0];
        next?.focus();
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const prev = entries[(index - 1 + entries.length) % entries.length] ?? entries[0];
        prev?.focus();
        break;
      }
      case "Home": {
        event.preventDefault();
        entries[0]?.focus();
        break;
      }
      case "End": {
        event.preventDefault();
        entries[entries.length - 1]?.focus();
        break;
      }
      default:
        break;
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ChromeTooltip content="Filter by origin">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="icon-action list-search-filter"
            data-testid="harness-resource-filter"
            disabled={disabled}
            aria-label="Filter by origin and marketplace"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-pressed={active}
          >
            <ListFilter size={ICON_SIZE} strokeWidth={2} aria-hidden />
          </button>
        </PopoverTrigger>
      </ChromeTooltip>
      <PopoverContent
        ref={contentRef}
        align="end"
        side="bottom"
        role="menu"
        aria-label="Filter by origin and marketplace"
        className="harness-filter-menu header-more-menu w-auto p-1"
        onKeyDown={onMenuKeyDown}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const root = contentRef.current;
          if (root) {
            menuItemsIn(root)[0]?.focus();
          }
        }}
      >
        <FilterSection
          title="Filter per harness origin"
          options={origins}
          selected={originIds}
          emptyLabel="No harness origins"
          emptyTooltip="No harness origins found"
          testId="harness-origin-filter"
          onToggle={(id) => {
            onOriginsChange(toggleId(originIds, id));
          }}
        />
        <FilterSection
          title="Marketplace"
          options={marketplaces}
          selected={marketplaceIds}
          emptyLabel="Marketplace"
          emptyTooltip="No marketplace resources"
          testId="harness-marketplace-filter"
          onToggle={(id) => {
            onMarketplacesChange(toggleId(marketplaceIds, id));
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
