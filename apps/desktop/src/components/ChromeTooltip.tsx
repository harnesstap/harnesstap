import type { ReactNode } from "react";
import { Tooltip } from "radix-ui";

export function ChromeTooltip({
  content,
  children,
  side = "bottom",
}: {
  content: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="chrome-tooltip"
          side={side}
          sideOffset={4}
        >
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
