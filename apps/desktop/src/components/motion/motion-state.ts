/** Pure state sequencing for Presence and Crossfade; no DOM so it is unit-testable. */

export type PresencePhase = "closed" | "open" | "exiting";
export type PresenceState = "open" | "closed";

export function nextPresencePhase(prev: PresencePhase, open: boolean): PresencePhase {
  if (open) {
    return "open";
  }
  switch (prev) {
    case "open":
      return "exiting";
    case "exiting":
      return "exiting";
    case "closed":
      return "closed";
    default: {
      const neverPhase: never = prev;
      return neverPhase;
    }
  }
}

export function presenceAfterExit(phase: PresencePhase): PresencePhase {
  return phase === "exiting" ? "closed" : phase;
}

export function presenceDataState(phase: PresencePhase): PresenceState {
  return phase === "open" ? "open" : "closed";
}

export function presenceMotionClass(
  phase: PresencePhase,
  enter: string | undefined,
  exit: string | undefined,
): string | undefined {
  switch (phase) {
    case "open":
      return enter;
    case "exiting":
      return exit;
    case "closed":
      return undefined;
    default: {
      const neverPhase: never = phase;
      return neverPhase;
    }
  }
}

export interface CrossfadeState<K> {
  current: K;
  outgoing: K | null;
}

export function nextCrossfadeState<K>(prev: CrossfadeState<K>, activeKey: K): CrossfadeState<K> {
  if (activeKey === prev.current) {
    return prev;
  }
  // A swap mid-fade drops the older outgoing child: only one child fades out at a time.
  return { current: activeKey, outgoing: prev.current };
}

export function crossfadeAfterExit<K>(state: CrossfadeState<K>, key: K): CrossfadeState<K> {
  if (state.outgoing === null || state.outgoing !== key) {
    return state;
  }
  return { current: state.current, outgoing: null };
}

/** Parses a CSS time (`180ms`, `0.18s`) into milliseconds; `fallback` when unparsable. */
export function parseCssDuration(value: string, fallback: number): number {
  const trimmed = value.trim();
  const match = /^(-?\d*\.?\d+)(ms|s)$/i.exec(trimmed);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return fallback;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return fallback;
  }
  return match[2].toLowerCase() === "s" ? amount * 1000 : amount;
}
