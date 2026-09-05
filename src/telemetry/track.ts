import { PACKAGE_VERSION } from "../version.js";
import { captureEvent } from "./capture.js";
import { isTelemetryEnabled } from "./config.js";
import { detectCliInstallMethod } from "./install-method.js";
import { extractCloudUserId } from "./sanitize.js";
import {
  loadTelemetryState,
  resolveDistinctId,
  updateTelemetryState,
} from "./state.js";
import type { PluginInstallSource } from "./types.js";

export function trackCliStartup(): void {
  try {
    if (!isTelemetryEnabled()) {
      return;
    }
    const state = loadTelemetryState();
    const version = PACKAGE_VERSION;
    if (!state.cli_installed_at) {
      captureEvent("cli_installed", {
        install_method: detectCliInstallMethod(),
        version,
      });
    }
    if (!state.cli_first_run_at) {
      captureEvent("cli_first_run", { version });
    }
    const now = new Date().toISOString();
    updateTelemetryState({
      ...(state.cli_installed_at ? {} : { cli_installed_at: now }),
      ...(state.cli_first_run_at ? {} : { cli_first_run_at: now }),
    });
  } catch {
    // swallow
  }
}

export function trackDesktopStartup(): void {
  try {
    if (!isTelemetryEnabled()) {
      return;
    }
    const state = loadTelemetryState();
    const version = PACKAGE_VERSION;
    captureEvent("desktop_opened", { version });
    if (!state.desktop_installed_at) {
      captureEvent("desktop_installed", { version, os: process.platform });
    }
    if (!state.desktop_first_open_at) {
      captureEvent("desktop_first_open", { version });
    }
    const now = new Date().toISOString();
    updateTelemetryState({
      ...(state.desktop_installed_at ? {} : { desktop_installed_at: now }),
      ...(state.desktop_first_open_at ? {} : { desktop_first_open_at: now }),
    });
  } catch {
    // swallow
  }
}

export function trackCloudConnectStarted(): void {
  captureEvent("cloud_connect_started", {});
}

export function trackCloudConnectFailed(reason: string, errorCode?: string): void {
  captureEvent("cloud_connect_failed", {
    reason,
    ...(errorCode ? { error_code: errorCode } : {}),
  });
}

/**
 * Cloud user ids are personal identifiers. Consent copy promises we do not send them.
 * Kept as a no-op so existing call sites compile without joining identity.
 */
export function identifyFromCloudWhoami(input: {
  orgId?: string;
  userId?: string;
  whoami?: Record<string, unknown>;
}): string | undefined {
  try {
    return extractCloudUserId(input.whoami, input.userId);
  } catch {
    return undefined;
  }
}

export function trackCloudConnected(_input: {
  orgId?: string;
  userId?: string;
  whoami?: Record<string, unknown>;
}): void {
  captureEvent("cloud_connected", {});
  captureEvent("signed_in", {});
}

export function trackPluginInstalled(input: {
  pluginSlug: string;
  source: PluginInstallSource;
  orgId?: string;
}): void {
  void input.pluginSlug;
  void input.orgId;
  captureEvent("plugin_installed", { source: input.source });
}

export function trackPluginApplied(input: {
  pluginSlug: string;
  harness?: string;
  orgId?: string;
}): void {
  void input.pluginSlug;
  void input.orgId;
  captureEvent("plugin_applied", {
    ...(input.harness ? { harness: input.harness } : {}),
  });
}

export function trackPluginUsed(input: {
  pluginSlug: string;
  harness?: string;
  orgId?: string;
}): void {
  void input.pluginSlug;
  void input.orgId;
  captureEvent("plugin_used", {
    ...(input.harness ? { harness: input.harness } : {}),
  });
}

export { resolveDistinctId };
