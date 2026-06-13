import { icons, theme } from "./theme.js";

function line(icon: string, message: string): string {
  return `${icon} ${message}`;
}

export function renderSuccess(message: string, opts?: { hint?: string }): string {
  return opts?.hint
    ? `${theme.success(line(icons.success, message))}\n  ${theme.info(`${icons.hint} ${opts.hint}`)}`
    : theme.success(line(icons.success, message));
}

export function renderWarn(message: string, opts?: { hint?: string }): string {
  return opts?.hint
    ? `${theme.warn(line(icons.warn, message))}\n  ${theme.info(`${icons.hint} ${opts.hint}`)}`
    : theme.warn(line(icons.warn, message));
}

export function renderDanger(
  message: string,
  opts?: { hint?: string; hints?: string[] },
): string {
  const hints = opts?.hints ?? (opts?.hint ? [opts.hint] : []);
  const base = theme.danger(line(icons.danger, message));
  if (hints.length === 0) {
    return base;
  }
  return `${base}\n${hints.map((hint) => `  ${theme.info(`${icons.hint} ${hint}`)}`).join("\n")}`;
}

export const status = {
  success: (message: string, opts?: { hint?: string }) => console.log(renderSuccess(message, opts)),
  warn: (message: string, opts?: { hint?: string }) => console.log(renderWarn(message, opts)),
  danger: (message: string, opts?: { hint?: string; hints?: string[] }) =>
    console.error(renderDanger(message, opts)),
  info: (message: string) => console.log(theme.info(message)),
  dim: (message: string) => console.log(theme.info(message)),
  hint: (message: string) => console.log(`  ${theme.info(`${icons.hint} ${message}`)}`),
};
