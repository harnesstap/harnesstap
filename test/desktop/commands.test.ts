import { describe, expect, it } from "bun:test";
import {
  commandMatchesQuery,
  filterCommands,
  formatShortcutKeys,
  groupCommands,
  hasPrimaryModifier,
  isApplePlatform,
  matchShortcut,
  shortcutById,
  type Command,
} from "../../apps/desktop/src/lib/commands.ts";

function event(partial: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}) {
  return {
    key: partial.key,
    ctrlKey: partial.ctrlKey ?? false,
    metaKey: partial.metaKey ?? false,
    altKey: partial.altKey ?? false,
    shiftKey: partial.shiftKey ?? false,
  };
}

const sample: Command[] = [
  {
    id: "goto-library",
    section: "goto",
    label: "Library",
    shortcut: "Ctrl+1",
    keywords: ["resources"],
    run: () => undefined,
  },
  {
    id: "profile-apply",
    section: "profiles",
    label: "Apply global default",
    disabled: true,
    run: () => undefined,
  },
  {
    id: "library-create",
    section: "actions",
    label: "Create resource",
    run: () => undefined,
  },
];

describe("command matching", () => {
  it("filters by label, shortcut, and keywords", () => {
    expect(filterCommands(sample, "lib").map((row) => row.id)).toEqual(["goto-library"]);
    expect(filterCommands(sample, "ctrl+1").map((row) => row.id)).toEqual(["goto-library"]);
    expect(filterCommands(sample, "resources").map((row) => row.id)).toEqual([
      "goto-library",
    ]);
    const first = sample[0];
    expect(first).toBeDefined();
    if (!first) {
      return;
    }
    expect(commandMatchesQuery(first, "")).toBe(true);
  });

  it("groups in Go to / Profiles / Actions / Recent order and skips empty sections", () => {
    expect(groupCommands(sample).map((group) => group.section)).toEqual([
      "goto",
      "profiles",
      "actions",
    ]);
    expect(groupCommands(sample)[0]?.label).toBe("Go to");
  });
});

describe("shortcut matching", () => {
  it("matches Ctrl/⌘K and Ctrl/⌘1..3", () => {
    expect(matchShortcut(event({ key: "k", ctrlKey: true }))).toBe("palette");
    expect(matchShortcut(event({ key: "K", metaKey: true }))).toBe("palette");
    expect(matchShortcut(event({ key: "1", ctrlKey: true }))).toBe("library");
    expect(matchShortcut(event({ key: "2", metaKey: true }))).toBe("discover");
    expect(matchShortcut(event({ key: "3", ctrlKey: true }))).toBe("environments");
    expect(matchShortcut(event({ key: "1" }))).toBe(null);
  });

  it("matches [, ], /, and ? without modifiers", () => {
    expect(matchShortcut(event({ key: "[" }))).toBe("scope-global");
    expect(matchShortcut(event({ key: "]" }))).toBe("scope-project");
    expect(matchShortcut(event({ key: "/" }))).toBe("filter");
    expect(matchShortcut(event({ key: "?", shiftKey: true }))).toBe("cheat-sheet");
    expect(matchShortcut(event({ key: "/", ctrlKey: true }))).toBe(null);
  });

  it("ignores Alt chords and does not steal Esc", () => {
    expect(matchShortcut(event({ key: "k", ctrlKey: true, altKey: true }))).toBe(null);
    expect(matchShortcut(event({ key: "Escape" }))).toBe(null);
  });

  it("formats chords for Apple vs others", () => {
    expect(isApplePlatform("MacIntel")).toBe(true);
    expect(isApplePlatform("Linux x86_64")).toBe(false);
    expect(formatShortcutKeys(shortcutById("palette"), true)).toBe("⌘K");
    expect(formatShortcutKeys(shortcutById("palette"), false)).toBe("Ctrl+K");
    expect(formatShortcutKeys(shortcutById("back"), false)).toBe("Esc");
    expect(hasPrimaryModifier(event({ key: "k", ctrlKey: true }))).toBe(true);
  });
});
