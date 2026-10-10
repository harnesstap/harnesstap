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
  console.log(JSON.stringify(value, jsonReplacer, 2));
}
