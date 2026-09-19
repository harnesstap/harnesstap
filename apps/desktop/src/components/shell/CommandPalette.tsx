import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { shouldCloseDialogOnBackdrop } from "../../lib/dialog-dismiss";
import {
  filterCommands,
  focusWorkspaceFilter,
  formatShortcutKeys,
  groupCommands,
  isEditableTarget,
  matchShortcut,
  SHORTCUTS,
  shortcutById,
  type Command,
  type ShortcutId,
} from "../../lib/commands";
import { isListboxNavKey, nextListboxIndex } from "../../lib/listbox-nav";
import { loadRecentProjects, projectDisplayName } from "../../lib/recent-projects";
import {
  useCommands,
  useRegisterCommands,
} from "../../state/command-registry";
import {
  destinationForNumberKey,
  type Navigation,
  type Scope,
} from "../../state/navigation";
import { overlayStack, useOverlayLayer } from "../../state/overlay-stack";
import type { Overlays } from "../../state/overlays";
import type { ScopeController } from "../../state/scope-controller";
import { Presence } from "../motion/Presence";
import { motionClass } from "../motion/motion-utils";

export interface CommandPaletteHostProps {
  nav: Navigation;
  overlays: Overlays;
  ctrl: ScopeController;
  onSelectScope: (next: Scope) => void;
  onSelectProject: (path: string) => void;
  ensureProjectReady: (pathOverride?: string) => Promise<boolean>;
}

export function CommandPaletteHost({
  nav,
  overlays,
  ctrl,
  onSelectScope,
  onSelectProject,
  ensureProjectReady,
}: CommandPaletteHostProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);
  const [recentTick, setRecentTick] = useState(0);
  const registered = useCommands();

  const shellCommands = useMemo((): Command[] => {
    void recentTick;
    const goto: Command[] = [
      {
        id: "goto-library",
        section: "goto",
        label: "Library",
        shortcut: formatShortcutKeys(shortcutById("library")),
        keywords: ["resources"],
        run: () => nav.go("library"),
      },
      {
        id: "goto-discover",
        section: "goto",
        label: "Discover",
        shortcut: formatShortcutKeys(shortcutById("discover")),
        keywords: ["sources", "marketplace"],
        run: () => nav.go("discover"),
      },
      {
        id: "goto-environments",
        section: "goto",
        label: "Environments",
        shortcut: formatShortcutKeys(shortcutById("environments")),
        keywords: ["env"],
        run: () => nav.go("environments"),
      },
      {
        id: "goto-global",
        section: "goto",
        label: "Global",
        shortcut: formatShortcutKeys(shortcutById("scope-global")),
        keywords: ["scope", "home"],
        run: () => onSelectScope("global"),
      },
      {
        id: "goto-project",
        section: "goto",
        label: "Project",
        shortcut: formatShortcutKeys(shortcutById("scope-project")),
        keywords: ["scope"],
        run: () => onSelectScope("project"),
      },
      {
        id: "goto-settings",
        section: "goto",
        label: "Settings",
        keywords: ["preferences"],
        run: () => overlays.openOverlay("settings"),
      },
      {
        id: "goto-account",
        section: "goto",
        label: "Account",
        keywords: ["cloud", "sign in"],
        run: () => overlays.openOverlay("cloudAccount"),
      },
    ];
    const profiles: Command[] = ctrl.visibleProfiles.map((profile) => ({
      id: `profile-select-${profile.name}`,
      section: "profiles" as const,
      label: `Select ${profile.name}`,
      keywords: [profile.name, profile.description ?? ""],
      run: () => {
        nav.go("scope");
        ctrl.selectProfile(profile.name);
      },
    }));
    if (ctrl.selectedProfile) {
      const applyLabel = ctrl.showReapply
        ? `Re-apply ${ctrl.selectedProfile}`
        : `Apply ${ctrl.selectedProfile}`;
      profiles.push({
        id: "profile-apply",
        section: "profiles",
        label: applyLabel,
        disabled: ctrl.applyDisabled,
        keywords: ["switch"],
        run: () => {
          nav.go("scope");
          ctrl.onApplyClick();
        },
      });
    }
    const recent: Command[] = loadRecentProjects().map((row) => ({
      id: `recent-${row.path}`,
      section: "recent" as const,
      label: projectDisplayName(row.path),
      keywords: [row.path],
      run: () => {
        void (async () => {
          onSelectProject(row.path);
          if (await ensureProjectReady(row.path)) {
            nav.go("scope");
            nav.setScope("project");
          }
        })();
      },
    }));
    return [...goto, ...profiles, ...recent];
  }, [
    ctrl.applyDisabled,
    ctrl.onApplyClick,
    ctrl.selectProfile,
    ctrl.selectedProfile,
    ctrl.showReapply,
    ctrl.visibleProfiles,
    ensureProjectReady,
    nav,
    onSelectProject,
    onSelectScope,
    overlays,
    recentTick,
  ]);

  useRegisterCommands("shell", shellCommands);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeCheatSheet = useCallback(() => setCheatSheetOpen(false), []);

  const runShortcut = useCallback(
    (id: ShortcutId) => {
      switch (id) {
        case "palette":
          setCheatSheetOpen(false);
          setPaletteOpen((open) => {
            const next = !open;
            if (next) {
              setRecentTick((value) => value + 1);
            }
            return next;
          });
          return;
        case "cheat-sheet":
          setPaletteOpen(false);
          setCheatSheetOpen((open) => !open);
          return;
        case "library":
        case "discover":
        case "environments": {
          const key = id === "library" ? "1" : id === "discover" ? "2" : "3";
          const destination = destinationForNumberKey(key);
          if (destination) {
            setPaletteOpen(false);
            setCheatSheetOpen(false);
            nav.go(destination);
          }
          return;
        }
        case "scope-global":
          setPaletteOpen(false);
          onSelectScope("global");
          return;
        case "scope-project":
          setPaletteOpen(false);
          onSelectScope("project");
          return;
        case "filter":
          setPaletteOpen(false);
          setCheatSheetOpen(false);
          focusWorkspaceFilter();
          return;
        case "back":
          return;
        default: {
          const neverId: never = id;
          return neverId;
        }
      }
    },
    [nav, onSelectScope],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const id = matchShortcut(event);
      if (!id) {
        return;
      }
      const spec = shortcutById(id);
      if (spec.ignoreWhenTyping && isEditableTarget(event.target) && !paletteOpen) {
        return;
      }
      const top = overlayStack.top();
      if (top?.isCloseDisabled()) {
        return;
      }
      if (paletteOpen && id !== "palette") {
        return;
      }
      if (cheatSheetOpen && id !== "cheat-sheet" && id !== "palette") {
        return;
      }
      event.preventDefault();
      runShortcut(id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cheatSheetOpen, paletteOpen, runShortcut]);

  return (
    <>
      <CommandPalette
        open={paletteOpen}
        commands={registered}
        onClose={closePalette}
      />
      <ShortcutCheatSheet open={cheatSheetOpen} onClose={closeCheatSheet} />
    </>
  );
}

