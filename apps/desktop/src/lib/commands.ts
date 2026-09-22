export type CommandSection = "goto" | "profiles" | "actions" | "recent";

export interface Command {
  id: string;
  section: CommandSection;
  label: string;
  shortcut?: string;
  keywords?: string[];
  disabled?: boolean;
  run: () => void;
}

export type ShortcutId =
  | "palette"
  | "library"
  | "discover"
  | "environments"
  | "harnesses"
  | "scope-global"
  | "scope-project"
  | "filter"
  | "cheat-sheet"
  | "back";

export interface ShortcutSpec {
  id: ShortcutId;
  label: string;
  /** True when the binding should not fire while typing in a field. */
  ignoreWhenTyping: boolean;
  /** True when Ctrl/⌘ must be held. */
  modifier: boolean;
  key: string;
}

export const COMMAND_SECTIONS: readonly CommandSection[] = [
  "goto",
  "profiles",
  "actions",
  "recent",
];

export const COMMAND_SECTION_LABELS: Record<CommandSection, string> = {
  goto: "Go to",
  profiles: "Profiles",
  actions: "Actions on this screen",
  recent: "Recent projects",
};

export const SHORTCUTS: readonly ShortcutSpec[] = [
  {
    id: "palette",
    label: "Command palette",
    ignoreWhenTyping: false,
    modifier: true,
    key: "k",
  },
  {
    id: "library",
    label: "Go to Library",
    ignoreWhenTyping: false,
    modifier: true,
    key: "1",
  },
  {
    id: "discover",
    label: "Go to Discover",
    ignoreWhenTyping: false,
    modifier: true,
    key: "2",
  },
  {
    id: "environments",
    label: "Go to Environments",
    ignoreWhenTyping: false,
    modifier: true,
    key: "3",
  },
  {
    id: "harnesses",
    label: "Go to Harnesses",
    ignoreWhenTyping: false,
    modifier: true,
    key: "4",
  },
  {
    id: "scope-global",
    label: "Switch to Global",
    ignoreWhenTyping: true,
    modifier: false,
    key: "[",
  },
  {
    id: "scope-project",
    label: "Switch to Project",
    ignoreWhenTyping: true,
    modifier: false,
    key: "]",
  },
  {
    id: "filter",
    label: "Focus filter",
    ignoreWhenTyping: true,
    modifier: false,
    key: "/",
  },
  {
    id: "cheat-sheet",
    label: "Keyboard shortcuts",
    ignoreWhenTyping: true,
    modifier: false,
    key: "?",
  },
  {
    id: "back",
    label: "Dismiss or Back",
    ignoreWhenTyping: false,
    modifier: false,
    key: "Escape",
  },
];

export const WORKSPACE_FILTER_ATTR = "data-workspace-filter";

export interface ModifierKeys {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface ShortcutEventLike extends ModifierKeys {
  key: string;
  target?: EventTarget | null;
}

export function isApplePlatform(
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): boolean {
  return /Mac|iPhone|iPad/i.test(platform);
}

export function formatShortcutKeys(
  spec: ShortcutSpec,
  apple = isApplePlatform(),
): string {
  if (spec.id === "back") {
    return "Esc";
  }
  if (spec.modifier) {
    const chord = apple ? "⌘" : "Ctrl+";
    const key = spec.key.length === 1 ? spec.key.toUpperCase() : spec.key;
    return `${chord}${key}`;
  }
  return spec.key;
}

export function commandMatchesQuery(command: Command, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  if (command.label.toLowerCase().includes(needle)) {
    return true;
  }
  if (command.shortcut?.toLowerCase().includes(needle)) {
    return true;
  }
  return (command.keywords ?? []).some((keyword) =>
    keyword.toLowerCase().includes(needle),
  );
}

export function filterCommands(commands: readonly Command[], query: string): Command[] {
  return commands.filter((command) => commandMatchesQuery(command, query));
}

export interface CommandGroup {
  section: CommandSection;
  label: string;
  items: Command[];
}

export function groupCommands(commands: readonly Command[]): CommandGroup[] {
  const groups: CommandGroup[] = [];
  for (const section of COMMAND_SECTIONS) {
    const items = commands.filter((command) => command.section === section);
    if (items.length === 0) {
      continue;
    }
    groups.push({
      section,
      label: COMMAND_SECTION_LABELS[section],
      items,
    });
  }
  return groups;
}

export function shortcutSnapshot(commands: readonly Command[]): string {
  return commands
    .map((command) =>
      [
        command.id,
        command.section,
        command.label,
        command.shortcut ?? "",
        command.disabled ? "1" : "0",
        (command.keywords ?? []).join(","),
      ].join(":"),
    )
    .join("|");
}

export function hasPrimaryModifier(event: ModifierKeys): boolean {
  return event.metaKey || event.ctrlKey;
}

export function matchShortcut(event: ShortcutEventLike): ShortcutId | null {
  if (event.altKey) {
    return null;
  }
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const mod = hasPrimaryModifier(event);
  for (const spec of SHORTCUTS) {
    if (spec.id === "back") {
      continue;
    }
    const specKey = spec.key.length === 1 ? spec.key.toLowerCase() : spec.key;
    if (key !== specKey) {
      continue;
    }
    if (spec.modifier !== mod) {
      continue;
    }
    if (!spec.modifier && event.shiftKey && spec.key !== "?") {
      continue;
    }
    return spec.id;
  }
  return null;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof Element === "undefined") {
    return false;
  }
  if (!(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    switch (target.type) {
      case "button":
      case "checkbox":
      case "radio":
      case "file":
      case "submit":
      case "reset":
      case "hidden":
        return false;
      default:
        return true;
    }
  }
  const element = target as HTMLElement;
  if (element.isContentEditable) {
    return true;
  }
  return element.closest("[contenteditable='true'], [role='textbox']") !== null;
}

export function focusWorkspaceFilter(root: ParentNode = document): boolean {
  const element = root.querySelector<HTMLElement>(`[${WORKSPACE_FILTER_ATTR}]`);
  if (!element) {
    return false;
  }
  if (element instanceof HTMLInputElement && element.disabled) {
    return false;
  }
  element.focus();
  if (element instanceof HTMLInputElement) {
    element.select();
  }
  return true;
}

export function shortcutById(id: ShortcutId): ShortcutSpec {
  const spec = SHORTCUTS.find((row) => row.id === id);
  if (spec) {
    return spec;
  }
  throw new Error(`unknown shortcut ${id}`);
}
