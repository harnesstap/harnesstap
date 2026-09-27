import type { OpenPathRequest } from "./types";

export const HARNESS_OPEN_LOCATION_LABEL = "Open location";

/** Inventory section paths open in the system file manager (directory or reveal file). */
export function harnessLocationOpenRequest(path: string): OpenPathRequest {
  return { path, reveal: true };
}
