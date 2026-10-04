import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { IconActionButton } from "./IconActionButton";

const DEFAULT_ICON_SIZE = 16;

export interface WorkspaceRefreshButtonProps {
  label: string;
  disabled?: boolean;
  testId: string;
  iconSize?: number;
  className?: string;
  onRefresh: () => Promise<boolean | void> | boolean | void;
}

/** Icon-only refresh with loading and brief success feedback. */
export function WorkspaceRefreshButton({
  label,
  disabled = false,
  testId,
  iconSize = DEFAULT_ICON_SIZE,
  className,
  onRefresh,
}: WorkspaceRefreshButtonProps) {
  const [phase, setPhase] = useState<"idle" | "loading" | "success">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const onClick = useCallback(async () => {
    if (phase === "loading") {
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPhase("loading");
    try {
      const ok = await onRefresh();
      if (ok === false) {
        setPhase("idle");
        return;
      }
      setPhase("success");
      timerRef.current = setTimeout(() => {
        setPhase("idle");
        timerRef.current = null;
      }, 1200);
    } catch {
      setPhase("idle");
    }
  }, [onRefresh, phase]);

  return (
    <IconActionButton
      className={[
        "refresh-action",
        phase === "loading" ? "is-loading" : "",
        phase === "success" ? "is-success" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
      onClick={() => void onClick()}
      disabled={disabled || phase === "loading"}
      busy={phase === "loading"}
      label={
        phase === "success"
          ? "Refreshed"
          : phase === "loading"
            ? "Refreshing"
            : label
      }
      title={label}
      icon={
        phase === "success" ? (
          <Check size={iconSize} strokeWidth={2.25} aria-hidden="true" />
        ) : (
          <RefreshCw
            className="refresh-spinner"
            size={iconSize}
            strokeWidth={2}
            aria-hidden="true"
          />
        )
      }
    />
  );
}
