import { Loader2 } from "lucide-react";

export interface ButtonSpinnerProps {
  size?: number;
  className?: string;
}

/** Inline spinner for busy buttons (disable the control while showing this). */
export function ButtonSpinner({ size = 14, className }: ButtonSpinnerProps) {
  return (
    <Loader2
      className={["btn-spinner", className].filter(Boolean).join(" ")}
      size={size}
      strokeWidth={2}
      aria-hidden="true"
    />
  );
}
