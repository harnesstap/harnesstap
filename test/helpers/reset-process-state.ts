/**
 * Test preload: put process-wide HarnessTap state back after every test.
 *
 * All test files share one process, and a randomized run interleaves them. Host
 * plugin refreshes record what they kept, replaced, blocked or added in module
 * state that the CLI drains once per command, so a test that runs a refresh and
 * does not drain it would otherwise change the counts a later test prints.
 */
import { afterEach } from "bun:test";
import {
  setHostPluginViewForceReplace,
  takeBlockedHostPluginViewFiles,
  takeKeptHostPluginViewFiles,
  takeReplacedHostPluginViewFiles,
} from "../../src/services/package-cache/host-plugin-view-policy.ts";

export function resetHostPluginViewState(): void {
  takeKeptHostPluginViewFiles();
  takeBlockedHostPluginViewFiles();
  // Also forgets the added files.
  takeReplacedHostPluginViewFiles();
  setHostPluginViewForceReplace(false);
}

resetHostPluginViewState();
afterEach(resetHostPluginViewState);
