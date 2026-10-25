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
  sideOffset = 4,
}: {
  content: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Gap in px between the trigger and the tooltip. */
  sideOffset?: number;
}) {
  const [open, setOpen] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const pointerInside = useRef(false);
  // A click opens a dialog or menu; focus coming back to the trigger when it
  // closes must not bring the tooltip back.
  const suppressFocusOpen = useRef(false);

  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const openFromHover = () => {
    pointerInside.current = true;
    suppressFocusOpen.current = false;
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
        onPointerDown={() => {
          suppressFocusOpen.current = true;
          clearHoverTimer();
          setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            suppressFocusOpen.current = true;
            setOpen(false);
          }
        }}
        onFocus={(event) => {
          if (!suppressFocusOpen.current && event.currentTarget.matches(":focus-visible")) {
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
          sideOffset={sideOffset}
          collisionPadding={8}
        >
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
