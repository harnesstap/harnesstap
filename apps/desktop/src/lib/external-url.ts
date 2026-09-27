import { open as openUrl } from "@tauri-apps/plugin-shell";

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function httpUrlOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0 || !isHttpUrl(trimmed)) {
    return null;
  }
  return trimmed;
}

export async function openExternalUrl(url: string): Promise<void> {
  const href = httpUrlOrNull(url);
  if (!href) {
    return;
  }
  try {
    await openUrl(href);
  } catch {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}
