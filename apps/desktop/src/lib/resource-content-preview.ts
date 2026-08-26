export const RESOURCE_CONTENT_PREVIEW_LINES = 15;

export function previewResourceContent(
  content: string,
  maxLines = RESOURCE_CONTENT_PREVIEW_LINES,
): string {
  const lines = content.split("\n");
  if (lines.length <= maxLines) {
    return content;
  }
  return [
    ...lines.slice(0, maxLines),
    `… (${lines.length} lines in content)`,
  ].join("\n");
}
