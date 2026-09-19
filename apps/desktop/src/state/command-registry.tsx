import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { shortcutSnapshot, type Command } from "../lib/commands";

interface CommandRegistry {
  commands: Command[];
  register: (owner: string, commands: Command[]) => void;
  unregister: (owner: string) => void;
}

const CommandRegistryContext = createContext<CommandRegistry | null>(null);

export function CommandRegistryProvider({ children }: { children: ReactNode }) {
  const [byOwner, setByOwner] = useState<Record<string, Command[]>>({});
  const register = useCallback((owner: string, commands: Command[]) => {
    setByOwner((current) => {
      if (current[owner] === commands) {
        return current;
      }
      return { ...current, [owner]: commands };
    });
  }, []);
  const unregister = useCallback((owner: string) => {
    setByOwner((current) => {
      if (!(owner in current)) {
        return current;
      }
      const next = { ...current };
      delete next[owner];
      return next;
    });
  }, []);
  const commands = useMemo(
    () => Object.keys(byOwner).sort().flatMap((owner) => byOwner[owner] ?? []),
    [byOwner],
  );
  const value = useMemo(
    () => ({ commands, register, unregister }),
    [commands, register, unregister],
  );
  return (
    <CommandRegistryContext.Provider value={value}>
      {children}
    </CommandRegistryContext.Provider>
  );
}

function useRegistry(): CommandRegistry {
  const ctx = useContext(CommandRegistryContext);
  if (!ctx) {
    throw new Error("useRegisterCommands must be used inside CommandRegistryProvider");
  }
  return ctx;
}

export function useCommands(): Command[] {
  return useRegistry().commands;
}

/**
 * Replace this owner's commands while mounted. `run` closures are taken from
 * the latest render; identity is keyed by id/label/disabled/shortcut.
 */
export function useRegisterCommands(owner: string, commands: Command[]): void {
  const { register, unregister } = useRegistry();
  const latest = useRef(commands);
  latest.current = commands;
  const snapshot = shortcutSnapshot(commands);
  useEffect(() => {
    register(owner, latest.current);
    return () => unregister(owner);
  }, [owner, register, snapshot, unregister]);
}
