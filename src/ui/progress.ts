import ora, { type Ora } from "ora";
import { icons, isTty, theme } from "./theme.js";

export interface ProgressHandle {
  succeed: (message: string) => void;
  fail: (message: string) => void;
  stop: () => void;
}

/**
 * Create a per-instance progress handle. When stdout is a TTY, shows a spinner
 * while the operation is running. In non-TTY/test environments the spinner is
 * suppressed entirely — only the resolved verdict line is emitted.
 */
export function createProgress(message: string): ProgressHandle {
  let spinner: Ora | null = null;
  if (isTty() && process.env.NODE_ENV !== "test") {
    spinner = ora(message).start();
  }

  return {
    succeed(verdict: string) {
      if (spinner) {
        spinner.succeed(verdict);
        spinner = null;
      } else {
        console.log(theme.success(`${icons.success} ${verdict}`));
      }
    },
    fail(verdict: string) {
      if (spinner) {
        spinner.fail(verdict);
        spinner = null;
      } else {
        console.error(theme.danger(`${icons.danger} ${verdict}`));
      }
    },
    stop() {
      spinner?.stop();
      spinner = null;
    },
  };
}

// Backward-compatible singleton kept for any external usages via ui.spinner.
export const progress = {
  start: (message: string): ProgressHandle => createProgress(message),
  stop: (): void => {},
  succeed: (message: string): void => {
    console.log(theme.success(`${icons.success} ${message}`));
  },
  fail: (message: string): void => {
    console.error(theme.danger(`${icons.danger} ${message}`));
  },
};
