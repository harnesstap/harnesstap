const STORAGE_KEY = "harnesstap.desktop.recentProjects";
const MAX_RECENT = 20;

export interface RecentProject {
  path: string;
  lastOpenedAt: number;
}

function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed;
}

export function projectDisplayName(path: string): string {
  return basename(path);
}

export function loadRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (row): row is RecentProject =>
          typeof row === "object"
          && row !== null
          && typeof (row as RecentProject).path === "string"
          && typeof (row as RecentProject).lastOpenedAt === "number",
      )
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function rememberProject(path: string): RecentProject[] {
  const normalized = path.trim();
  if (!normalized) {
    return loadRecentProjects();
  }
  const now = Date.now();
  const next = [
    { path: normalized, lastOpenedAt: now },
    ...loadRecentProjects().filter((row) => row.path !== normalized),
  ].slice(0, MAX_RECENT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function filterRecentProjects(
  projects: RecentProject[],
  query: string,
): RecentProject[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return projects;
  }
  return projects.filter((row) => {
    const name = projectDisplayName(row.path).toLowerCase();
    return name.includes(needle) || row.path.toLowerCase().includes(needle);
  });
}
