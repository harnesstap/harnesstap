export type OutputFormat = "human" | "json";

export function parseOutputFormat(
  format: string | undefined,
): OutputFormat {
  if (!format || format === "human") return "human";
  if (format === "json") return "json";
  throw new Error(`Invalid --format value: ${format}. Use human or json.`);
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
