import ForwardedIconComponent from "@/components/common/genericIconComponent";
import ShadTooltip from "@/components/common/shadTooltipComponent";
import { Button } from "@/components/ui/button";
import useTheme from "@/customization/hooks/use-custom-theme";
import type { ThemePreference } from "@/types/zustand/dark";

const CYCLE: ThemePreference[] = ["light", "dark", "system"];

const ICON: Record<ThemePreference, string> = {
  light: "Sun",
  dark: "Moon",
  system: "SunMoon",
};

const LABEL: Record<ThemePreference, string> = {
  light: "Light theme (click for dark)",
  dark: "Dark theme (click for system)",
  system: "System theme (click for light)",
};

/** Single header control: click cycles light → dark → system. */
export const ThemeButtons = () => {
  const { themePreference, setThemePreference } = useTheme();
  const next =
    CYCLE[(CYCLE.indexOf(themePreference) + 1) % CYCLE.length] ?? "light";
  const label = LABEL[themePreference];

  return (
    <ShadTooltip content={label} side="bottom">
      <Button
        unstyled
        aria-label={label}
        onClick={() => setThemePreference(next)}
        data-testid="header_theme_button"
      >
        <div className="hit-area-hover group relative items-center rounded-md px-2 py-2 text-muted-foreground">
          <ForwardedIconComponent
            name={ICON[themePreference]}
            className="side-bar-button-size h-4 w-4 text-muted-foreground group-hover:text-primary"
            strokeWidth={2}
          />
        </div>
      </Button>
    </ShadTooltip>
  );
};

export default ThemeButtons;
