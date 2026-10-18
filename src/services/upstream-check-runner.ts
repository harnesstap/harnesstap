import { ulid } from "ulid";
import {
  loadUpdateSettings,
  UPDATE_FREQUENCY_MS,
  type UpdateSettings,
} from "../config/settings.js";
import { getDb, getHarnesstapDir } from "../db/connection.js";
import { isProfilePlugin } from "../constants/profile.js";
import { listPlugins } from "../models/plugin-model.js";
import { listComposedDependencies } from "./plugin-extends.js";
import { upstreamRefBase } from "./plugin-upstream.js";
import {
  isPendingUpdate,
  readUpstreamCheckSummary,
  readUpstreamChecks,
  type UpstreamCheckRow,
  type UpstreamCheckSummary,
} from "./upstream-check-read.js";
import { runUpstreamCheck, type UpstreamCheckReport } from "./upstream-check.js";
import { runAutoInstall, type AutoInstallRow } from "./upstream-auto-install.js";
import { UpstreamUpdateLockBusyError, withUpstreamUpdateLock } from "./upstream-update-lock.js";

/**
 * The sidecar looks 30 s after start and then every 10 minutes whether a
 * check is due under `updates.frequency` (hourly, daily or weekly), measured
 * from the newest stored check, so restarting the app does not re-check.
 */
export const UPSTREAM_CHECK_TICK_MS = 10 * 60 * 1000;
export const UPSTREAM_CHECK_INITIAL_DELAY_MS = 30 * 1000;

export type UpstreamCheckJobState = "running" | "done" | "failed";

export interface UpstreamCheckJob {
  job_id: string;
  state: UpstreamCheckJobState;
  started_at: string;
  finished_at?: string;
  checked?: number;
  /** Scheduled run in install mode: what was installed or skipped. */
  installed?: AutoInstallRow[];
  /** Scheduled run skipped because another plugin update held the lock. */
  skipped?: string;
  error?: string;
}

const JOBS_KEPT = 20;
const jobs = new Map<string, UpstreamCheckJob>();
let inflight: { job: UpstreamCheckJob; promise: Promise<UpstreamCheckReport> } | null = null;

type Runner = () => Promise<UpstreamCheckReport>;
let runner: Runner = () => runUpstreamCheck();
type Installer = () => Promise<AutoInstallRow[]>;
let installer: Installer = () => runAutoInstall();

/** Tests swap the check and the installer. */
export function setUpstreamCheckRunnerForTests(next: Runner | null, nextInstaller?: Installer | null): void {
  runner = next ?? (() => runUpstreamCheck());
  installer = nextInstaller ?? (() => runAutoInstall());
}

/**
 * One check at a time. A second request while one runs joins it and gets
 * the same job.
 */
export function startUpstreamCheckJob(opts?: {
  /** Scheduled run: hold the update lock (skip when busy) and install when asked. */
  scheduled?: boolean;
  install?: boolean;
}): { job: UpstreamCheckJob; promise: Promise<UpstreamCheckReport> } {
  if (inflight) return inflight;
  const job: UpstreamCheckJob = { job_id: ulid(), state: "running", started_at: new Date().toISOString() };
  jobs.set(job.job_id, job);
  while (jobs.size > JOBS_KEPT) {
    const oldest = jobs.keys().next().value;
    if (oldest === undefined) break;
    jobs.delete(oldest);
  }
  const work = async (): Promise<UpstreamCheckReport> => {
    const report = await runner();
    job.checked = report.rows.length;
    if (opts?.install) job.installed = await installer();
    return report;
  };
  const run = opts?.scheduled
    ? withUpstreamUpdateLock(work).catch((error: unknown) => {
        if (!(error instanceof UpstreamUpdateLockBusyError)) throw error;
        job.skipped = "another plugin update is running";
        return { checked_at: job.started_at, rows: [] } satisfies UpstreamCheckReport;
      })
    : work();
  const promise = run
    .then((report) => {
      job.state = "done";
      return report;
    })
    .catch((error: unknown) => {
      job.state = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      throw error;
    })
    .finally(() => {
      job.finished_at = new Date().toISOString();
      inflight = null;
    });
  // The schedule and the API may not await it; never leave a rejection unhandled.
  promise.catch(() => {});
  inflight = { job, promise };
  return inflight;
}

export function getUpstreamCheckJob(jobId: string): UpstreamCheckJob | undefined {
  return jobs.get(jobId);
}

/** `HARNESSTAP_UPDATE_CHECK=off` turns the background schedule off (CI, visual baselines). */
export function upstreamCheckScheduleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HARNESSTAP_UPDATE_CHECK ?? "").toLowerCase() !== "off";
}

