import { useTranslation } from "react-i18next";
import { NavLink, Outlet, type To } from "react-router-dom";
import SideBarButtonsComponent from "@/components/core/sidebarComponent";
import { SidebarProvider } from "@/components/ui/sidebar";
import { cn } from "@/utils/utils";
import ForwardedIconComponent from "../../components/common/genericIconComponent";
import PageLayout from "../../components/common/pageLayout";

export default function SettingsPage(): JSX.Element {
  const { t } = useTranslation();

  const sidebarNavItems: {
    href?: string;
    title: string;
    icon: React.ReactNode;
  }[] = [
    {
      title: t("settings.nav.globalVariables"),
      href: "/settings/global-variables",
      icon: (
        <ForwardedIconComponent
          name="Globe"
          className="w-4 flex-shrink-0 justify-start stroke-[1.5]"
        />
      ),
    },
    {
      title: t("settings.nav.modelProviders"),
      href: "/settings/model-providers",
      icon: (
        <ForwardedIconComponent
          name="BrainCircuit"
          className="w-4 flex-shrink-0 justify-start stroke-[1.5]"
        />
      ),
    },
    {
      title: t("settings.nav.dbProviders"),
      href: "/settings/db-providers",
      icon: (
        <ForwardedIconComponent
          name="Database"
          className="w-4 flex-shrink-0 justify-start stroke-[1.5]"
        />
      ),
    },
    {
      title: t("settings.nav.shortcuts"),
      href: "/settings/shortcuts",
      icon: (
        <ForwardedIconComponent
          name="Keyboard"
          className="w-4 flex-shrink-0 justify-start stroke-[1.5]"
        />
      ),
    },
  ];

  return (
    <PageLayout
      backTo={-1 as To}
      title={t("settings.title")}
      description={t("settings.description")}
      nav={
        <>
          {sidebarNavItems
            .filter((item) => item.href)
            .map((item) => (
              <NavLink
                key={item.href}
                to={item.href!}
                className={({ isActive }) =>
                  cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    isActive
                      ? "border-primary/30 bg-primary/10 text-foreground"
                      : "border-border/70 bg-background/40 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )
                }
              >
                {item.title}
              </NavLink>
            ))}
        </>
      }
    >
      <SidebarProvider width="15rem" defaultOpen={false}>
        <SideBarButtonsComponent items={sidebarNavItems} />
        <main className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col overflow-x-hidden pt-1">
            <Outlet />
          </div>
        </main>
      </SidebarProvider>
    </PageLayout>
  );
}
