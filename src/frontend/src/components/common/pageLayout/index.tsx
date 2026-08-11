import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { To } from "react-router-dom";
import { CustomBanner } from "@/customization/components/custom-banner";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import { cn } from "@/utils/utils";
import { Button } from "../../ui/button";
import ForwardedIconComponent from "../genericIconComponent";

export default function PageLayout({
  title,
  description,
  children,
  button,
  actions,
  nav,
  betaIcon,
  backTo = "",
  className,
  contentClassName,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  /** @deprecated Prefer `actions` */
  button?: React.ReactNode;
  /** Primary action slot (right side of hero card). */
  actions?: React.ReactNode;
  /** Optional sub-navigation under the subtitle. */
  nav?: React.ReactNode;
  betaIcon?: boolean;
  backTo?: To;
  className?: string;
  contentClassName?: string;
}) {
  const headingId = useId();
  const navigate = useCustomNavigate();
  const { t } = useTranslation();
  const actionSlot = actions ?? button;

  return (
    <div
      className={cn(
        "flex w-full flex-1 flex-col justify-between overflow-auto overflow-x-hidden bg-background",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col">
        <div className="flex flex-col gap-4 px-4 pt-4 sm:px-6 sm:pt-6">
          <CustomBanner />
          <header
            role="region"
            aria-labelledby={headingId}
            className="page-hero-card relative overflow-hidden rounded-2xl border border-border/60 p-5 shadow-page-hero sm:p-7"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 page-hero-gradient opacity-90"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-24 -left-10 h-52 w-52 rounded-full bg-accent-indigo-foreground/15 blur-3xl dark:bg-accent-indigo-foreground/25"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-br from-background/40 via-background/20 to-transparent backdrop-blur-[2px]"
            />

            <div className="relative flex flex-col gap-5 md:flex-row md:items-start md:justify-between md:gap-8">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {backTo !== "" && backTo != null && (
                    <Button
                      unstyled
                      onClick={() => {
                        navigate(backTo);
                      }}
                      data-testid="back_page_button"
                      aria-label={t("navigation.goBack")}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/50 text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <ForwardedIconComponent
                        name="ChevronLeft"
                        className="h-4 w-4"
                      />
                    </Button>
                  )}
                  <h1
                    id={headingId}
                    className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
                    data-testid="mainpage_title"
                  >
                    {title}
                    {betaIcon && (
                      <span className="store-beta-icon ml-2">Beta</span>
                    )}
                  </h1>
                </div>
                {description ? (
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                    {description}
                  </p>
                ) : null}
                {nav ? (
                  <nav
                    className="mt-4 flex flex-wrap items-center gap-2"
                    aria-label={t("navigation.pageNav", {
                      defaultValue: "Page",
                    })}
                  >
                    {nav}
                  </nav>
                ) : null}
              </div>
              {actionSlot ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2 md:pt-1">
                  {actionSlot}
                </div>
              ) : null}
            </div>
          </header>
        </div>
        <div
          className={cn("flex flex-1 flex-col p-4 pt-5 sm:p-6 sm:pt-6", contentClassName)}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
