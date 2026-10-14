import * as fs from "node:fs";
import { statusTraceEnabled, traceFs } from "./status-trace.js";

/**
 * `node:fs` calls for the status scan helpers. With
 * HARNESSTAP_STATUS_CACHE_DEBUG off these are the `node:fs` functions
 * themselves. With it on, each call is counted against the current status
 * trace phase.
 */
export const existsSync: typeof fs.existsSync = statusTraceEnabled
  ? (path) => {
      traceFs("stat");
      return fs.existsSync(path);
    }
  : fs.existsSync;

export const statSync = (statusTraceEnabled
  ? (...args: Parameters<typeof fs.statSync>) => {
      traceFs("stat");
      return fs.statSync(...args);
    }
  : fs.statSync) as typeof fs.statSync;

export const readdirSync = (statusTraceEnabled
  ? (...args: Parameters<typeof fs.readdirSync>) => {
      traceFs("dir");
      return fs.readdirSync(...args);
    }
  : fs.readdirSync) as typeof fs.readdirSync;

export const readFileSync = (statusTraceEnabled
  ? (...args: Parameters<typeof fs.readFileSync>) => {
      const result = fs.readFileSync(...args);
      traceFs("read", result.length);
      return result;
    }
  : fs.readFileSync) as typeof fs.readFileSync;
