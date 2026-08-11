import { FaGitlab } from "react-icons/fa";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import ShadTooltip from "@/components/common/shadTooltipComponent";
import { Button } from "@/components/ui/button";
import {
  useGetGitHealth,
  useGetGitStatus,
} from "@/controllers/API/queries/git";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import { cn } from "@/utils/utils";

function dirtyCount(
  entries: Array<{ change_kind?: string }> | undefined,
): number {
  if (!entries?.length) return 0;
  return entries.filter((e) => (e.change_kind || "unchanged") !== "unchanged")
    .length;
}

/** Compact GitLab-aware chip: branch + ahead/behind + dirty|clean. */
export default function HeaderGitChip(): JSX.Element {
  const navigate = useCustomNavigate();
  const { data: health } = useGetGitHealth();
  const ready = Boolean(health?.setup_complete ?? health?.repo_is_git);
  const { data: status } = useGetGitStatus({
    enabled: ready,
    refetchInterval: 8_000,
  });

  const branch = status?.branch || health?.current_branch || "—";
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const dirty = dirtyCount(status?.entries);
  const tip = ready
    ? `${branch} · ↑${ahead} ↓${behind} · ${dirty ? `${dirty} dirty` : "clean"}`
    : "Connect flows git repo";

  return (
    <ShadTooltip content={tip} side="bottom">
      <Button
        unstyled
        onClick={() => navigate("/git")}
        className={cn(
          "flex h-8 max-w-[min(100vw,22rem)] items-center gap-1.5 rounded-md border px-2",
          "bg-muted/30 text-xs text-muted-foreground transition-colors",
          "hover:border-primary/40 hover:bg-muted hover:text-foreground",
        )}
        data-testid="header-git-button"
        aria-label={`Git ${branch}, ahead ${ahead}, behind ${behind}, ${
          dirty ? `${dirty} dirty` : "clean"
        }`}
      >
        <FaGitlab
          className="h-3.5 w-3.5 shrink-0 text-[#FC6D26]"
          aria-hidden
        />
        <span
          className={cn(
            "max-w-[7rem] truncate rounded bg-background/80 px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground",
            status?.on_production && "text-amber-600 dark:text-amber-400",
          )}
        >
          {branch}
        </span>
        <span className="inline-flex items-center gap-0.5 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
          <ForwardedIconComponent
            name="ArrowUp"
            className="h-3 w-3"
            strokeWidth={2.5}
          />
          {ahead}
        </span>
        <span className="inline-flex items-center gap-0.5 font-mono text-[11px] text-red-600 dark:text-red-400">
          <ForwardedIconComponent
            name="ArrowDown"
            className="h-3 w-3"
            strokeWidth={2.5}
          />
          {behind}
        </span>
        {dirty > 0 ? (
          <span className="inline-flex items-center gap-0.5 font-mono text-[11px] text-amber-600 dark:text-amber-400">
            <ForwardedIconComponent
              name="PenLine"
              className="h-3 w-3"
              strokeWidth={2.5}
            />
            {dirty}
          </span>
        ) : (
          <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            clean
          </span>
        )}
      </Button>
    </ShadTooltip>
  );
}
