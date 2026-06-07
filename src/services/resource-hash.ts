import { createHash } from "node:crypto";
import type { ResourceMetadata, ResourceType } from "../types.js";

function normalizeText(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

export function hashResourceBody(input: {
  type: ResourceType;
  content: string;
  metadata: ResourceMetadata;
}): string {
  const payload = JSON.stringify({
    type: input.type,
    content: normalizeText(input.content),
    metadata: input.metadata,
  });
  const hex = createHash("sha256").update(payload, "utf8").digest("hex");
  return `sha256:${hex}`;
}
