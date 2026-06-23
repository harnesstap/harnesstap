export function isEscapeKey(key: { name?: string; sequence?: string }): boolean {
  return key.name === "escape" || key.sequence === "\u001b";
}

export function isLetterKey(key: InteractiveKeypress, letter: string): boolean {
  return !key.ctrl && !key.meta && key.name === letter;
}

/** Key shape from @inquirer/core useKeypress, shared by prompt helpers. */
export type InteractiveKeypress = {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
};

/** Widen partial key events for @inquirer/core key guards. */
export function toInquirerKey(key: InteractiveKeypress) {
  return {
    name: key.name ?? "",
    sequence: key.sequence ?? "",
    ctrl: key.ctrl ?? false,
    meta: key.meta ?? false,
    shift: key.shift ?? false,
  };
}

export function isSearchCharacter(key: InteractiveKeypress): key is InteractiveKeypress & { sequence: string } {
  return Boolean(
    key.sequence
      && key.sequence.length === 1
      && key.sequence.trim().length > 0
      && !key.ctrl
      && !key.meta,
  );
}

export function clampActiveIndex(active: number, length: number): number {
  if (length === 0) {
    return 0;
  }
  return Math.max(0, Math.min(active, length - 1));
}

export const interactivePromptTheme = {
  helpMode: "always" as const,
  style: {
    keysHelpTip: (keys: Array<[string, string]>) =>
      keys.map(([key, action]) => `${key} ${action}`).join(" • "),
  },
};

export function buildHelpLine(keys: Array<[string, string]>): string {
  return interactivePromptTheme.style.keysHelpTip(keys);
}
