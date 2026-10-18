import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { useOverlayLayer } from "../state/overlay-stack";
import { ChromeTooltip } from "./ChromeTooltip";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export interface OverflowMenuItem {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  /** Red text, for Delete. */
  danger?: boolean;
  /** Draws a separator above this item. */
  separatorBefore?: boolean;
  onSelect: () => void;
}

function enabledItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
    (element) => !element.hasAttribute("disabled"),
  );
}

/** The 3-dot menu at the end of a detail header: less frequent actions, Delete last. */
export function OverflowMenu({
  items,
  disabled = false,
  iconSize = 18,
  testId = "detail-overflow",
}: {
  items: OverflowMenuItem[];
  disabled?: boolean;
  iconSize?: number;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const contentRef = useOverlayLayer<HTMLDivElement>({ open, onClose: () => setOpen(false), trapFocus: false });
  if (items.length === 0) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const root = contentRef.current;
    if (!root) return;
    const entries = enabledItems(root);
    if (entries.length === 0) return;
    const index = document.activeElement instanceof HTMLElement ? entries.indexOf(document.activeElement) : -1;
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      entries[(index + step + entries.length) % entries.length]?.focus();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ChromeTooltip content="More actions">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="icon-action"
            data-testid={testId}
            disabled={disabled}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <Ellipsis size={iconSize} strokeWidth={2} aria-hidden="true" />
          </button>
        </PopoverTrigger>
      </ChromeTooltip>
      <PopoverContent
        ref={contentRef}
        align="end"
        role="menu"
        aria-label="More actions"
        className="header-more-menu w-auto p-1"
        onKeyDown={onKeyDown}
      >
        {items.map((item) => (
          <div key={item.id} className="contents">
            {item.separatorBefore ? <div className="overflow-menu-separator" role="separator" /> : null}
            <button
              type="button"
              role="menuitem"
              className={["header-more-item", item.danger ? "is-danger" : ""].filter(Boolean).join(" ")}
              data-testid={`${testId}-${item.id}`}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
