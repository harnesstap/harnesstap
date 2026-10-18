import { ulid } from "ulid";
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

/** Default sidecar cadence: at start (after a short delay) and then every 6 hours. */
export const UPSTREAM_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPSTREAM_CHECK_INITIAL_DELAY_MS = 30 * 1000;

export type UpstreamCheckJobState = "running" | "done" | "failed";

export interface UpstreamCheckJob {
  job_id: string;
  state: UpstreamCheckJobState;
  started_at: string;
  finished_at?: string;
  checked?: number;
  error?: string;
}

const JOBS_KEPT = 20;
const jobs = new Map<string, UpstreamCheckJob>();
let inflight: { job: UpstreamCheckJob; promise: Promise<UpstreamCheckReport> } | null = null;

type Runner = () => Promise<UpstreamCheckReport>;
let runner: Runner = () => runUpstreamCheck();

/** Tests swap the check itself. */
export function setUpstreamCheckRunnerForTests(next: Runner | null): void {
  runner = next ?? (() => runUpstreamCheck());
}

/**
 * One check at a time. A second request while one runs joins it and gets
 * the same job.
 */
export function startUpstreamCheckJob(): { job: UpstreamCheckJob; promise: Promise<UpstreamCheckReport> } {
  if (inflight) return inflight;
  const job: UpstreamCheckJob = { job_id: ulid(), state: "running", started_at: new Date().toISOString() };
  jobs.set(job.job_id, job);
  while (jobs.size > JOBS_KEPT) {
    const oldest = jobs.keys().next().value;
    if (oldest === undefined) break;
    jobs.delete(oldest);
  }
  const promise = runner()
    .then((report) => {
      job.state = "done";
      job.checked = report.rows.length;
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

/** Starts the sidecar schedule. Returns a stop function. Timers never keep the process alive. */
export function startUpstreamCheckSchedule(opts?: {
  intervalMs?: number;
  initialDelayMs?: number;
}): () => void {
  const intervalMs = opts?.intervalMs ?? UPSTREAM_CHECK_INTERVAL_MS;
  const initialDelayMs = opts?.initialDelayMs ?? UPSTREAM_CHECK_INITIAL_DELAY_MS;
  let interval: ReturnType<typeof setInterval> | undefined;
  const tick = () => {
    startUpstreamCheckJob();
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
