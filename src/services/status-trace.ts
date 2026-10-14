import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-phase timing for one status computation. Enabled only when
 * HARNESSTAP_STATUS_CACHE_DEBUG=1 at process start. When it is off, every
 * helper returns after one boolean check.
 *
 * Each traced computation prints one line per phase to stderr, which the
 * desktop app appends to `ht-agent.log`:
 *
 *   [status-trace] run=3 phase=dry-run.generate-files ms=41.2 n=3 self=12.0 \
 *     fs=dir:120,stat:410,read:96/388KB db=q:14,ms:0.6 files=212 \
 *     top=claude-code:30.1,cursor:9.0,codex:2.1
 *
 * `ms` is inclusive wall time summed over `n` calls, `self` excludes nested
 * phases, `fs` and `db` count work done while the phase was the innermost
 * one (fs counts come from the scan helpers, not every fs call), and `top`
 * lists the slowest items with their inclusive ms.
 */
export const statusTraceEnabled = process.env.HARNESSTAP_STATUS_CACHE_DEBUG === "1";

const TOP_ITEMS = 6;

interface PhaseStats {
  ms: number;
  childMs: number;
  calls: number;
  dirs: number;
  stats: number;
  reads: number;
  readBytes: number;
  dbQueries: number;
  dbMs: number;
  top: Array<{ item: string; ms: number }>;
  counts: Map<string, number>;
}

interface Frame {
  phase: string;
  started: number;
  childMs: number;
}

interface Trace {
  id: number;
  label: string;
  started: number;
  phases: Map<string, PhaseStats>;
  stack: Frame[];
  slowSql: Map<string, { n: number; ms: number }>;
}

const storage = new AsyncLocalStorage<Trace>();
let traceSeq = 0;

function stats(trace: Trace, phase: string): PhaseStats {
  let entry = trace.phases.get(phase);
  if (!entry) {
    entry = {
      ms: 0,
      childMs: 0,
      calls: 0,
      dirs: 0,
      stats: 0,
      reads: 0,
      readBytes: 0,
      dbQueries: 0,
      dbMs: 0,
      top: [],
      counts: new Map(),
    };
    trace.phases.set(phase, entry);
  }
  return entry;
}

function innermost(trace: Trace): PhaseStats {
  const frame = trace.stack[trace.stack.length - 1];
  return stats(trace, frame ? frame.phase : "(other)");
}

function noteTop(entry: PhaseStats, item: string, ms: number): void {
  const top = entry.top;
  const existing = top.find((row) => row.item === item);
  if (existing) {
    existing.ms += ms;
  } else if (top.length < TOP_ITEMS) {
    top.push({ item, ms });
  } else if (ms > top[top.length - 1]!.ms) {
    top[top.length - 1] = { item, ms };
  } else {
    return;
  }
  top.sort((left, right) => right.ms - left.ms);
}

function finishFrame(trace: Trace, frame: Frame, item: string | undefined): void {
  const elapsed = performance.now() - frame.started;
  const index = trace.stack.lastIndexOf(frame);
  if (index >= 0) trace.stack.splice(index, 1);
  const entry = stats(trace, frame.phase);
  entry.ms += elapsed;
  entry.childMs += frame.childMs;
  entry.calls += 1;
  if (item !== undefined) noteTop(entry, item, elapsed);
  const parent = trace.stack[index - 1];
  if (parent) parent.childMs += elapsed;
}

/**
 * Time `fn` as `phase`. `item` names what this call worked on (a scan root,
 * a harness, a plugin) for the slowest-items list.
 */
export function traceSpan<T>(phase: string, fn: () => T, item?: string): T {
  if (!statusTraceEnabled) return fn();
  const trace = storage.getStore();
  if (!trace) return fn();
  const frame: Frame = { phase, started: performance.now(), childMs: 0 };
  trace.stack.push(frame);
  let result: T;
  try {
    result = fn();
  } catch (error) {
    finishFrame(trace, frame, item);
    throw error;
  }
  if (result && typeof (result as { then?: unknown }).then === "function") {
    return (result as unknown as Promise<unknown>).finally(() => finishFrame(trace, frame, item)) as T;
  }
  finishFrame(trace, frame, item);
  return result;
}

