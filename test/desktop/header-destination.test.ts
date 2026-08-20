import { describe, expect, test } from "bun:test";
import {
  activeHeaderDestination,
  headerClickIntent,
} from "../../apps/desktop/src/lib/header-destination.ts";

describe("activeHeaderDestination", () => {
  test("maps workspace focus and scope view to a header destination", () => {
    expect(activeHeaderDestination("library", "home")).toBe("library");
    expect(activeHeaderDestination("library", "project")).toBe("library");
    expect(activeHeaderDestination("sources", "home")).toBe("sources");
    expect(activeHeaderDestination("sources", "project")).toBe("sources");
    expect(activeHeaderDestination("environments", "home")).toBe("environments");
    expect(activeHeaderDestination("scope", "home")).toBe("home");
    expect(activeHeaderDestination("scope", "project")).toBe("project");
  });
});

describe("headerClickIntent", () => {
  test("re-click of the active destination is a reset", () => {
    expect(headerClickIntent("library", "library")).toBe("reset");
    expect(headerClickIntent("sources", "sources")).toBe("reset");
    expect(headerClickIntent("environments", "environments")).toBe("reset");
    expect(headerClickIntent("home", "home")).toBe("reset");
    expect(headerClickIntent("project", "project")).toBe("reset");
  });

  test("clicking a different destination is a switch", () => {
    expect(headerClickIntent("library", "environments")).toBe("switch");
    expect(headerClickIntent("library", "sources")).toBe("switch");
    expect(headerClickIntent("home", "project")).toBe("switch");
    expect(headerClickIntent("project", "library")).toBe("switch");
    expect(headerClickIntent("environments", "home")).toBe("switch");
  });
});
