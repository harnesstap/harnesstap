import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import {
  nextPresencePhase,
  presenceAfterExit,
  presenceDataState,
  presenceMotionClass,
  type PresencePhase,
  type PresenceState,
} from "./motion-state";
import { joinClassNames, prefersReducedMotion, readDurationToken } from "./motion-utils";

export type { PresenceState } from "./motion-state";

/* Real exits end on `animationend`; the timer only covers the case where no
   animation runs (reduced motion, class missing), so it waits a little longer. */
const EXIT_FALLBACK_SLACK_MS = 40;

export type PresenceElement = "div" | "section" | "aside" | "span" | "ul" | "li";

export interface PresenceProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  open: boolean;
  /** Class applied while open (enter recipe), e.g. `m-rise-in`. */
  enter?: string;
  /** Class applied while exiting, e.g. `m-rise-out`. */
  exit?: string;
  /** Element rendered as the animated root; it can be the dialog backdrop itself. */
  as?: PresenceElement;
  /** Remove the element from the DOM once the exit finishes (default). */
  unmountOnExit?: boolean;
  onExitComplete?: () => void;
  /**
   * Children render inside the animated root. Pass a function to read the
   * `open | closed` state for nested recipes (backdrop scrim plus dialog rise).
   * During the exit the last children rendered while open are kept so the
   * content does not change under the fade.
   */
  children?: ReactNode | ((state: PresenceState) => ReactNode);
}

export function Presence({
  open,
  enter,
  exit,
  as = "div",
  unmountOnExit = true,
  onExitComplete,
  children,
  className,
  onAnimationEnd,
  ...rest
}: PresenceProps) {
  const [storedPhase, setPhase] = useState<PresencePhase>(() => (open ? "open" : "closed"));
  const phase = nextPresencePhase(storedPhase, open);
  if (phase !== storedPhase) {
    setPhase(phase);
  }

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const lastOpenChildrenRef = useRef(children);
  if (open) {
    lastOpenChildrenRef.current = children;
  }
  const onExitCompleteRef = useRef(onExitComplete);
  onExitCompleteRef.current = onExitComplete;

  const finishExit = useCallback(() => {
    if (phaseRef.current !== "exiting") {
      return;
    }
    phaseRef.current = "closed";
    setPhase((current) => presenceAfterExit(current));
    onExitCompleteRef.current?.();
  }, []);

  useEffect(() => {
    if (phase !== "exiting") {
      return;
    }
    const wait = prefersReducedMotion()
      ? 0
      : readDurationToken("--duration-base") + EXIT_FALLBACK_SLACK_MS;
    const timer = window.setTimeout(finishExit, wait);
    return () => window.clearTimeout(timer);
  }, [phase, finishExit]);

  const handleAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
    onAnimationEnd?.(event);
    if (phaseRef.current !== "exiting") {
      return;
    }
    // With an exit class the root animates itself; otherwise accept a nested exit.
    if (exit && event.target !== event.currentTarget) {
      return;
    }
    finishExit();
  };

  if (phase === "closed" && unmountOnExit) {
    return null;
  }

  const state = presenceDataState(phase);
  const content = phase === "exiting" ? lastOpenChildrenRef.current : children;
  const resolved = typeof content === "function" ? content(state) : content;

  return createElement(
    as,
    {
      ...rest,
      className: joinClassNames(className, presenceMotionClass(phase, enter, exit)),
      "data-state": state,
      hidden: phase === "closed" ? true : undefined,
      onAnimationEnd: handleAnimationEnd,
    },
    resolved,
  );
}
