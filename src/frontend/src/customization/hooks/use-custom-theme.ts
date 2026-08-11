// Shared theme logic — preference lives in darkStore (not per-hook state).

import { useDarkStore } from "@/stores/darkStore";
import type { ThemePreference } from "@/types/zustand/dark";

const useTheme = () => {
  const dark = useDarkStore((state) => state.dark);
  const themePreference = useDarkStore((state) => state.themePreference);
  const setThemePreference = useDarkStore((state) => state.setThemePreference);
  const systemTheme = themePreference === "system";

  return {
    systemTheme,
    dark,
    themePreference,
    setThemePreference: (theme: ThemePreference) => setThemePreference(theme),
  };
};

export default useTheme;
