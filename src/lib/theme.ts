export type Theme = "light" | "dark";

const STORAGE_KEY = "genosight-theme";

export function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "dark" ? "dark" : stored === "light" ? "light" : null;
}

export function getPreferredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return "light";
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  window.localStorage.setItem(STORAGE_KEY, theme);
}

export function initTheme(): Theme {
  const theme = getStoredTheme() ?? getPreferredTheme();
  applyTheme(theme);
  return theme;
}
