import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { useOverlayLayer } from "../../state/overlay-stack";
import { ChromeTooltip } from "../ChromeTooltip";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

const HEADER_ICON_SIZE = 18;

export interface HeaderMoreItem {
  id: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
  testId?: string;
}

export interface HeaderMoreMenuProps {
  disabled?: boolean;
  items: HeaderMoreItem[];
  children?: ReactNode;
  /** Red dot on the trigger, e.g. when a Desktop update is available. */
  attention?: boolean;
}

function menuItemsIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
    (element) => !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true",
  );
}

/** Permanent home of Export, Import, Account, and Update behind Ellipsis. */
export function HeaderMoreMenu({
  disabled = false,
  items,
  children,
  attention = false,
}: HeaderMoreMenuProps) {
  const [open, setOpen] = useState(false);
  const contentRef = useOverlayLayer<HTMLDivElement>({
    open,
    onClose: () => setOpen(false),
    trapFocus: false,
  });

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const root = contentRef.current;
    if (!root) {
      return;
    }
    const entries = menuItemsIn(root);
    if (entries.length === 0) {
      return;
    }
    const active = document.activeElement;
    const index = active instanceof HTMLElement ? entries.indexOf(active) : -1;
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
      <ChromeTooltip content="More">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="icon-action header-more-trigger"
            data-testid="header-more"
            disabled={disabled}
            aria-label={attention ? "More (update available)" : "More"}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <Ellipsis size={HEADER_ICON_SIZE} strokeWidth={2} aria-hidden="true" />
            {attention ? <span className="update-available-badge" aria-hidden="true" /> : null}
          </button>
        </PopoverTrigger>
      </ChromeTooltip>
      <PopoverContent
        ref={contentRef}
        align="end"
        role="menu"
        aria-label="More"
        className="header-more-menu w-auto p-1"
        onKeyDown={onMenuKeyDown}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="header-more-item"
            data-testid={item.testId}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              setOpen(false);
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
        {children}
      </PopoverContent>
    </Popover>
  );
}
