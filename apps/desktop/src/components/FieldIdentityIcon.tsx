import type { ReactNode } from "react";
import { ChromeTooltip } from "./ChromeTooltip";

export function FieldIdentityIcon({
  label,
  icon,
}: {
  label: string;
  icon: ReactNode;
}) {
  return (
    <ChromeTooltip content={label} side="top">
      <span className="field-identity-icon" role="img" aria-label={label}>
        {icon}
      </span>
    </ChromeTooltip>
  );
}
