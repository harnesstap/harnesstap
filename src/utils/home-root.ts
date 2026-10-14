import { homedir } from "node:os";

let homeRootOverride: string | undefined;

/**
 * Bun 1.3 worker threads keep the process HOME from startup and ignore
 * assignments. The status refresh worker sets the request home here.
 */
export function setHomeRootOverride(home: string | undefined): void {
  homeRootOverride = home;
}

export function resolveHomeRoot(): string {
  if (homeRootOverride) return homeRootOverride;
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}