/** Add `n` to a named counter on `phase` (for example plugins or files seen). */
export function traceCount(phase: string, counter: string, n = 1): void {
  if (!statusTraceEnabled) return;
  const trace = storage.getStore();
  if (!trace) return;
  const entry = stats(trace, phase);
  entry.counts.set(counter, (entry.counts.get(counter) ?? 0) + n);
}

/** Record a phase measured elsewhere, such as the worker message round trip. */
export function traceRecord(label: string, fields: Record<string, number | string>): void {
  if (!statusTraceEnabled) return;
  const parts = Object.entries(fields).map(([key, value]) =>
    `${key}=${typeof value === "number" ? value.toFixed(1) : value}`,
  );
  console.error(`[status-trace] ${label} ${parts.join(" ")}`);
}

/** Note one SQL statement run while a trace is active. */
export function traceDb(sql: string, ms: number): void {
  const trace = storage.getStore();
  if (!trace) return;
  const entry = innermost(trace);
  entry.dbQueries += 1;
  entry.dbMs += ms;
  const key = sql.replace(/\s+/g, " ").trim().slice(0, 60);
  const row = trace.slowSql.get(key) ?? { n: 0, ms: 0 };
  row.n += 1;
  row.ms += ms;
  trace.slowSql.set(key, row);
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)}KB`;
}

function formatPhase(trace: Trace, phase: string, entry: PhaseStats): string {
  const parts = [
    `[status-trace] run=${trace.id} phase=${phase}`,
    `ms=${entry.ms.toFixed(1)}`,
    `n=${entry.calls}`,
    `self=${Math.max(0, entry.ms - entry.childMs).toFixed(1)}`,
  ];
  if (entry.dirs || entry.stats || entry.reads) {
    parts.push(
      `fs=dir:${entry.dirs},stat:${entry.stats},read:${entry.reads}/${kb(entry.readBytes)}`,
    );
  }
  if (entry.dbQueries) parts.push(`db=q:${entry.dbQueries},ms:${entry.dbMs.toFixed(1)}`);
  for (const [counter, value] of entry.counts) parts.push(`${counter}=${value}`);
  if (entry.top.length > 0) {
    parts.push(`top=${entry.top.map((row) => `${row.item}:${row.ms.toFixed(1)}`).join(",")}`);
  }
  return parts.join(" ");
}

function report(trace: Trace): void {
  const total = performance.now() - trace.started;
  const lines = [`[status-trace] run=${trace.id} phase=total ms=${total.toFixed(1)} label=${trace.label}`];
  const ordered = [...trace.phases.entries()].sort((left, right) => right[1].ms - left[1].ms);
  for (const [phase, entry] of ordered) lines.push(formatPhase(trace, phase, entry));
  const sql = [...trace.slowSql.entries()].sort((left, right) => right[1].ms - left[1].ms).slice(0, TOP_ITEMS);
  if (sql.length > 0) {
    lines.push(
      `[status-trace] run=${trace.id} phase=db.top ${sql.map(([key, row]) => `"${key}":n=${row.n},ms=${row.ms.toFixed(1)}`).join(" ")}`,
    );
  }
  console.error(lines.join("\n"));
}

/** Run one status computation under a trace and print its phase lines. */
export function runTracedStatus<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!statusTraceEnabled) return fn();
  const trace: Trace = {
    id: ++traceSeq,
    label,
    started: performance.now(),
    phases: new Map(),
    stack: [],
    slowSql: new Map(),
  };
  return storage.run(trace, () => fn().finally(() => report(trace)));
}

/**
 * Count file system work against the innermost phase. Call sites are the
 * scan helpers status uses (plugin caches, manifests, signatures). A
 * monkeypatch of `node:fs` would miss bundled code in the compiled sidecar.
 */
export function traceFs(kind: "dir" | "stat" | "read", bytes = 0): void {
  if (!statusTraceEnabled) return;
  const trace = storage.getStore();
  if (!trace) return;
  const entry = innermost(trace);
  if (kind === "dir") entry.dirs += 1;
  else if (kind === "stat") entry.stats += 1;
  else {
    entry.reads += 1;
    entry.readBytes += bytes;
  }
}
