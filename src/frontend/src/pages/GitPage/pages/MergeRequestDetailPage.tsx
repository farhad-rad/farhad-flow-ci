import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  useGetGitMergeRequest,
  useGetGitMergeRequestChanges,
  useGetGitMergeRequestNotes,
  usePostGitCloseMergeRequest,
  usePostGitMergeRequestNote,
  usePostGitReopenMergeRequest,
  usePutGitMergeMergeRequest,
} from "@/controllers/API/queries/git";
import { extractGitError } from "@/features/git/gitError";
import {
  GitBusyBanner,
  GitLoadingPanel,
} from "@/features/git/GitLoadingPanel";
import useAlertStore from "@/stores/alertStore";
import { cn } from "@/utils/utils";

function isConflicted(mr: {
  merge_status?: string;
  detailed_merge_status?: unknown;
  has_conflicts?: unknown;
} | undefined): boolean {
  if (!mr) return false;
  if (mr.has_conflicts === true) return true;
  const status = String(mr.merge_status || "").toLowerCase();
  const detailed = String(mr.detailed_merge_status || "").toLowerCase();
  return (
    status === "cannot_be_merged" ||
    detailed === "conflict" ||
    detailed === "cannot_be_merged" ||
    detailed.includes("conflict")
  );
}

export default function GitMergeRequestDetailPage(): JSX.Element {
  const { iid: iidParam } = useParams();
  const iid = Number(iidParam);
  const valid = Number.isFinite(iid) && iid > 0;
  const navigate = useNavigate();

  const {
    data: mr,
    refetch,
    isLoading: mrLoading,
    isFetching: mrFetching,
  } = useGetGitMergeRequest(valid ? iid : null);
  const { data: changes, isLoading: changesLoading } =
    useGetGitMergeRequestChanges(valid ? iid : null);
  const {
    data: notesData,
    refetch: refetchNotes,
    isLoading: notesLoading,
  } = useGetGitMergeRequestNotes(valid ? iid : null);
  const mergeMut = usePutGitMergeMergeRequest();
  const closeMut = usePostGitCloseMergeRequest();
  const reopenMut = usePostGitReopenMergeRequest();
  const noteMut = usePostGitMergeRequestNote();
  const setSuccessData = useAlertStore((s) => s.setSuccessData);
  const setErrorData = useAlertStore((s) => s.setErrorData);
  const [note, setNote] = useState("");

  const conflicted = useMemo(() => isConflicted(mr), [mr]);
  const detailed = String(mr?.detailed_merge_status || "").toLowerCase();
  const canMerge =
    mr?.state === "opened" &&
    !conflicted &&
    (mr?.merge_status === "can_be_merged" ||
      detailed === "mergeable" ||
      detailed === "ci_must_pass" ||
      detailed === "ci_still_running");

  const actionBusy =
    mergeMut.isPending ||
    closeMut.isPending ||
    reopenMut.isPending ||
    noteMut.isPending;

  if (!valid) {
    return <p className="text-sm text-destructive">Invalid MR id</p>;
  }

  if (mrLoading && !mr) {
    return <GitLoadingPanel label="Loading merge request…" />;
  }

  const run = async (title: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      setSuccessData({ title });
      await refetch();
      await refetchNotes();
    } catch (err) {
      setErrorData(extractGitError(err));
    }
  };

  const files =
    (changes?.changes as Array<{
      new_path?: string;
      old_path?: string;
      diff?: string;
    }>) || [];

  const goResolve = () => {
    navigate(`/git/conflicts?iid=${iid}`);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="git-mr-detail-page">
      <Link
        to="/git/merge-requests"
        className="text-sm text-muted-foreground hover:underline"
      >
        ← Merge requests
      </Link>

      {actionBusy && <GitBusyBanner label="Updating merge request…" />}

      <div className={cn(mrFetching && !mrLoading && "opacity-80")}>
        <h3 className="text-lg font-semibold">
          !{mr?.iid ?? iid} {mr?.title || "…"}
        </h3>
        <p className="font-mono text-xs text-muted-foreground">
          {mr?.source_branch} → {mr?.target_branch} · {mr?.state} ·{" "}
          {String(mr?.detailed_merge_status || mr?.merge_status || "…")}
        </p>
        {mr?.web_url && (
          <a
            href={mr.web_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline"
          >
            Open in GitLab
          </a>
        )}
      </div>

      <div
        className={cn(
          "rounded-md border px-3 py-2 text-sm",
          conflicted
            ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100"
            : canMerge
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
              : "bg-muted/40 text-muted-foreground",
        )}
      >
        {conflicted
          ? "Has conflicts — resolve before merge."
          : canMerge
            ? "Mergeable — ready to merge."
            : `Merge status: ${String(mr?.detailed_merge_status || mr?.merge_status || "unknown")}`}
      </div>

      <div className="flex flex-wrap gap-2">
        {conflicted && mr?.state === "opened" && (
          <Button size="sm" variant="default" onClick={goResolve} disabled={actionBusy}>
            Resolve conflicts
          </Button>
        )}
        <Button
          size="sm"
          disabled={mergeMut.isPending || !canMerge || mr?.state !== "opened"}
          loading={mergeMut.isPending}
          onClick={() =>
            void run("Merged", () => mergeMut.mutateAsync({ iid }))
          }
        >
          Merge
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={closeMut.isPending || mr?.state !== "opened"}
          loading={closeMut.isPending}
          onClick={() =>
            void run("Closed", () => closeMut.mutateAsync({ iid }))
          }
        >
          Close
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={reopenMut.isPending || mr?.state === "opened"}
          loading={reopenMut.isPending}
          onClick={() =>
            void run("Reopened", () => reopenMut.mutateAsync({ iid }))
          }
        >
          Reopen
        </Button>
      </div>

      {mr?.description && (
        <div className="whitespace-pre-wrap rounded-md border p-3 text-sm">
          {mr.description}
        </div>
      )}

      <section className="rounded-md border">
        <div className="border-b px-3 py-2 text-sm font-medium">
          Changes
          {!changesLoading && ` (${files.length})`}
        </div>
        {changesLoading && !changes ? (
          <GitLoadingPanel label="Loading changes…" compact />
        ) : (
          <div className="max-h-80 space-y-4 overflow-auto p-3">
            {files.map((f, i) => (
              <div key={`${f.new_path}-${i}`}>
                <div className="mb-1 font-mono text-xs">
                  {f.new_path || f.old_path}
                </div>
                <pre className="whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">
                  {f.diff || "(no diff)"}
                </pre>
              </div>
            ))}
            {files.length === 0 && (
              <p className="text-sm text-muted-foreground">No file changes</p>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-md border p-3">
        <div className="text-sm font-medium">Discussion</div>
        {notesLoading && !notesData ? (
          <GitLoadingPanel label="Loading discussion…" compact />
        ) : (
          <ul className="max-h-48 space-y-2 overflow-auto">
            {(notesData?.notes || []).map((n) => (
              <li key={n.id} className="rounded border p-2 text-sm">
                <div className="text-xs text-muted-foreground">
                  {n.author?.name || "user"} · {n.created_at}
                </div>
                <div className="whitespace-pre-wrap">{n.body}</div>
              </li>
            ))}
            {(notesData?.notes || []).length === 0 && (
              <li className="text-sm text-muted-foreground">No notes yet</li>
            )}
          </ul>
        )}
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note"
          className="min-h-[64px]"
          disabled={noteMut.isPending}
        />
        <Button
          size="sm"
          disabled={noteMut.isPending || !note.trim()}
          loading={noteMut.isPending}
          onClick={() =>
            void run("Note added", async () => {
              await noteMut.mutateAsync({ iid, body: note.trim() });
              setNote("");
            })
          }
        >
          Comment
        </Button>
      </section>
    </div>
  );
}
