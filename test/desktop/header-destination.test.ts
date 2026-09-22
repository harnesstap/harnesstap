import { describe, expect, test } from "bun:test";
import {
  activeHeaderDestination,
  headerClickIntent,
  headerDestinationTarget,
} from "../../apps/desktop/src/lib/header-destination.ts";

describe("activeHeaderDestination", () => {
  test("maps destination and scope to a header destination", () => {
    expect(activeHeaderDestination("library", "global")).toBe("library");
    expect(activeHeaderDestination("library", "project")).toBe("library");
    expect(activeHeaderDestination("discover", "global")).toBe("discover");
    expect(activeHeaderDestination("discover", "project")).toBe("discover");
    expect(activeHeaderDestination("environments", "global")).toBe("environments");
    expect(activeHeaderDestination("harnesses", "global")).toBe("harnesses");
    expect(activeHeaderDestination("harnesses", "project")).toBe("harnesses");
    expect(activeHeaderDestination("scope", "global")).toBe("global");
    expect(activeHeaderDestination("scope", "project")).toBe("project");
  });
});

describe("headerDestinationTarget", () => {
  test("workspace clicks target a destination without touching scope", () => {
    expect(headerDestinationTarget("library")).toEqual({ destination: "library", scope: null });
    expect(headerDestinationTarget("discover")).toEqual({ destination: "discover", scope: null });
    expect(headerDestinationTarget("environments")).toEqual({
      destination: "environments",
      scope: null,
    });
    expect(headerDestinationTarget("harnesses")).toEqual({
      destination: "harnesses",
      scope: null,
    });
  });

  test("scope segment clicks target the scope destination with a scope", () => {
    expect(headerDestinationTarget("global")).toEqual({ destination: "scope", scope: "global" });
    expect(headerDestinationTarget("project")).toEqual({ destination: "scope", scope: "project" });
  });
});

describe("headerClickIntent", () => {
  test("re-click of the active destination is a reset", () => {
    expect(headerClickIntent("library", "library")).toBe("reset");
    expect(headerClickIntent("discover", "discover")).toBe("reset");
    expect(headerClickIntent("environments", "environments")).toBe("reset");
    expect(headerClickIntent("harnesses", "harnesses")).toBe("reset");
    expect(headerClickIntent("global", "global")).toBe("reset");
    expect(headerClickIntent("project", "project")).toBe("reset");
  });

  test("clicking a different destination is a switch", () => {
    expect(headerClickIntent("library", "environments")).toBe("switch");
    expect(headerClickIntent("environments", "harnesses")).toBe("switch");
    expect(headerClickIntent("harnesses", "library")).toBe("switch");
    expect(headerClickIntent("library", "discover")).toBe("switch");
    expect(headerClickIntent("global", "project")).toBe("switch");
    expect(headerClickIntent("project", "library")).toBe("switch");
    expect(headerClickIntent("environments", "global")).toBe("switch");
  });
});
