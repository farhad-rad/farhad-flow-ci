import { NavLink, Outlet, type To } from "react-router-dom";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import PageLayout from "@/components/common/pageLayout";
import SideBarButtonsComponent from "@/components/core/sidebarComponent";
import { SidebarProvider } from "@/components/ui/sidebar";
import { cn } from "@/utils/utils";

const navItems = [
  {
    title: "History",
    href: "/git/history",
    icon: (
      <ForwardedIconComponent
        name="History"
        className="w-4 flex-shrink-0 justify-start stroke-[1.5]"
      />
    ),
  },
  {
    title: "Branches",
    href: "/git/branches",
    icon: (
      <ForwardedIconComponent
        name="GitBranch"
        className="w-4 flex-shrink-0 justify-start stroke-[1.5]"
      />
    ),
  },
  {
    title: "Merge requests",
    href: "/git/merge-requests",
    icon: (
      <ForwardedIconComponent
        name="GitPullRequest"
        className="w-4 flex-shrink-0 justify-start stroke-[1.5]"
      />
    ),
  },
  {
    title: "Settings",
    href: "/git/settings",
    icon: (
      <ForwardedIconComponent
        name="Settings"
        className="w-4 flex-shrink-0 justify-start stroke-[1.5]"
      />
    ),
  },
];

export default function GitPage(): JSX.Element {
  return (
    <PageLayout
      backTo={"/" as To}
      title="Git"
      description="Flows repo — history, branches, merge requests, and connection settings."
      nav={
        <>
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
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
      <SidebarProvider width="14rem" defaultOpen={false}>
        <SideBarButtonsComponent items={navItems} />
        <main className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col overflow-x-hidden pt-1">
            <Outlet />
          </div>
        </main>
      </SidebarProvider>
    </PageLayout>
  );
}