function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const titleId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useOverlayLayer({
    open,
    onClose,
    initialFocusRef: inputRef,
  });

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const visible = useMemo(() => filterCommands(commands, query), [commands, query]);
  const groups = useMemo(() => groupCommands(visible), [visible]);

  useEffect(() => {
    setActive((current) => {
      if (visible.length === 0) {
        return 0;
      }
      return Math.min(current, visible.length - 1);
    });
  }, [visible.length]);

  const runActive = useCallback(() => {
    const command = visible[active];
    if (!command || command.disabled) {
      return;
    }
    onClose();
    command.run();
  }, [active, onClose, visible]);

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isListboxNavKey(event.key)) {
      const key = event.key;
      event.preventDefault();
      setActive((current) => nextListboxIndex(current, key, visible.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      runActive();
    }
  };

  let optionIndex = -1;

  return (
    <Presence
      open={open}
      enter="m-scrim-in"
      exit="m-scrim-out"
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (shouldCloseDialogOnBackdrop(event.target, event.currentTarget)) {
          onClose();
        }
      }}
    >
      {(state) => (
        <div
          ref={rootRef}
          className={motionClass("dialog command-palette", "m-rise", state)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <h2 id={titleId} className="sr-only">
            Command palette
          </h2>
          <input
            ref={inputRef}
            className="command-palette-input"
            type="search"
            value={query}
            placeholder="Go to or run…"
            aria-label="Filter commands"
            aria-controls={listId}
            aria-activedescendant={
              visible[active] ? `${listId}-${visible[active]?.id}` : undefined
            }
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
          />
          <div
            id={listId}
            className="command-palette-list"
            role="listbox"
            aria-label="Commands"
          >
            {visible.length === 0 ? (
              <p className="command-palette-empty">{`No results for "${query.trim()}"`}</p>
            ) : (
              groups.map((group) => (
                <div key={group.section} className="command-palette-group">
                  <div className="command-palette-group-label">{group.label}</div>
                  {group.items.map((command) => {
                    optionIndex += 1;
                    const index = optionIndex;
                    const activeOption = index === active;
                    return (
                      <button
                        key={command.id}
                        id={`${listId}-${command.id}`}
                        type="button"
                        role="option"
                        className={
                          activeOption
                            ? "command-palette-item is-active"
                            : "command-palette-item"
                        }
                        aria-selected={activeOption}
                        disabled={command.disabled}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => {
                          if (command.disabled) {
                            return;
                          }
                          onClose();
                          command.run();
                        }}
                      >
                        <span className="command-palette-item-label">{command.label}</span>
                        {command.shortcut ? (
                          <kbd className="command-palette-kbd">{command.shortcut}</kbd>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Presence>
  );
}

function ShortcutCheatSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const rootRef = useOverlayLayer({
    open,
    onClose,
    initialFocusRef: closeRef,
  });

  return (
    <Presence
      open={open}
      enter="m-scrim-in"
      exit="m-scrim-out"
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (shouldCloseDialogOnBackdrop(event.target, event.currentTarget)) {
          onClose();
        }
      }}
    >
      {(state) => (
        <div
          ref={rootRef}
          className={motionClass("dialog shortcut-cheat-sheet", "m-rise", state)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <h2 id={titleId}>Keyboard shortcuts</h2>
          <table className="shortcut-cheat-sheet-table">
            <caption className="sr-only">Desktop keyboard shortcuts</caption>
            <thead>
              <tr>
                <th scope="col">Shortcut</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map((spec) => (
                <tr key={spec.id}>
                  <td>
                    <kbd className="command-palette-kbd">
                      {formatShortcutKeys(spec)}
                    </kbd>
                  </td>
                  <td>{spec.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dialog-actions">
            <button
              ref={closeRef}
              type="button"
              className="btn"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Presence>
  );
}
