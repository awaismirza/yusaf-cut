/** Recently-opened .scribe project paths, most-recent first (localStorage). */

const KEY = "yusafcut.recentProjects";
const MAX = 5;

export function getRecentProjects(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function addRecentProject(path: string): void {
  const list = [path, ...getRecentProjects().filter((p) => p !== path)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — recents are a convenience, not a requirement */
  }
}
