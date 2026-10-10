import { useRef, useState, type ReactNode } from "react";
import { Tooltip } from "radix-ui";

const HOVER_DELAY_MS = 400;

/**
 * Tooltip on pointer hover or keyboard :focus-visible only.
 * Programmatic / mouse focus (modal open focusing Close) does not show it.
 */
export function ChromeTooltip({
  content,
  children,
  side = "bottom",
}: {
  content: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const [open, setOpen] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const pointerInside = useRef(false);

  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const openFromHover = () => {
    pointerInside.current = true;
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(() => {
      setOpen(true);
    }, HOVER_DELAY_MS);
  };

  const closeFromPointer = () => {
    pointerInside.current = false;
    clearHoverTimer();
    setOpen(false);
  };

  return (
    <Tooltip.Root open={open} delayDuration={0}>
      <Tooltip.Trigger
        asChild
        onPointerEnter={openFromHover}
        onPointerLeave={closeFromPointer}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) {
            setOpen(true);
          }
        }}
        onBlur={() => {
          if (!pointerInside.current) {
            setOpen(false);
          }
        }}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="chrome-tooltip"
          side={side}
          sideOffset={4}
          collisionPadding={8}
        >
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
