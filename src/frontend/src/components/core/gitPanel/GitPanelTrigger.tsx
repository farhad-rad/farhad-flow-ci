import ForwardedIconComponent from "@/components/common/genericIconComponent";
import ShadTooltip from "@/components/common/shadTooltipComponent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useGetGitHealth, useGetGitStatus } from "@/controllers/API/queries/git";
import { useGitUiStore } from "@/features/git/store";
import { cn } from "@/utils/utils";

type Props = {
  className?: string;
  compact?: boolean;
};

/**
 * Opens the Git sidebar panel. Mount `<GitPanel />` once near app chrome.
 */
export default function GitPanelTrigger({
  className,
  compact,
}: Props): JSX.Element {
  const openPanel = useGitUiStore((s) => s.openPanel);
  const setFocusWizard = useGitUiStore((s) => s.setFocusWizard);
  const { data: health } = useGetGitHealth();
  const repoReady = Boolean(health?.repo_is_git && health?.git_binary_available);
  const { data: status } = useGetGitStatus({ enabled: repoReady });

  const dirty = status?.entries?.length ?? 0;
  const branch = status?.branch || health?.current_branch;
  const notInstalled = health?.banner_code === "GIT_NOT_INSTALLED";

  return (
    <ShadTooltip content="Open Git panel">
      <Button
        variant={compact ? "ghost" : "outline"}
        size={compact ? "iconMd" : "sm"}
        className={cn("gap-1", className)}
        data-testid="git-panel-trigger"
        onClick={() => {
          if (!health?.repo_is_git) setFocusWizard(true);
          openPanel();
        }}
      >
        <ForwardedIconComponent name="GitBranch" className="h-4 w-4" />
        {!compact && <span>Git</span>}
        {branch && !compact && (
          <Badge
            variant="secondaryStatic"
            size="tag"
            className="max-w-[7rem] truncate"
          >
            {branch}
          </Badge>
        )}
        {dirty > 0 && (
          <Badge variant="pinkStatic" size="tag" data-testid="git-trigger-dirty">
            {dirty}
          </Badge>
        )}
        {notInstalled && (
          <Badge variant="errorStatic" size="tag">
            !
          </Badge>
        )}
      </Button>
    </ShadTooltip>
  );
}
