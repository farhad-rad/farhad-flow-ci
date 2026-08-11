export type ThemePreference = "light" | "dark" | "system";

export type DarkStoreType = {
  dark: boolean;
  themePreference: ThemePreference;
  stars: number;
  version: string;
  latestVersion: string;
  setDark: (dark: boolean) => void;
  setThemePreference: (theme: ThemePreference) => void;
  refreshVersion: (v: string) => void;
  refreshLatestVersion: (v: string) => void;
  refreshStars: () => void;
  discordCount: number;
  refreshDiscordCount: () => void;
};
