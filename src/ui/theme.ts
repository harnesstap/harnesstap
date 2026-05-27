import chalk from "chalk";

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
  added: "+",
  removed: "−",
  modified: "~",
} as const;

export const theme = {
  // Existing tokens for backward compatibility
  primary: maybe((value) => chalk.bold(value)),
  accent: maybe((value) => chalk.hex("#3b82f6")(value)),
  muted: maybe((value) => chalk.hex("#6b7280")(value)),
  success: maybe((value) => chalk.hex("#10b981")(value)),
  warn: maybe((value) => chalk.hex("#f59e0b")(value)),
  danger: maybe((value) => chalk.hex("#ef4444")(value)),
  badge: maybe((value) => chalk.bgHex("#1d4ed8").white.bold(` ${value} `)),

  // Role-based tokens
  heading: maybe((value) => chalk.bold.hex("#3b82f6")(value)),
  label: maybe((value) => chalk.hex("#6b7280")(value)),
  command: maybe((value) => chalk.hex("#10b981")(value)),
  flag: maybe((value) => chalk.hex("#3b82f6")(value)),
  entity: maybe((value) => chalk.hex("#f59e0b")(value)),
  path: maybe((value) => chalk.hex("#8b5cf6")(value)),
  info: maybe((value) => chalk.hex("#6b7280")(value)),
  border: maybe((value) => chalk.hex("#374151")(value)),
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