/** Newest stored check time, or null when nothing was checked yet. */
export function lastUpstreamCheckAt(): Date | null {
  try {
    const row = getDb().prepare("SELECT MAX(checked_at) AS at FROM upstream_checks").get() as
      | { at: string | null }
      | undefined;
    if (!row?.at) return null;
    const at = new Date(row.at);
    return Number.isNaN(at.getTime()) ? null : at;
  } catch {
    return null;
  }
}

/** Whether a scheduled check should run now. `off` never checks in the background. */
export function upstreamCheckDue(settings: UpdateSettings, last: Date | null, now: Date): boolean {
  if (settings.mode === "off") return false;
  if (!last) return true;
  return now.getTime() - last.getTime() >= UPDATE_FREQUENCY_MS[settings.frequency];
}

// With no upstream links the table stays empty; this keeps the cadence anyway.
let lastScheduledAt: Date | null = null;

export function resetUpstreamScheduleForTests(): void {
  lastScheduledAt = null;
}

/** One schedule tick: reads the settings each time, so a change applies without a restart. */
export function runScheduledUpstreamCheck(now: Date = new Date()): UpstreamCheckJob | null {
  let settings: UpdateSettings;
  try {
    settings = loadUpdateSettings(getHarnesstapDir());
  } catch {
    return null;
  }
  const stored = lastUpstreamCheckAt();
  const last = stored && lastScheduledAt ? (stored > lastScheduledAt ? stored : lastScheduledAt) : (stored ?? lastScheduledAt);
  if (!upstreamCheckDue(settings, last, now)) return null;
  lastScheduledAt = now;
  return startUpstreamCheckJob({ scheduled: true, install: settings.mode === "install" }).job;
}

/** Starts the sidecar schedule. Returns a stop function. Timers never keep the process alive. */
export function startUpstreamCheckSchedule(opts?: {
  intervalMs?: number;
  initialDelayMs?: number;
}): () => void {
  const intervalMs = opts?.intervalMs ?? UPSTREAM_CHECK_TICK_MS;
  const initialDelayMs = opts?.initialDelayMs ?? UPSTREAM_CHECK_INITIAL_DELAY_MS;
  let interval: ReturnType<typeof setInterval> | undefined;
  const tick = () => {
    try {
      runScheduledUpstreamCheck();
    } catch {
      // A failed tick never stops the agent; the next tick tries again.
    }
  };
  const first = setTimeout(() => {
    tick();
    interval = setInterval(tick, intervalMs);
    interval.unref?.();
  }, initialDelayMs);
  first.unref?.();
  return () => {
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
}

export interface UpdateListRow extends UpstreamCheckRow {
  /** `extends`, `fork` or `catalog`; a fork has no automatic update. */
  kind: "extends" | "fork" | "catalog" | "unknown";
  /** Shown in the banner and rail: an update or major not set aside with Not now. */
  pending: boolean;
  /** Profiles that are this plugin or use it, for the rail dot. */
  profiles: string[];
}

export interface UpdateList {
  rows: UpdateListRow[];
  summary: UpstreamCheckSummary;
}

/** The table plus what Desktop needs to place it. No network. */
export function listUpdates(): UpdateList {
  const rows = readUpstreamChecks();
  const plugins = listPlugins().filter((plugin) => !plugin.frozen_at);
  const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]));
  const profiles = plugins.filter(isProfilePlugin);
  const depNames = new Map<string, Set<string>>();
  const depsOf = (profileId: string): Set<string> => {
    let names = depNames.get(profileId);
    if (!names) {
      try {
        names = new Set(listComposedDependencies(profileId).map((dependency) => dependency.name));
      } catch {
        names = new Set();
      }
      depNames.set(profileId, names);
    }
    return names;
  };
  return {
    rows: rows.map((row) => {
      const plugin = byName.get(row.plugin_name);
      const kind = plugin?.upstream?.kind ?? (plugin?.origin === "catalog" ? "catalog" : "unknown");
      const pending = isPendingUpdate(row);
      const base = upstreamRefBase(row.ref);
      const affected = pending
        ? profiles
            .filter((profile) => {
              if (profile.name === row.plugin_name) return true;
              const names = depsOf(profile.id);
              return names.has(row.plugin_name) || names.has(base);
            })
            .map((profile) => profile.name)
        : [];
      return { ...row, kind, pending, profiles: affected };
    }),
    summary: readUpstreamCheckSummary(),
  };
}
