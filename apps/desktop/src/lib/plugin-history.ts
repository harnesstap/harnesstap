export type PluginDetailMode = "head" | "history" | "frozen";
export type PluginPackageAction =
  | "apply"
  | "update"
  | "history"
  | "cut"
  | "fork"
  | "doctor"
  | "delete"
  | "restore";

export function shouldShowPluginHistory(input: {
  origin: "authored" | "upstream" | "catalog";
  mode: PluginDetailMode;
  isDraft: boolean;
}): boolean {
  return input.origin === "authored" && input.mode === "head" && !input.isDraft;
}

export function pluginPackageBackTarget(
  mode: PluginDetailMode,
): "list" | "head" | "history" {
  switch (mode) {
    case "frozen":
      return "history";
    case "history":
      return "head";
    case "head":
      return "list";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function pluginPackageEscapeAction(input: {
  mode: PluginDetailMode;
  fieldEditing: boolean;
  confirmOpen: boolean;
  busy: boolean;
}): "cancel-field" | "dismiss-confirm" | "noop" | "list" | "head" | "history" {
  if (input.busy) {
    return "noop";
  }
  if (input.fieldEditing) {
    return "cancel-field";
  }
  if (input.confirmOpen) {
    return "dismiss-confirm";
  }
  return pluginPackageBackTarget(input.mode);
}

export function pluginHistoryBackLabel(mode: PluginDetailMode): string {
  switch (mode) {
    case "head":
      return "Back to library list";
    case "history":
      return "Back to plugin";
    case "frozen":
      return "Back to version history";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function pluginPackageActions(input: {
  origin: "authored" | "upstream" | "catalog";
  mode: PluginDetailMode;
  frozen: boolean;
}): PluginPackageAction[] {
  if (input.mode === "history") {
    return [];
  }
  if (input.mode === "frozen" || input.frozen) {
    return ["restore"];
  }
  if (input.origin === "authored") {
    return ["apply", "history", "cut", "doctor", "delete"];
  }
  return ["apply", "update", "fork", "doctor", "delete"];
}

export function formatPluginRollbackConfirmMessage(input: {
  headVersion: string;
  frozenVersion: string;
  dirty: boolean;
}): string {
  if (input.dirty) {
    return (
      `Replace unpublished edits on ${input.headVersion}* with version ${input.frozenVersion}? ` +
      `The working head stays ${input.headVersion} and is marked dirty. This does not apply the plugin.`
    );
  }
  return (
    `Replace the working head ${input.headVersion} with version ${input.frozenVersion}? ` +
    `The working head stays ${input.headVersion} and is marked dirty. This does not apply the plugin.`
  );
}
