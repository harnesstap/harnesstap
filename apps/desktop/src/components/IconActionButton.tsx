import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ButtonSpinner } from "./ButtonSpinner";

export interface IconActionButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  primary?: boolean;
  /** When true, render `label` beside the icon. Use for non-square primary CTAs. */
  showLabel?: boolean;
  busy?: boolean;
  spinnerSize?: number;
}

/** Chrome control. Icon-only by default; `showLabel` adds a short visible verb. */
export function IconActionButton({
  label,
  icon,
  primary = false,
  showLabel = false,
  busy = false,
  spinnerSize = 16,
  className,
  disabled,
  title,
  type = "button",
  ...props
}: IconActionButtonProps) {
  return (
    <button
      type={type}
      className={[
        "icon-action",
        primary ? "primary" : "",
        showLabel ? "has-label" : "",
        busy ? "is-busy" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={showLabel ? undefined : label}
      title={title ?? label}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? <ButtonSpinner size={spinnerSize} /> : icon}
      {showLabel ? <span className="icon-action-text">{label}</span> : null}
    </button>
  );
}
