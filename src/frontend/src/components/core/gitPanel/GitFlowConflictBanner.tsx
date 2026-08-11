import { Button } from "@/components/ui/button";
import { useGetGitConflicts } from "@/controllers/API/queries/git";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";

/** Block-open-edit notice when this flow has unresolved conflict copies (7.6). */
export default function GitFlowConflictBanner({
  flowId,
}: {
  flowId: string;
}): JSX.Element | null {
  const { data } = useGetGitConflicts();
  const navigate = useCustomNavigate();
  const hit = (data?.conflicts ?? []).some((c) => c.flow_id === flowId);
  if (!hit) return null;

  return (
    <div
      className="flex items-center justify-between gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm"
      data-testid="git-flow-conflict-banner"
      role="alert"
    >
      <span>
        <strong className="mr-2">GIT_FLOW_CONFLICT</strong>
        Unresolved merge conflict — editing/save blocked until resolved.
      </span>
      <Button
        size="xs"
        variant="outline"
        onClick={() => navigate("/settings/git-conflicts")}
      >
        Resolve
      </Button>
    </div>
  );
}
