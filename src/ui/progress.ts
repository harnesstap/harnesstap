import ora, { type Ora } from "ora";
import { icons, isTty, theme } from "./theme.js";

let _spinner: Ora | null = null;

export const progress = {
  start: (message: string) => {
    if (isTty()) {
      _spinner = ora(message).start();
    } else {
      console.log(theme.muted(`⟳ ${message}`));
    }
  },
  stop: () => {
    _spinner?.stop();
    _spinner = null;
  },
  succeed: (message: string) => {
    if (_spinner) {
      _spinner.succeed(message);
      _spinner = null;
    } else {
      console.log(theme.success(`${icons.success} ${message}`));
    }
  },
  fail: (message: string) => {
    if (_spinner) {
      _spinner.fail(message);
      _spinner = null;
    } else {
      console.error(theme.danger(`${icons.danger} ${message}`));
    }
  },
};
