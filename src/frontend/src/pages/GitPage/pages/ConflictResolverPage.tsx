import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useGetGitMergeRequest,
  useGetGitMrConflictFile,
  useGetGitMrConflicts,
  usePostGitMrConflictResolve,
  usePostGitMrConflictsAbort,
  usePostGitMrConflictsFinish,
  usePostGitMrConflictsPrepare,
} from "@/controllers/API/queries/git";
import { extractGitError } from "@/features/git/gitError";
import {
  GitBusyBanner,
  GitLoadingPanel,
} from "@/features/git/GitLoadingPanel";
import useAlertStore from "@/stores/alertStore";
import { cn } from "@/utils/utils";

export default function GitConflictResolverPage(): JSX.Element {
  const [params] = useSearchParams();
  const iid = Number(params.get("iid"));
  const valid = Number.isFinite(iid) && iid > 0;
  const navigate = useNavigate();

  const { data: mr } = useGetGitMergeRequest(valid ? iid : null);
  const prepareMut = usePostGitMrConflictsPrepare();
  const {
    data: conflicts,
    refetch: refetchConflicts,
    isLoading: conflictsLoading,
    isFetching: conflictsFetching,
  } = useGetGitMrConflicts(valid ? iid : null, { enabled: valid });
  const resolveMut = usePostGitMrConflictResolve();
  const finishMut = usePostGitMrConflictsFinish();
  const abortMut = usePostGitMrConflictsAbort();
  const setSuccessData = useAlertStore((s) => s.setSuccessData);
  const setErrorData = useAlertStore((s) => s.setErrorData);

  const paths = conflicts?.conflict_paths ?? [];
  const [index, setIndex] = useState(0);
  const currentPath = paths[index] || null;
  const { data: file, isFetching: fileLoading } = useGetGitMrConflictFile(
    valid ? iid : null,
    currentPath,
    { enabled: valid && Boolean(currentPath) },
  );

  const [result, setResult] = useState("");
  const [commitMsg, setCommitMsg] = useState("Resolve merge conflicts");
  const [prepared, setPrepared] = useState(false);

  useEffect(() => {
    if (!valid || prepared || prepareMut.isPending) return;
    void (async () => {
      try {
        await prepareMut.mutateAsync({ iid });
        setPrepared(true);
        await refetchConflicts();
      } catch (err) {
        setErrorData(extractGitError(err));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per iid
  }, [valid, iid]);

  useEffect(() => {
    if (!file) return;
    setResult(file.working ?? file.ours ?? file.theirs ?? "");
  }, [file?.path, file?.working, file?.ours, file?.theirs]);

  useEffect(() => {
    if (index >= paths.length && paths.length > 0) {
      setIndex(paths.length - 1);
    }
  }, [paths.length, index]);

  const done =
    paths.length === 0 &&
    prepared &&
    !prepareMut.isPending &&
    !conflictsLoading &&
    !conflictsFetching;

  const sourceLabel = mr?.source_branch || "source";
  const targetLabel = mr?.target_branch || "target";

  const progress = useMemo(() => {
    if (!paths.length) return "All resolved";
    return `File ${index + 1} of ${paths.length}`;
  }, [index, paths.length]);

  if (!valid) {
    return (
      <div className="space-y-2 p-4">
        <p className="text-sm text-destructive">Missing MR iid — open from merge request detail.</p>
        <Link to="/git/merge-requests" className="text-sm text-primary hover:underline">
          ← Merge requests
        </Link>
      </div>
    );
  }

  const markResolved = async (content: string) => {
    if (!currentPath) return;
    try {
      const res = await resolveMut.mutateAsync({
        iid,
        path: currentPath,
        content,
      });
      await refetchConflicts();
      const remaining = res.remaining ?? [];
      if (remaining.length === 0) {
        setSuccessData({ title: "All conflicts resolved" });
      } else {
        setIndex((i) => Math.min(i, remaining.length - 1));
      }
    } catch (err) {
      setErrorData(extractGitError(err));
    }
  };

  const finish = () => {
    void (async () => {
      try {
        await finishMut.mutateAsync({
          iid,
          message: commitMsg.trim() || "Resolve merge conflicts",
          push: true,
        });
        setSuccessData({ title: "Pushed resolution to source branch" });
        navigate(`/git/merge-requests/${iid}`);
      } catch (err) {
        setErrorData(extractGitError(err));
      }
    })();
  };

  const abort = () => {
    void (async () => {
      try {
        await abortMut.mutateAsync({ iid });
        setSuccessData({ title: "Merge aborted" });
        navigate(`/git/merge-requests/${iid}`);
      } catch (err) {
        setErrorData(extractGitError(err));
      }
    })();
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="git-conflict-resolver">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link
            to={`/git/merge-requests/${iid}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            ← MR !{iid}
          </Link>
          <h3 className="text-lg font-semibold">Conflict resolver</h3>
          <p className="font-mono text-xs text-muted-foreground">
            {sourceLabel} ← merge {targetLabel} · {progress}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={abort}
            disabled={abortMut.isPending || finishMut.isPending}
            loading={abortMut.isPending}
          >
            Abort
          </Button>
        </div>
      </div>

      {prepareMut.isPending && (
        <GitLoadingPanel label="Preparing merge…" compact />
      )}

      {(resolveMut.isPending || finishMut.isPending || abortMut.isPending) && (
        <GitBusyBanner
          label={
            finishMut.isPending
              ? "Committing and pushing…"
              : abortMut.isPending
                ? "Aborting merge…"
                : "Saving resolution…"
          }
        />
      )}

      {!prepared && !prepareMut.isPending && (
        <GitLoadingPanel label="Starting conflict resolve…" compact />
      )}

      {prepared && (conflictsLoading || conflictsFetching) && paths.length === 0 && !done && (
        <GitLoadingPanel label="Loading conflicts…" compact />
      )}

      {done ? (
        <div className="space-y-3 rounded-md border p-4">
          <p className="text-sm">No remaining conflicts. Commit and push to source branch.</p>
          <Input
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder="Commit message"
            disabled={finishMut.isPending}
          />
          <Button
            disabled={finishMut.isPending || !commitMsg.trim()}
            loading={finishMut.isPending}
            onClick={finish}
          >
            Commit & push to {sourceLabel}
          </Button>
        </div>
      ) : prepared && paths.length > 0 ? (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {paths.map((p, i) => (
              <button
                key={p}
                type="button"
                onClick={() => setIndex(i)}
                className={cn(
                  "shrink-0 rounded-md border px-2 py-1 font-mono text-xs",
                  i === index
                    ? "border-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:bg-muted/50",
                )}
              >
                {p.split("/").pop()}
              </button>
            ))}
          </div>

          {currentPath && (
            <p className="truncate font-mono text-xs text-muted-foreground">{currentPath}</p>
          )}

          <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-3">
            <Pane
              title={`Source (${sourceLabel})`}
              tone="emerald"
              text={file?.ours}
              loading={fileLoading}
              onUse={() => setResult(file?.ours ?? "")}
            />
            <Pane
              title={`Target (${targetLabel})`}
              tone="sky"
              text={file?.theirs}
              loading={fileLoading}
              onUse={() => setResult(file?.theirs ?? "")}
            />
            <div className="flex min-h-[220px] flex-col rounded-md border">
              <div className="flex items-center justify-between border-b px-2 py-1.5">
                <span className="text-xs font-medium">Result</span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setResult(file?.ours ?? "")}
                  >
                    Take source
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setResult(file?.theirs ?? "")}
                  >
                    Take target
                  </Button>
                </div>
              </div>
              <Textarea
                value={result}
                onChange={(e) => setResult(e.target.value)}
                className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-[11px]"
              />
            </div>
          </div>

          <div className="flex flex-wrap justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={index <= 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              Previous file
            </Button>
            <Button
              size="sm"
              disabled={!currentPath || resolveMut.isPending || fileLoading}
              loading={resolveMut.isPending}
              onClick={() => void markResolved(result)}
            >
              Mark resolved & next
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Pane({
  title,
  text,
  loading,
  tone,
  onUse,
}: {
  title: string;
  text: string | null | undefined;
  loading?: boolean;
  tone: "emerald" | "sky";
  onUse: () => void;
}): JSX.Element {
  return (
    <div className="flex min-h-[220px] flex-col rounded-md border">
      <div className="flex items-center justify-between border-b px-2 py-1.5">
        <span
          className={cn(
            "text-xs font-medium",
            tone === "emerald"
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-sky-700 dark:text-sky-300",
          )}
        >
          {title}
        </span>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onUse}>
          Use
        </Button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-muted/20 p-2 font-mono text-[11px] text-muted-foreground">
        {loading ? "Loading…" : text ?? "(missing)"}
      </pre>
    </div>
  );
}
