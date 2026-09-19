import { describe, expect, test } from "bun:test";
import {
  crossfadeAfterExit,
  nextCrossfadeState,
  nextPresencePhase,
  parseCssDuration,
  presenceAfterExit,
  presenceDataState,
  presenceMotionClass,
  type CrossfadeState,
  type PresencePhase,
} from "./motion-state";

describe("Presence phase sequencing", () => {
  test("closed → open → exiting → closed", () => {
    let phase: PresencePhase = "closed";
    phase = nextPresencePhase(phase, true);
    expect(phase).toBe("open");
    phase = nextPresencePhase(phase, false);
    expect(phase).toBe("exiting");
    expect(presenceDataState(phase)).toBe("closed");
    phase = presenceAfterExit(phase);
    expect(phase).toBe("closed");
  });

  test("stays mounted while exiting until the exit completes", () => {
    expect(nextPresencePhase("exiting", false)).toBe("exiting");
    expect(presenceAfterExit("open")).toBe("open");
    expect(presenceAfterExit("closed")).toBe("closed");
  });

  test("reopening mid-exit returns to open with the enter class", () => {
    const phase = nextPresencePhase("exiting", true);
    expect(phase).toBe("open");
    expect(presenceMotionClass(phase, "m-rise-in", "m-rise-out")).toBe("m-rise-in");
    expect(presenceMotionClass("exiting", "m-rise-in", "m-rise-out")).toBe("m-rise-out");
    expect(presenceMotionClass("closed", "m-rise-in", "m-rise-out")).toBeUndefined();
  });

  test("closed stays closed while open is false", () => {
    expect(nextPresencePhase("closed", false)).toBe("closed");
  });
});

describe("Crossfade sequencing", () => {
  test("changing the key keeps the outgoing child until its exit completes", () => {
    let state: CrossfadeState<string> = { current: "list", outgoing: null };
    state = nextCrossfadeState(state, "list");
    expect(state).toEqual({ current: "list", outgoing: null });
    state = nextCrossfadeState(state, "detail");
    expect(state).toEqual({ current: "detail", outgoing: "list" });
    expect(crossfadeAfterExit(state, "detail")).toBe(state);
    state = crossfadeAfterExit(state, "list");
    expect(state).toEqual({ current: "detail", outgoing: null });
  });

  test("swapping again mid-fade fades the newest child out and drops the older one", () => {
    const start: CrossfadeState<string> = { current: "b", outgoing: "a" };
    const next = nextCrossfadeState(start, "c");
    expect(next).toEqual({ current: "c", outgoing: "b" });
    expect(crossfadeAfterExit(next, "a")).toBe(next);
  });

  test("swapping back to the outgoing key makes it current again", () => {
    const start: CrossfadeState<string> = { current: "b", outgoing: "a" };
    expect(nextCrossfadeState(start, "a")).toEqual({ current: "a", outgoing: "b" });
  });
});

describe("parseCssDuration", () => {
  test("parses ms and s, falls back otherwise", () => {
    expect(parseCssDuration("180ms", 0)).toBe(180);
    expect(parseCssDuration(" 0.12s ", 0)).toBe(120);
    expect(parseCssDuration("", 180)).toBe(180);
    expect(parseCssDuration("fast", 180)).toBe(180);
  });
});
