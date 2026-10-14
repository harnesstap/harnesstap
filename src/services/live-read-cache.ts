import { clearCursorPluginInstallsCache } from "../plugins/cursor-inventory.js";
import { clearGlobalProfileStatusCache } from "./status-read-cache.js";

/**
 * Drop cached Cursor inventory and status reads.
 * Call after apply, switch, and install so a same-millisecond write cannot
 * be served from the previous snapshot.
 */
export function clearLiveReadCaches(): void {
  clearGlobalProfileStatusCache();
  clearCursorPluginInstallsCache();
}
