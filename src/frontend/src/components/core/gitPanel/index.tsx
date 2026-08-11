import { useEffect, useMemo, useState } from "react";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import ShadTooltip from "@/components/common/shadTooltipComponent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useDeleteGitBranch,
  useGetGitBranches,
  useGetGitConflicts,
  useGetGitDiff,
  useGetGitHealth,
  useGetGitStatus,
  usePostGitCheckout,
  usePostGitClone,
  usePostGitCommit,
  usePostGitCreateBranch,
  usePostGitFetch,
  usePostGitPull,
  usePostGitPush,
} from "@/controllers/API/queries/git";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import { extractGitError } from "@/features/git/gitError";
import { GitConfirmDialog } from "@/features/git/GitConfirmDialog";
import { useGitUiStore } from "@/features/git/store";
import useAlertStore from "@/stores/alertStore";
import { cn } from "@/utils/utils";
import ConnectWizard from "./components/ConnectWizard";
import OnboardingChecklist from "./components/OnboardingChecklist";

const DIRTY_RENDER_CAP = 120;

export default function GitPanel(): JSX.Element {
  const open = useGitUiStore((s) => s.panelOpen);
  const setOpen = useGitUiStore((s) => s.setPanelOpen);
  const focusWizard = useGitUiStore((s) => s.focusWizard);
  const diffFlowId = useGitUiStore((s) => s.diffFlowId);
  const setDiffFlowId = useGitUiStore((s) => s.setDiffFlowId);
  const navigate = useCustomNavigate();
  const setSuccessData = useAlertStore((s) => s.setSuccessData);
  const setErrorData = useAlertStore((s) => s.setErrorData);

  const { data: health } = useGetGitHealth();
  const repoReady = Boolean(health?.repo_is_git && health?.git_binary_available);
  const { data: status, isError: statusError } = useGetGitStatus({
    enabled: open && repoReady,
  });
  const { data: branchesData } = useGetGitBranches({ enabled: open && repoReady });
  const { data: conflictsData } = useGetGitConflicts({
    enabled: open && Boolean(health?.git_enabled),
  });
  const { data: diffData } = useGetGitDiff(diffFlowId, {
    enabled: open && Boolean(diffFlowId),
  });

  const commitMut = usePostGitCommit();
  const pushMut = usePostGitPush();
  const pullMut = usePostGitPull();
  const fetchMut = usePostGitFetch();
  const createBranchMut = usePostGitCreateBranch();
  const checkoutMut = usePostGitCheckout();
  const deleteBranchMut = useDeleteGitBranch();
  const cloneMut = usePostGitClone();

  const [commitMsg, setCommitMsg] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [offline, setOffline] = useState(false);
  const [commitProdOpen, setCommitProdOpen] = useState(false);
  const [forceCheckoutName, setForceCheckoutName] = useState<string | null>(
    null,
  );
  const [deleteBranchName, setDeleteBranchName] = useState<string | null>(null);

  // Offline: fetch failure / GIT_OFFLINE style (6.13)
  useEffect(() => {
    if (!open || !repoReady) return;
    let cancelled = false;
    (async () => {
      try {
        await fetchMut.mutateAsync({ remote: "origin" });
        if (!cancelled) setOffline(false);
      } catch (err) {
        const { code, list } = extractGitError(err);
        const msg = list.join(" ").toLowerCase();
        if (
          code === "GIT_OFFLINE" ||
          msg.includes("could not resolve") ||
          msg.includes("failed to connect") ||
          msg.includes("network") ||
          msg.includes("timed out")
        ) {
          if (!cancelled) setOffline(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, repoReady]);

  // Keyboard shortcuts Pull/Push (8.1)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        void handlePull();
      }
      if (e.key.toLowerCase() === "u") {
        e.preventDefault();
        void handlePush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, status?.on_production, status?.unresolved_conflicts]);

  const dirtyCount = status?.entries?.length ?? 0;
  const entries = useMemo(() => {
    const list = status?.entries ?? [];
    return list.slice(0, DIRTY_RENDER_CAP);
  }, [status?.entries]);

  const onProduction = Boolean(
    status?.on_production ?? health?.on_production,
  );
  const unresolved = Boolean(status?.unresolved_conflicts);
  const pushBlocked = unresolved || offline;
  const pushTooltip = unresolved
    ? "Push blocked while conflicts unresolved"
    : offline
      ? "Remote unreachable"
      : onProduction
        ? "Push to production (origin)"
        : "Push to origin";

  const branchName =
    status?.branch || health?.current_branch || "(unknown)";
  const prodName =
    status?.production_branch || health?.production_branch || null;

  const flash = (ok: boolean, title: string, err?: unknown) => {
    if (ok) setSuccessData({ title });
    else setErrorData(extractGitError(err));
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) {
      setErrorData({ title: "Commit message required" });
      return;
    }
    if (onProduction) {
      setCommitProdOpen(true);
      return;
    }
    await doCommit();
  };

  const doCommit = async () => {
    try {
      await commitMut.mutateAsync({ message: commitMsg.trim() });
      setCommitMsg("");
      flash(true, "Committed");
    } catch (err) {
      flash(false, "Commit failed", err);
    }
  };

  const handlePush = async () => {
    if (pushBlocked) return;
    try {
      await pushMut.mutateAsync({});
      flash(true, "Pushed");
      setOffline(false);
    } catch (err) {
      flash(false, "Push failed", err);
    }
  };

  const handlePull = async () => {
    try {
      await pullMut.mutateAsync({ strategy: "merge" });
      flash(true, "Pulled");
      setOffline(false);
    } catch (err) {
      flash(false, "Pull failed", err);
    }
  };

  const handleFetch = async () => {
    try {
      await fetchMut.mutateAsync({});
      flash(true, "Fetched");
      setOffline(false);
    } catch (err) {
      const parsed = extractGitError(err);
      setOffline(true);
      setErrorData(parsed);
    }
  };

  const handleCheckout = async (name: string) => {
    try {
      await checkoutMut.mutateAsync({ name });
      flash(true, `Switched to ${name}`);
    } catch (err) {
      const parsed = extractGitError(err);
      if (parsed.code === "DIRTY_WORKTREE" || parsed.code === "GIT_DIRTY_WORKTREE") {
        setForceCheckoutName(name);
        return;
      }
      flash(false, "Checkout failed", err);
    }
  };

  const handleCreateBranch = async () => {
    const name = newBranch.trim();
    if (!name) return;
    if (prodName && name === prodName) {
      setErrorData({
        title: "Cannot create production branch name from UI",
        list: ["Pick a working branch name."],
      });
      return;
    }
    try {
      await createBranchMut.mutateAsync({ name, checkout: true });
      setNewBranch("");
      flash(true, `Created ${name}`);
    } catch (err) {
      flash(false, "Create branch failed", err);
    }
  };

  const handleDeleteBranch = async (name: string) => {
    if (prodName && name === prodName) {
      setErrorData({ title: "Cannot delete production branch" });
      return;
    }
    setDeleteBranchName(name);
  };

  const notInstalled = health?.banner_code === "GIT_NOT_INSTALLED";
  const showWizard =
    focusWizard ||
    !health?.repo_is_git ||
    health?.banner_code === "GIT_REPO_NOT_INITIALIZED";

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className={cn(
          "fixed inset-y-0 right-0 left-auto top-0 flex h-full max-h-full w-full max-w-md translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-l p-0 sm:max-w-md",
        )}
        data-testid="git-panel"
      >
        <DialogHeader className="border-b px-4 py-3 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ForwardedIconComponent name="GitBranch" className="h-4 w-4" />
            Git
            {offline && (
              <Badge variant="errorStatic" size="tag" data-testid="git-offline-badge">
                Offline
              </Badge>
            )}
            {notInstalled && (
              <Badge
                variant="errorStatic"
                size="tag"
                data-testid="git-not-installed-badge"
              >
                GIT_NOT_INSTALLED
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
          <OnboardingChecklist health={health} status={status} />

          {(notInstalled || health?.banner_message) && (
            <div
              className="rounded-md border border-amber-600/40 bg-amber-50 p-3 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
              data-testid="git-panel-banner"
            >
              <div className="font-semibold">{health?.banner_code}</div>
              <div>{health?.banner_message}</div>
            </div>
          )}

          {showWizard && (
            <ConnectWizard
              busy={cloneMut.isPending}
              defaultDestHint="Uses LANGFLOW_GIT_FLOWS_DIR when blank"
              onClone={async (payload) => {
                try {
                  await cloneMut.mutateAsync(payload);
                  flash(true, "Repository cloned");
                  useGitUiStore.getState().setFocusWizard(false);
                } catch (err) {
                  flash(false, "Clone failed", err);
                }
              }}
            />
          )}

          <div className="flex flex-wrap items-center gap-2" data-testid="git-branch-badges">
            <Badge variant="secondaryStatic" size="tag">
              {branchName}
            </Badge>
            {prodName && (
              <ShadTooltip content="Immutable production branch (from .langflow/production-branch)">
                <Badge
                  variant={onProduction ? "errorStatic" : "purpleStatic"}
                  size="tag"
                  data-testid="git-prod-badge"
                >
                  prod: {prodName}
                </Badge>
              </ShadTooltip>
            )}
            <Badge
              variant={dirtyCount > 0 ? "pinkStatic" : "gray"}
              size="tag"
              data-testid="git-dirty-count"
            >
              {dirtyCount} dirty
            </Badge>
            {(conflictsData?.conflicts?.length ?? 0) > 0 && (
              <Button
                variant="link"
                size="xs"
                className="h-auto p-0 text-xs"
                onClick={() => {
                  setOpen(false);
                  navigate("/settings/git-conflicts");
                }}
              >
                {conflictsData!.conflicts.length} conflict(s)
              </Button>
            )}
          </div>

          {repoReady && (
            <>
              <section className="space-y-2">
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Remotes
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={fetchMut.isPending}
                    onClick={() => void handleFetch()}
                    data-testid="git-fetch-btn"
                  >
                    Fetch
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pullMut.isPending}
                    onClick={() => void handlePull()}
                    data-testid="git-pull-btn"
                  >
                    Pull
                  </Button>
                  <ShadTooltip content={pushTooltip}>
                    <span>
                      <Button
                        size="sm"
                        disabled={pushBlocked || pushMut.isPending}
                        onClick={() => void handlePush()}
                        data-testid="git-push-btn"
                      >
                        Push
                      </Button>
                    </span>
                  </ShadTooltip>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Shortcuts: Ctrl/Cmd+Shift+P Pull · Ctrl/Cmd+Shift+U Push
                </p>
              </section>

              <section className="space-y-2">
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Commit
                </div>
                <Textarea
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="Commit message"
                  className="min-h-[72px] text-sm"
                  data-testid="git-commit-message"
                />
                <Button
                  size="sm"
                  disabled={!dirtyCount || commitMut.isPending}
                  onClick={() => void handleCommit()}
                  data-testid="git-commit-btn"
                >
                  Commit
                </Button>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Changes
                  </div>
                  {dirtyCount > DIRTY_RENDER_CAP && (
                    <span className="text-[11px] text-muted-foreground">
                      showing {DIRTY_RENDER_CAP}/{dirtyCount}
                    </span>
                  )}
                </div>
                {statusError && (
                  <p className="text-xs text-destructive">Could not load status</p>
                )}
                <ul
                  className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 text-xs"
                  data-testid="git-status-list"
                >
                  {entries.length === 0 && (
                    <li className="text-muted-foreground">Clean working tree</li>
                  )}
                  {entries.map((e) => (
                    <li
                      key={e.path}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="truncate font-mono">
                        {e.index_status}
                        {e.worktree_status} {e.path}
                      </span>
                      {e.flow_id && (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setDiffFlowId(e.flow_id!)}
                        >
                          Diff
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {diffFlowId && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">Diff {diffFlowId}</span>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setDiffFlowId(null)}
                      >
                        Close
                      </Button>
                    </div>
                    <pre
                      className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[10px]"
                      data-testid="git-diff-view"
                    >
                      {diffData?.diff || "(empty)"}
                    </pre>
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  Branches
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newBranch}
                    onChange={(e) => setNewBranch(e.target.value)}
                    placeholder="new-branch"
                    className="h-8 text-sm"
                    data-testid="git-new-branch-input"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleCreateBranch()}
                    data-testid="git-create-branch-btn"
                  >
                    Create
                  </Button>
                </div>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
                  {(branchesData?.branches ?? []).map((b) => {
                    const name = b.name;
                    const current = Boolean(b.current || b.is_current);
                    const isProd = Boolean(
                      b.is_production || (prodName && name === prodName),
                    );
                    return (
                      <li
                        key={name}
                        className="flex items-center justify-between gap-1"
                      >
                        <button
                          type="button"
                          className={cn(
                            "truncate text-left hover:underline",
                            current && "font-semibold",
                          )}
                          onClick={() => void handleCheckout(name)}
                        >
                          {name}
                          {current ? " *" : ""}
                          {isProd ? " (prod)" : ""}
                        </button>
                        {!current && !isProd && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => void handleDeleteBranch(name)}
                          >
                            Del
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </>
          )}

          <section className="space-y-1 border-t pt-3 text-xs">
            <Button
              variant="link"
              size="xs"
              className="h-auto p-0"
              onClick={() => {
                setOpen(false);
                navigate("/settings/git-auth");
              }}
            >
              Git Auth (PAT)
            </Button>
            <Button
              variant="link"
              size="xs"
              className="h-auto p-0"
              onClick={() => {
                setOpen(false);
                navigate("/settings/git-conflicts");
              }}
            >
              Conflicts
            </Button>
          </section>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={commitProdOpen} onOpenChange={setCommitProdOpen}>
      <DialogContent className="max-w-md border-amber-500/50">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <ForwardedIconComponent
              name="AlertTriangle"
              className="h-5 w-5 shrink-0"
            />
            Commit to production?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          You are on production branch{" "}
          <span className="font-mono font-medium text-foreground">
            {prodName || "main"}
          </span>
          . This commits directly to production.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => setCommitProdOpen(false)}
            disabled={commitMut.isPending}
          >
            Cancel
          </Button>
          <Button
            className="bg-amber-500 text-amber-950 hover:bg-amber-400"
            disabled={commitMut.isPending}
            loading={commitMut.isPending}
            onClick={() => {
              setCommitProdOpen(false);
              void doCommit();
            }}
          >
            Commit anyway
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <GitConfirmDialog
      open={Boolean(forceCheckoutName)}
      onOpenChange={(o) => {
        if (!o) setForceCheckoutName(null);
      }}
      tone="danger"
      title="Force checkout"
      description="Working tree is dirty. Force checkout discards local changes on this switch."
      confirmLabel="Force checkout"
      busy={checkoutMut.isPending}
      onConfirm={() => {
        const name = forceCheckoutName;
        setForceCheckoutName(null);
        if (!name) return;
        void (async () => {
          try {
            await checkoutMut.mutateAsync({ name, force: true });
            flash(true, `Force switched to ${name}`);
          } catch (err2) {
            flash(false, "Checkout failed", err2);
          }
        })();
      }}
    />

    <GitConfirmDialog
      open={Boolean(deleteBranchName)}
      onOpenChange={(o) => {
        if (!o) setDeleteBranchName(null);
      }}
      tone="danger"
      title="Delete local branch"
      description={`Delete local branch ${deleteBranchName}?`}
      confirmLabel="Delete"
      busy={deleteBranchMut.isPending}
      onConfirm={() => {
        const name = deleteBranchName;
        setDeleteBranchName(null);
        if (!name) return;
        void (async () => {
          try {
            await deleteBranchMut.mutateAsync({ name });
            flash(true, `Deleted ${name}`);
          } catch (err) {
            flash(false, "Delete failed", err);
          }
        })();
      }}
    />
    </>
  );
}
