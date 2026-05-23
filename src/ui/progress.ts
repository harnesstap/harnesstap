import { icons, theme } from "./theme.js";

export const progress = {
  start: (message: string) => console.log(theme.muted(`⟳ ${message}`)),
  stop: () => {},
  succeed: (message: string) => console.log(theme.success(`${icons.success} ${message}`)),
  fail: (message: string) => console.error(theme.danger(`${icons.danger} ${message}`)),
};
