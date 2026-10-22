import { hostPluginViewNoticesJson } from "../services/package-cache/host-plugin-view-policy.js";

export type OutputFormat = "human" | "json";

export function parseOutputFormat(
  format: string | undefined,
): OutputFormat {
  if (!format || format === "human") return "human";
  if (format === "json") return "json";
  throw new Error(`Invalid --format value: ${format}. Use human or json.`);
}

export function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) {
    return [...value].map((entry) => String(entry)).sort();
  }
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  return value;
}

export function printJson(value: unknown): void {
  // Files a plugin cache refresh kept or replaced during this command also
  // go into the JSON, next to the stderr notice.
  const notices = hostPluginViewNoticesJson();
  const withNotices =
    Object.keys(notices).length > 0
    && typeof value === "object"
    && value !== null
    && !Array.isArray(value)
      ? { ...value, ...notices }
      : value;
  console.log(JSON.stringify(withNotices, jsonReplacer, 2));
}
