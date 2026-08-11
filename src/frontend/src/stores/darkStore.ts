import { create } from "zustand";
import type { DarkStoreType, ThemePreference } from "../types/zustand/dark";

function readThemePreference(): ThemePreference {
  const raw = window.localStorage.getItem("themePreference");
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveDark(pref: ThemePreference): boolean {
  if (pref === "light") return false;
  if (pref === "dark") return true;
  return systemPrefersDark();
}

let mediaQuery: MediaQueryList | null = null;
let mediaHandler: ((e: MediaQueryListEvent) => void) | null = null;

function syncSystemListener(enabled: boolean) {
  if (typeof window === "undefined") return;
  if (enabled) {
    if (mediaHandler) return;
    mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaHandler = (e) => {
      useDarkStore.getState().setDark(e.matches);
    };
    mediaQuery.addEventListener("change", mediaHandler);
    return;
  }
  if (mediaQuery && mediaHandler) {
    mediaQuery.removeEventListener("change", mediaHandler);
  }
  mediaQuery = null;
  mediaHandler = null;
}

const initialPref = readThemePreference();

export const useDarkStore = create<DarkStoreType>((_set, _get) => ({
  dark: (() => {
    // Prefer themePreference; fall back to legacy isDark key.
    if (window.localStorage.getItem("themePreference") != null) {
      return resolveDark(initialPref);
    }
    const stored = window.localStorage.getItem("isDark");
    if (stored !== null) return JSON.parse(stored);
    return systemPrefersDark();
  })(),
  themePreference: initialPref,
  stars: 0,
  version: "",
  latestVersion: "",
  refreshLatestVersion: (v: string) => {
    _set(() => ({ latestVersion: v }));
  },
  setDark: (dark) => {
    _set(() => ({ dark }));
    window.localStorage.setItem("isDark", dark.toString());
  },
  setThemePreference: (theme) => {
    const dark = resolveDark(theme);
    _set(() => ({ themePreference: theme, dark }));
    window.localStorage.setItem("themePreference", theme);
    window.localStorage.setItem("isDark", dark.toString());
    syncSystemListener(theme === "system");
  },
  refreshVersion: (v) => {
    _set(() => ({ version: v }));
  },
  // Desktop fork: never hit Langflow GitHub / Discord APIs
  refreshStars: () => {
    _set(() => ({ stars: 0 }));
  },
  discordCount: 0,
  refreshDiscordCount: () => {
    _set(() => ({ discordCount: 0 }));
  },
}));

// Attach system listener if we boot in system mode.
syncSystemListener(initialPref === "system");
