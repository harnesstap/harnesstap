/** Shared plugin display-name rule for CLI and Desktop create. */

export function isValidPluginDisplayName(name: string): boolean {
  if (name.trim().length === 0) {
    return false;
  }
  if (/[/\\]/.test(name) || name.includes("..")) {
    return false;
  }
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) < 32) {
      return false;
    }
  }
  return true;
}
