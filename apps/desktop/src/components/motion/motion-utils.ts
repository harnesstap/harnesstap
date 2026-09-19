import { parseCssDuration, type PresenceState } from "./motion-state";

const DEFAULT_DURATIONS: Record<string, number> = {
  "--duration-instant": 80,
  "--duration-fast": 120,
  "--duration-base": 180,
  "--duration-slow": 280,
  "--duration-skeleton": 1200,
};

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Reads a `--duration-*` token from `:root` in milliseconds for JS-timed sequences. */
export function readDurationToken(name: string): number {
  const fallback = DEFAULT_DURATIONS[name] ?? 0;
  if (typeof document === "undefined") {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return parseCssDuration(value, fallback);
}

export function joinClassNames(...parts: Array<string | undefined | null | false>): string | undefined {
  const joined = parts.filter(Boolean).join(" ");
  return joined.length > 0 ? joined : undefined;
}

/** `motionClass("dialog", "m-rise", "open")` → `"dialog m-rise-in"`; closed → `-out`. */
export function motionClass(base: string, recipe: string, state: PresenceState): string {
  return `${base} ${recipe}-${state === "open" ? "in" : "out"}`;
}
