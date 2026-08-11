import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  useGetGitBranches,
  useGetGitProductionBranch,
  usePostGitCreateMergeRequest,
} from "@/controllers/API/queries/git";
import { extractGitError } from "@/features/git/gitError";
import { GitLoadingPanel } from "@/features/git/GitLoadingPanel";
import {
  mergeGitBranches,
  type RawGitBranch,
} from "@/features/git/mergeBranches";
import useAlertStore from "@/stores/alertStore";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NewMergeRequestWizard({
  open,
  onOpenChange,
}: Props): JSX.Element {
  const navigate = useNavigate();
  const { data: branchesData, isLoading: branchesLoading } = useGetGitBranches({
    enabled: open,
  });
  const { data: prod } = useGetGitProductionBranch({ enabled: open });
  const createMut = usePostGitCreateMergeRequest();
  const setSuccessData = useAlertStore((s) => s.setSuccessData);
  const setErrorData = useAlertStore((s) => s.setErrorData);

  const [step, setStep] = useState<1 | 2>(1);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState(false);
  const [deleteSource, setDeleteSource] = useState(true);

  const prodName = prod?.name || "";

  const remoteBranches = useMemo(() => {
    const merged = mergeGitBranches(
      (branchesData?.branches as RawGitBranch[]) ?? [],
      null,
      prodName,
    );
    return merged.filter((b) => b.has_remote).map((b) => b.name);
  }, [branchesData?.branches, prodName]);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setTitle("");
    setDescription("");
    setDraft(false);
    setDeleteSource(true);
    const remotes = mergeGitBranches(
      (branchesData?.branches as RawGitBranch[]) ?? [],
      null,
      prodName,
    )
      .filter((b) => b.has_remote)
      .map((b) => b.name);
    const defaultTarget =
      (prodName && remotes.includes(prodName) ? prodName : remotes[0]) || "";
    const defaultSource =
      remotes.find((n) => n !== defaultTarget) || remotes[0] || "";
    setTarget(defaultTarget);
    setSource(defaultSource);
  }, [open, branchesData?.branches, prodName]);

  useEffect(() => {
    if (!source) return;
    const base = source;
    setTitle((prev) => {
      if (!prev || prev === `Draft: ${base}` || prev === base) {
        return draft ? `Draft: ${base}` : base;
      }
      if (draft && !prev.startsWith("Draft: ")) return `Draft: ${prev}`;
      if (!draft && prev.startsWith("Draft: ")) return prev.slice(7);
      return prev;
    });
  }, [source, draft]);

  const sourceIsProtected = Boolean(prodName && source === prodName);
  const canNext = Boolean(source && target && source !== target);
  const canCreate = Boolean(title.trim() && source && target && source !== target);

  const create = () => {
    void (async () => {
      try {
        const mr = await createMut.mutateAsync({
          source_branch: source,
          target_branch: target,
          title: title.trim(),
          description: description.trim() || undefined,
          remove_source_branch: !sourceIsProtected && deleteSource,
          draft,
        });
        setSuccessData({ title: `MR !${mr.iid} created` });
        onOpenChange(false);
        navigate(`/git/merge-requests/${mr.iid}`);
      } catch (err) {
        setErrorData(extractGitError(err));
      }
    })();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? "New merge request" : "Merge request details"}
          </DialogTitle>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Merge{" "}
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                {source || "…"}
              </span>{" "}
              into{" "}
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                {target || "…"}
              </span>
            </p>
            {branchesLoading && !branchesData ? (
              <GitLoadingPanel label="Loading remote branches…" compact />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Source branch</label>
                    <select
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      {remoteBranches.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">Target branch</label>
                    <select
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      {remoteBranches.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {remoteBranches.length === 0 && (
                  <p className="text-sm text-destructive">
                    No remote branches. Sync branches first.
                  </p>
                )}
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={!canNext || (branchesLoading && !branchesData)}
                onClick={() => setStep(2)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              From{" "}
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                {source}
              </span>{" "}
              into{" "}
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                {target}
              </span>{" "}
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setStep(1)}
              >
                Change branches
              </button>
            </p>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Title (required)</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
              />
              <label className="flex items-center gap-2 pt-1 text-sm">
                <Checkbox
                  checked={draft}
                  onCheckedChange={(v) => setDraft(v === true)}
                />
                <span className="font-medium">Mark as draft</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Drafts cannot be merged until marked ready.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold">Description</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the goal of the changes and what reviewers should be aware of."
                className="min-h-[120px]"
              />
              <p className="text-xs text-muted-foreground">
                Used as merge commit message context.
              </p>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-semibold">Merge options</div>
              {!sourceIsProtected && (
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>Delete source branch when merge request is accepted.</span>
                  <Switch
                    checked={deleteSource}
                    onCheckedChange={setDeleteSource}
                  />
                </label>
              )}
              {sourceIsProtected && (
                <p className="text-xs text-muted-foreground">
                  Source is production branch — delete-source disabled.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                disabled={!canCreate || createMut.isPending}
                loading={createMut.isPending}
                onClick={create}
              >
                Create merge request
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
