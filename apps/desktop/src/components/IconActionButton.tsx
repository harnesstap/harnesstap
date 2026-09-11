import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ButtonSpinner } from "./ButtonSpinner";
import { ChromeTooltip } from "./ChromeTooltip";

export interface IconActionButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  primary?: boolean;
  /** When true, render `label` beside the icon. Use for non-square primary CTAs. */
  showLabel?: boolean;
  /** When `showLabel` is true, put the visible text to the left of the icon. */
  iconAfterLabel?: boolean;
  busy?: boolean;
  spinnerSize?: number;
}

/** Chrome control. Icon-only by default; `showLabel` adds a short visible verb. */
export function IconActionButton({
  label,
  icon,
  primary = false,
  showLabel = false,
  iconAfterLabel = false,
  busy = false,
  spinnerSize = 16,
  className,
  disabled,
  title,
  type = "button",
  ...props
}: IconActionButtonProps) {
  const tooltip = title ?? label;
  const isDisabled = Boolean(disabled || busy);
  const button = (
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
      disabled={isDisabled}
      aria-busy={busy || undefined}
      {...props}
    >
      {iconAfterLabel && showLabel ? (
        <span className="icon-action-text">{label}</span>
      ) : null}
      {busy ? <ButtonSpinner size={spinnerSize} /> : icon}
      {!iconAfterLabel && showLabel ? (
        <span className="icon-action-text">{label}</span>
      ) : null}
    </button>
  );

  if (showLabel && !title) {
    return button;
  }

  return (
    <ChromeTooltip content={tooltip}>
      {isDisabled ? (
        <span className="icon-action-tooltip-host">{button}</span>
      ) : (
        button
      )}
    </ChromeTooltip>
  );
}
