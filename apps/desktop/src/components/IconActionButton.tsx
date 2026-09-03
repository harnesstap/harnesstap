import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ButtonSpinner } from "./ButtonSpinner";

export interface IconActionButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  primary?: boolean;
  busy?: boolean;
  spinnerSize?: number;
}

/** Icon-only chrome control. Visible label lives in `title` and `aria-label`. */
export function IconActionButton({
  label,
  icon,
  primary = false,
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
      className={["icon-action", primary ? "primary" : "", busy ? "is-busy" : "", className]
        .filter(Boolean)
        .join(" ")}
      aria-label={label}
      title={title ?? label}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy ? <ButtonSpinner size={spinnerSize} /> : icon}
    </button>
  );
}
