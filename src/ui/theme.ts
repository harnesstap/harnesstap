import chalk from "chalk";

// Hexes match the Flow Split brand mark (violet #8b5cf6, blue #3b82f6, teal #14b8a6).
// Keep CLI and Desktop in sync.

export type ThemeFn = (value: string) => string;

function colorEnabled(): boolean {
  return !process.env.NO_COLOR && chalk.level > 0;
}

function maybe(style: ThemeFn): ThemeFn {
  return (value) => (colorEnabled() ? style(value) : value);
}

export const icons = {
  success: "✓",
  warn: "⚠",
  danger: "✗",
  hint: "→",
  bullet: "·",
  profile: "◎",
  added: "+",
  removed: "−",
  modified: "~",
} as const;

const resourceTypeStyles: Record<string, ThemeFn> = {
  instruction: maybe((value) => chalk.hex("#60a5fa")(value)),
  skill: maybe((value) => chalk.hex("#34d399")(value)),
  rule: maybe((value) => chalk.hex("#fbbf24")(value)),
  mcp_server: maybe((value) => chalk.hex("#a78bfa")(value)),
  permission: maybe((value) => chalk.hex("#f87171")(value)),
  hook: maybe((value) => chalk.hex("#fb923c")(value)),
  agent: maybe((value) => chalk.hex("#c084fc")(value)),
  command: maybe((value) => chalk.hex("#2dd4bf")(value)),
  env_var: maybe((value) => chalk.hex("#94a3b8")(value)),
  model_config: maybe((value) => chalk.hex("#e879f9")(value)),
};

const mutedStyle = maybe((value) => chalk.hex("#6b7280")(value));

export function styleResourceType(value: string): string {
  const style = resourceTypeStyles[value];
  return style ? style(value) : mutedStyle(value);
}

export const theme = {
  // Existing tokens for backward compatibility
  primary: maybe((value) => chalk.bold(value)),
  accent: maybe((value) => chalk.hex("#3b82f6")(value)),
  muted: mutedStyle,
  success: maybe((value) => chalk.hex("#14b8a6")(value)),
  warn: maybe((value) => chalk.hex("#e6b84d")(value)),
  danger: maybe((value) => chalk.hex("#ef4444")(value)),
  badge: maybe((value) => chalk.bgHex("#3b82f6").white.bold(` ${value} `)),

  // Role-based tokens
  heading: maybe((value) => chalk.bold.hex("#3b82f6")(value)),
  label: maybe((value) => chalk.hex("#6b7280")(value)),
  command: maybe((value) => chalk.hex("#14b8a6")(value)),
  flag: maybe((value) => chalk.hex("#3b82f6")(value)),
  entity: maybe((value) => chalk.hex("#e6b84d")(value)),
  path: maybe((value) => chalk.hex("#8b5cf6")(value)),
  info: maybe((value) => chalk.hex("#6b7280")(value)),
  border: maybe((value) => chalk.hex("#374151")(value)),
  resourceType: styleResourceType,
};

export function disableColor(): void {
  process.env.NO_COLOR = "1";
  chalk.level = 0;
}

export function isTty(): boolean {
  return process.stdout.isTTY === true;
}

export function terminalColumns(): number {
  return process.stdout.columns ?? 80;
}

export function terminalRows(): number {
  return process.stdout.rows ?? 24;
}

export function getTableChars() {
  return isTty() && !process.env.NO_COLOR
    ? {}
    : {
        top: "+",
        "top-mid": "+",
        "top-left": "+",
        "top-right": "+",
        bottom: "-",
        "bottom-mid": "+",
        "bottom-left": "+",
        "bottom-right": "+",
        left: "|",
        "left-mid": "+",
        mid: "-",
        "mid-mid": "+",
        right: "|",
        "right-mid": "+",
        middle: "|",
      };
}
