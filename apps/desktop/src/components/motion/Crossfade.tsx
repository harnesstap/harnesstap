import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { crossfadeAfterExit, nextCrossfadeState, type CrossfadeState } from "./motion-state";
import { joinClassNames, prefersReducedMotion, readDurationToken } from "./motion-utils";

const EXIT_FALLBACK_SLACK_MS = 40;

export type CrossfadeKey = string | number;

export interface CrossfadeProps<K extends CrossfadeKey>
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Identifies the current child; changing it crossfades to the new children. */
  activeKey: K;
  children: ReactNode;
}

/**
 * Swaps children by key: the outgoing child stays mounted with `m-fade-out`
 * (absolutely positioned over the incoming one) while the incoming child
 * mounts with `m-fade-in`. The container holds the outgoing child's height as
 * `min-height` for the duration of the swap so surrounding layout does not jump.
 */
export function Crossfade<K extends CrossfadeKey>({
  activeKey,
  children,
  className,
  ...rest
}: CrossfadeProps<K>) {
  const [storedState, setState] = useState<CrossfadeState<K>>({
    current: activeKey,
    outgoing: null,
  });
  const state = nextCrossfadeState(storedState, activeKey);
  if (state !== storedState) {
    setState(state);
  }

  const childrenByKey = useRef(new Map<K, ReactNode>());
  childrenByKey.current.set(activeKey, children);
  const hasSwappedRef = useRef(false);
  if (state.outgoing !== null) {
    hasSwappedRef.current = true;
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const outgoingRef = useRef<HTMLDivElement>(null);
  const outgoingKey = state.outgoing;

  const finishExit = useCallback((key: K) => {
    childrenByKey.current.delete(key);
    setState((current) => crossfadeAfterExit(current, key));
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (outgoingKey === null) {
      if (container) {
        container.style.minHeight = "";
      }
      return;
    }
    const height = outgoingRef.current?.offsetHeight ?? 0;
    if (container && height > 0) {
      container.style.minHeight = `${height}px`;
    }
    const wait = prefersReducedMotion()
      ? 0
      : readDurationToken("--duration-fast") + EXIT_FALLBACK_SLACK_MS;
    const timer = window.setTimeout(() => finishExit(outgoingKey), wait);
    return () => window.clearTimeout(timer);
  }, [outgoingKey, finishExit]);

  const handleOutgoingAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && outgoingKey !== null) {
      finishExit(outgoingKey);
    }
  };

  return (
    <div {...rest} ref={containerRef} className={joinClassNames("m-crossfade", className)}>
      {outgoingKey !== null ? (
        <div
          key={`out-${String(outgoingKey)}`}
          ref={outgoingRef}
          className="m-crossfade-outgoing m-fade-out"
          aria-hidden
          onAnimationEnd={handleOutgoingAnimationEnd}
        >
          {childrenByKey.current.get(outgoingKey)}
        </div>
      ) : null}
      <div
        key={`in-${String(state.current)}`}
        className={hasSwappedRef.current ? "m-fade-in" : undefined}
      >
        {children}
      </div>
    </div>
  );
}
