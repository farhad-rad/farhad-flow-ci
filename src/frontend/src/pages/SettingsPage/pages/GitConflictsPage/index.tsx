import { useMemo, useState } from "react";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  useGetGitConflictDetail,
  useGetGitConflicts,
  usePostGitConflictResolve,
} from "@/controllers/API/queries/git";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import { extractGitError } from "@/features/git/gitError";
import useAlertStore from "@/stores/alertStore";

export default function GitConflictsPage(): JSX.Element {
  const { data, refetch } = useGetGitConflicts();
  const conflicts = data?.conflicts ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const flowId = selected || conflicts[0]?.flow_id || null;
  const { data: detail, refetch: refetchDetail } = useGetGitConflictDetail(flowId, {
    enabled: Boolean(flowId),
  });
  const resolveMut = usePostGitConflictResolve();
  const setSuccessData = useAlertStore((s) => s.setSuccessData);
  const setErrorData = useAlertStore((s) => s.setErrorData);
  const navigate = useCustomNavigate();
  const [manual, setManual] = useState<string>("");
  const [editing, setEditing] = useState(false);

  const summary = useMemo(() => {
    if (!detail) return "";
    const o = detail.ours?.length ?? 0;
    const t = detail.theirs?.length ?? 0;
    const b = detail.base?.length ?? 0;
    return `ours ${o} chars · theirs ${t} · base ${b} · reason ${detail.meta?.reason || "—"}`;
  }, [detail]);

  const run = async (
    action: "take_ours" | "take_theirs" | "manual" | "clear",
    content?: string,
  ) => {
    if (!flowId) return;
    try {
      await resolveMut.mutateAsync({ flowId, action, content });
      setSuccessData({
        title: "Conflict resolved",
        list: ["Commit manually or save flow for auto-commit."],
      });
      setEditing(false);
      await refetch();
      await refetchDetail();
      setSelected(null);
    } catch (err) {
      setErrorData(extractGitError(err));
    }
  };

  return (
    <div
      className="flex h-full w-full flex-col gap-4"
      data-testid="git-conflicts-page"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            className="flex items-center text-lg font-semibold tracking-tight"
            data-testid="settings_menu_header"
          >
            Git Conflicts
            <ForwardedIconComponent
              name="GitMerge"
              className="ml-2 h-5 w-5 text-primary"
            />
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            3-way JSON resolve. Push stays blocked until all conflicts clear.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate("/all")}
        >
          Back to flows
        </Button>
      </div>

      {conflicts.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="git-conflicts-empty">
          No unresolved conflicts.
        </p>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[16rem_1fr]">
          <ul className="space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
            {conflicts.map((c) => (
              <li key={c.flow_id}>
                <button
                  type="button"
                  className={`w-full truncate rounded px-2 py-1.5 text-left hover:bg-muted ${
                    flowId === c.flow_id ? "bg-muted font-medium" : ""
                  }`}
                  onClick={() => {
                    setSelected(c.flow_id);
                    setEditing(false);
                  }}
                >
                  {c.flow_id.slice(0, 8)}… · {c.reason || "conflict"}
                </button>
              </li>
            ))}
          </ul>

          <div className="flex min-h-0 flex-col gap-3">
            <p className="font-mono text-xs text-muted-foreground">{summary}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={resolveMut.isPending}
                onClick={() => void run("take_ours")}
                data-testid="git-conflict-ours"
              >
                Take ours
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={resolveMut.isPending}
                onClick={() => void run("take_theirs")}
                data-testid="git-conflict-theirs"
              >
                Take theirs
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setManual(detail?.ours || detail?.theirs || "");
                  setEditing(true);
                }}
                data-testid="git-conflict-manual"
              >
                Manual edit
              </Button>
              <Button
                size="sm"
                disabled={resolveMut.isPending || !editing}
                onClick={() => void run("manual", manual)}
                data-testid="git-conflict-mark-resolved"
              >
                Mark resolved
              </Button>
            </div>

            {editing ? (
              <Textarea
                className="min-h-[320px] flex-1 font-mono text-xs"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                data-testid="git-conflict-manual-editor"
              />
            ) : (
              <Tabs defaultValue="ours" className="min-h-0 flex-1">
                <TabsList>
                  <TabsTrigger value="ours">Ours</TabsTrigger>
                  <TabsTrigger value="theirs">Theirs</TabsTrigger>
                  <TabsTrigger value="base">Base</TabsTrigger>
                </TabsList>
                <TabsContent value="ours" className="mt-2">
                  <pre className="max-h-[420px] overflow-auto rounded-md bg-muted p-3 font-mono text-[11px]">
                    {detail?.ours || "(missing)"}
                  </pre>
                </TabsContent>
                <TabsContent value="theirs" className="mt-2">
                  <pre className="max-h-[420px] overflow-auto rounded-md bg-muted p-3 font-mono text-[11px]">
                    {detail?.theirs || "(missing)"}
                  </pre>
                </TabsContent>
                <TabsContent value="base" className="mt-2">
                  <pre className="max-h-[420px] overflow-auto rounded-md bg-muted p-3 font-mono text-[11px]">
                    {detail?.base || "(missing)"}
                  </pre>
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
