import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AlertDropdown from "@/alerts/alertDropDown";
import ZeenomeLogo from "@/assets/ZeenomeLogo.svg?react";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import ModelProviderCount from "@/components/common/modelProviderCountComponent";
import ShadTooltip from "@/components/common/shadTooltipComponent";
import { Button } from "@/components/ui/button";
import CustomLangflowCounts from "@/customization/components/custom-langflow-counts";
import { CustomOrgSelector } from "@/customization/components/custom-org-selector";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import HeaderGitChip from "@/features/git/HeaderGitChip";
import useAlertStore from "@/stores/alertStore";
import FlowMenu from "./components/FlowMenu";
import ThemeButtons from "./components/ThemeButtons";

export default function AppHeader(): JSX.Element {
  const { t } = useTranslation();
  const notificationCenter = useAlertStore((state) => state.notificationCenter);
  const navigate = useCustomNavigate();
  const [activeState, setActiveState] = useState<"notifications" | null>(null);
  const notificationRef = useRef<HTMLButtonElement | null>(null);
  const notificationContentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const isNotificationButton = notificationRef.current?.contains(target);
      const isNotificationContent =
        notificationContentRef.current?.contains(target);

      if (!isNotificationButton && !isNotificationContent) {
        setActiveState(null);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const getNotificationBadge = () => {
    const baseClasses = "absolute h-1 w-1 rounded-full bg-destructive";
    return notificationCenter
      ? `${baseClasses} right-[0.3rem] top-[5px]`
      : "hidden";
  };

  return (
    <header
      className={`z-10 flex h-[48px] w-full items-center justify-between border-b pr-5 pl-2.5 dark:bg-background`}
      data-testid="app-header"
    >
      {/* Left Section */}
      <div
        className={`z-30 flex shrink-0 items-center gap-2`}
        data-testid="header_left_section_wrapper"
      >
        <Button
          unstyled
          onClick={() => navigate("/")}
          className="mr-1 flex h-8 items-center"
          data-testid="icon-ChevronLeft"
          aria-label={t("header.home")}
        >
          <ZeenomeLogo className="h-7 w-auto text-foreground" aria-hidden="true" />
        </Button>
        <CustomOrgSelector />
      </div>

      {/* Middle Section */}
      <div className="absolute left-1/2 -translate-x-1/2">
        <FlowMenu />
      </div>

      {/* Right Section — flex-row-reverse: DOM order = edge→inward */}
      <div
        className="relative z-30 flex shrink-0 flex-row-reverse items-center gap-2 sm:gap-3"
        data-testid="header_right_section_wrapper"
      >
        {false && <ModelProviderCount />}

        <ShadTooltip content={t("account.settings")} side="bottom">
          <Button
            unstyled
            aria-label={t("account.settings")}
            onClick={() => navigate("/settings")}
            data-testid="header_settings_button"
          >
            <div className="hit-area-hover group relative items-center rounded-md px-2 py-2 text-muted-foreground">
              <ForwardedIconComponent
                name="SlidersHorizontal"
                className="side-bar-button-size h-4 w-4 text-muted-foreground group-hover:text-primary"
                strokeWidth={2}
              />
            </div>
          </Button>
        </ShadTooltip>

        <AlertDropdown
          notificationRef={notificationContentRef}
          onClose={() => setActiveState(null)}
        >
          <ShadTooltip content={t("header.notifications")} side="bottom">
            <AlertDropdown onClose={() => setActiveState(null)}>
              <Button
                ref={notificationRef}
                unstyled
                aria-label={t("header.notifications")}
                onClick={() =>
                  setActiveState((prev) =>
                    prev === "notifications" ? null : "notifications",
                  )
                }
                data-testid="notification_button"
              >
                <div className="hit-area-hover group relative items-center rounded-md px-2 py-2 text-muted-foreground">
                  <span className={getNotificationBadge()} />
                  <ForwardedIconComponent
                    name="Bell"
                    className={`side-bar-button-size h-4 w-4 ${
                      activeState === "notifications"
                        ? "text-primary"
                        : "text-muted-foreground group-hover:text-primary"
                    }`}
                    strokeWidth={2}
                  />
                  <span className="hidden whitespace-nowrap">
                    {t("header.notificationsLabel")}
                  </span>
                </div>
              </Button>
            </AlertDropdown>
          </ShadTooltip>
        </AlertDropdown>

        {/* edge→in: Settings · Bell · Theme · Git */}
        <ThemeButtons />

        <HeaderGitChip />

        <div className="hidden pr-2 whitespace-nowrap lg:inline-flex lg:items-center">
          <CustomLangflowCounts />
        </div>
      </div>
    </header>
  );
}
