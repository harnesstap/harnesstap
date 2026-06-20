export function isEscapeKey(key: { name?: string; sequence?: string }): boolean {
  return key.name === "escape" || key.sequence === "\u001b";
}

export function isSearchCharacter(key: {
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}): key is { sequence: string } {
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
