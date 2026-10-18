import { Link2 } from "lucide-react";
import { ChromeTooltip } from "./ChromeTooltip";

/** "Synced with backend 1.0.0" under the title of a kept-in-sync profile. */
export function SyncedChip({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <ChromeTooltip content={tooltip}>
      <span className="meta-chip synced-chip" tabIndex={0} data-testid="synced-chip">
        <Link2 size={12} strokeWidth={2} aria-hidden />
        {label}
      </span>
    </ChromeTooltip>
  );
}
