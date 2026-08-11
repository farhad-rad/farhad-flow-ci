import { useEffect, useMemo, useRef, useState } from "react";
import { FaGitlab } from "react-icons/fa";
import { Link } from "react-router-dom";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useGetGitBranches,
  useGetGitCommit,
  useGetGitConflicts,
  useGetGitDiff,
  useGetGitHealth,
  useGetGitLog,
  useGetGitOpsLog,
  useGetGitProductionBranch,
  useGetGitRemote,
  useGetGitStatus,
  usePostGitCheckout,
  usePostGitCommit,
  usePostGitCreateBranch,
  usePostGitDiscard,
  usePostGitFetch,
  usePostGitPull,
  usePostGitPush,
} from "@/controllers/API/queries/git";
import { CreateBranchDialog } from "@/features/git/CreateBranchDialog";
import { GitDiffView } from "@/features/git/GitDiffView";
import { GitGraphView } from "@/features/git/GitGraphView";
import { extractGitError } from "@/features/git/gitError";
import {
  GitBusyBanner,
  GitLoadingPanel,
} from "@/features/git/GitLoadingPanel";
import {
  mergeGitBranches,
  type RawGitBranch,
} from "@/features/git/mergeBranches";
import type { GitStatusEntry } from "@/features/git/types";
import ConfirmationModal from "@/modals/confirmationModal";
import useAlertStore from "@/stores/alertStore";
import { cn } from "@/utils/utils";

function displayName(e: GitStatusEntry): string {
  if (e.flow_name?.trim()) return e.flow_name.trim();
  if (e.path.startsWith("secrets/vars/")) {
    return `secret (${e.path.replace(/^secrets\/vars\//, "").replace(/\.json$/, "").slice(0, 8)})`;
  }
  if (e.flow_id) return `Untitled (${e.flow_id.slice(0, 8)})`;
  return e.path.replace(/^flows\//, "");
}

function kindOf(e: GitStatusEntry): string {
  if (e.change_kind) return e.change_kind;
  const pair = `${e.index_status || " "}${e.worktree_status || " "}`;
  if (pair.includes("D")) return "deleted";
  if (pair.includes("?") || pair.includes("A")) return "created";
  if (pair.includes("R") || pair.includes("C")) return "renamed";
  if (pair.includes("M") || pair.includes("U") || pair.includes("T"))
    return "modified";
  if (pair.trim()) return "modified";
  return "unchanged";
}

function isManagedLock(path: string): boolean {
  return (
    path === "flows.lock" ||
    path.endsWith("/flows.lock") ||
    path === "secrets.lock" ||
    path.endsWith("/secrets.lock")
  );
}

function isDirtyEntry(e: GitStatusEntry): boolean {
  return !isManagedLock(e.path) && kindOf(e) !== "unchanged";
}

const KIND_STYLE: Record<
  string,
  { badge: string; badgeCls: string; dot: string; text: string }
> = {
  created: {
    badge: "A",
    badgeCls:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-300",
  },
  modified: {
    badge: "M",
    badgeCls:
      "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-400",
    text: "text-amber-700 dark:text-amber-300",
  },
  deleted: {
    badge: "D",
    badgeCls: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300",
    dot: "bg-red-500",
    text: "text-red-600 dark:text-red-300",
  },
  renamed: {
    badge: "R",
    badgeCls: "border-sky-400/40 bg-sky-400/10 text-sky-700 dark:text-sky-300",
    dot: "bg-sky-400",
    text: "text-sky-700 dark:text-sky-300",
  },
  unchanged: {
    badge: "",
    badgeCls: "",
    dot: "bg-foreground/35",
    text: "text-foreground",
  },
};

function formatOpsLine(raw: string): string {
  try {
    const row = JSON.parse(raw) as {
      ts?: string;
      op?: string;
      ok?: boolean;
      error?: string | null;
      detail?: Record<string, unknown>;
    };
    const t = (row.ts || "").slice(11, 19);
    const op = row.op || "?";
    const mark = row.ok === false ? "✗" : "✓";
    const err = row.error ? ` — ${row.error}` : "";
    return `${t} ${mark} ${op}${err}`;
  } catch {
    return raw.slice(0, 80);
  }
}

export default function GitHistoryPage(): JSX.Element {
  const { data: health, isLoading: healthLoading } = useGetGitHealth();
  const ready = Boolean(health?.setup_complete ?? health?.repo_is_git);
  const {
    data: status,
    refetch: refetchStatus,
    isLoading: statusLoading,
  } = useGetGitStatus({
    enabled: ready,
    refetchInterval: 8_000,
  });
  const { data: branchesData, refetch: refetchBranches } = useGetGitBranches({
    enabled: ready,
  });
  const {
    data: logData,
    refetch: refetchLog,
    isLoading: logLoading,
  } = useGetGitLog(
    { max_count: 80, graph: true },
    { enabled: ready },
  );
  const { data: conflictsData, refetch: refetchConflicts } = useGetGitConflicts({
    enabled: ready,
  });
  const { data: opsData, refetch: refetchOps } = useGetGitOpsLog(
    { limit: 12 },
    { enabled: ready },
  );
  const { data: remote } = useGetGitRemote({ enabled: ready });
  const { data: prod } = useGetGitProductionBranch({ enabled: ready });

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [commitSha, setCommitSha] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [fromBranch, setFromBranch] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);
  const [activeRemote, setActiveRemote] = useState<
    "pull" | "sync" | "push" | null
  >(null);

  const entries = useMemo(() => status?.entries ?? [], [status]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (!isDirtyEntry(e)) return false;
      if (!q) return true;
      const name = displayName(e).toLowerCase();
      return name.includes(q) || e.path.toLowerCase().includes(q);
    });
  }, [entries, query]);

  const dirtyCount = useMemo(
    () => entries.filter(isDirtyEntry).length,
    [entries],
  );

  const conflicts = conflictsData?.conflicts ?? [];
  const opsLines = [...(opsData?.lines ?? [])].reverse();

  const diffEntry = useMemo(
    () => entries.find((e) => e.path === diffPath) || null,
    [entries, diffPath],
  );
  const diffFlowId = diffEntry?.flow_id ?? null;
  const { data: diffData, isFetching: diffLoading } = useGetGitDiff(
    {
      flowId: diffEntry?.path?.startsWith("secrets/")
        ? null
        : diffFlowId,
      path: diffEntry?.path ?? null,
    },
    {
      enabled: Boolean(diffEntry?.path),
    },
  );
  const { data: commitDetail, isFetching: commitLoading } = useGetGitCommit(
    commitSha,
    { enabled: Boolean(commitSha) },
  );

  const commitMut = usePostGitCommit();
  const discardMut = usePostGitDiscard();
  const pushMut = usePostGitPush();
  const pullMut = usePostGitPull();
  const fetchMut = usePostGitFetch();
  const checkoutMut = usePostGitCheckout();
  const createBranchMut = usePostGitCreateBranch();

  const setSuccessData = useAlertStore((s) => s.setSuccessData);
  const setErrorData = useAlertStore((s) => s.setErrorData);

  const [commitMsg, setCommitMsg] = useState("");
  const [rollbackPrompt, setRollbackPrompt] = useState<{
    paths: string[];
    title: string;
    body: string;
  } | null>(null);
  const [commitProdOpen, setCommitProdOpen] = useState(false);
  const prodName = prod?.name || health?.production_branch || "main";
  const mergedBranches = useMemo(
    () =>
      mergeGitBranches(
        (branchesData?.branches as RawGitBranch[]) ?? [],
        status?.branch,
        prodName,
      ),
    [branchesData?.branches, status?.branch, prodName],
  );
  const branchNames = useMemo(
    () => mergedBranches.map((b) => b.name),
    [mergedBranches],
  );
  const repoLabel =
    remote?.display_path ||
    (remote?.namespace && remote?.project_name
      ? `${remote.namespace}/${remote.project_name}`
      : null) ||
    remote?.project_path ||
    "flows";
  const repoWebUrl = remote?.web_url || null;

  useEffect(() => {
    setSelectedPaths((prev) => {
      const dirty = new Set(entries.filter(isDirtyEntry).map((e) => e.path));
      const next = new Set([...prev].filter((p) => dirty.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [entries]);

  useEffect(() => {
    if (!fromBranch) {
      setFromBranch(status?.branch || prodName);
    }
  }, [status?.branch, prodName, fromBranch]);

  const refreshAll = async () => {
    await Promise.all([
      refetchStatus(),
      refetchLog(),
      refetchConflicts(),
      refetchOps(),
      refetchBranches(),
    ]);
  };

  const refreshAllRef = useRef(refreshAll);
  refreshAllRef.current = refreshAll;

  // Silent remote refresh every 60s (no toast).
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          await fetchMut.mutateAsync({});
          await refreshAllRef.current();
        } catch {
          // silent — timer must not spam toasts
        }
      })();
    }, 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch mut + ready only
  }, [ready]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      setSuccessData({ title: label });
      await refreshAll();
    } catch (err) {
      setErrorData(extractGitError(err));
    }
  };

  const togglePath = (path: string, kind: string) => {
    if (kind === "unchanged") return;
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedPaths(new Set(visible.map((e) => e.path)));
  };

  const doCommit = async () => {
    const paths = [...selectedPaths];
    if (!paths.length || !commitMsg.trim()) return;
    await run("Committed", async () => {
      await commitMut.mutateAsync({ message: commitMsg.trim(), paths });
      setCommitMsg("");
      setSelectedPaths(new Set());
    });
  };

  const commitSelected = () => {
    const paths = [...selectedPaths];
    if (!paths.length || !commitMsg.trim()) return;
    if (status?.on_production) {
      setCommitProdOpen(true);
      return;
    }
    void doCommit();
  };

  const discardSelected = () => {
    const paths = [...selectedPaths];
    if (!paths.length) return;
    setRollbackPrompt({
      paths,
      title: "Rollback changes",
      body: `Rollback ${paths.length} change(s)? Modified and deleted flows restore from Git; added flows are removed. This cannot be undone.`,
    });
  };

  const rollbackOne = (path: string, label: string) => {
    setRollbackPrompt({
      paths: [path],
      title: "Rollback change",
      body: `Rollback “${label}”? Restores or removes this flow to match the last commit. This cannot be undone.`,
    });
  };

  const confirmRollback = () => {
    if (!rollbackPrompt?.paths.length) return;
    const paths = rollbackPrompt.paths;
    setRollbackPrompt(null);
    void run("Rolled back", async () => {
      await discardMut.mutateAsync({ paths });
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        for (const p of paths) next.delete(p);
        return next;
      });
      if (diffPath && paths.includes(diffPath)) setDiffPath(null);
    });
  };

  const pullNow = () => {
    setActiveRemote("pull");
    void run("Pulled", async () => {
      await pullMut.mutateAsync({});
    }).finally(() => setActiveRemote(null));
  };

  const pushNow = () => {
    setActiveRemote("push");
    void run("Pushed", async () => {
      await pushMut.mutateAsync({});
    }).finally(() => setActiveRemote(null));
  };

  const syncNow = () => {
    setActiveRemote("sync");
    void (async () => {
      try {
        await fetchMut.mutateAsync({});
        const afterFetch = await refetchStatus();
        const s1 = afterFetch.data;
        if ((s1?.behind ?? 0) > 0 && !s1?.unresolved_conflicts) {
          await pullMut.mutateAsync({});
        }
        const afterPull = await refetchStatus();
        const s2 = afterPull.data;
        if ((s2?.ahead ?? 0) > 0 && !s2?.unresolved_conflicts) {
          await pushMut.mutateAsync({});
        }
        setSuccessData({ title: "Synced" });
        await refreshAll();
      } catch (err) {
        setErrorData(extractGitError(err));
      } finally {
        setActiveRemote(null);
      }
    })();
  };

  const checkoutBranch = (name: string) => {
    if (!name || name === status?.branch) return;
    void run(`Checked out ${name}`, () =>
      checkoutMut.mutateAsync({ name }),
    );
  };

  const openCreateBranch = () => {
    setFromBranch(status?.branch || prodName);
    setBranchOpen(true);
  };

  const createBranch = () => {
    const name = newBranch.trim();
    if (!name) return;
    void run(`Branch ${name}`, async () => {
      await createBranchMut.mutateAsync({
        name,
        checkout: true,
        start_point: fromBranch.trim() || undefined,
      });
      setNewBranch("");
      setBranchOpen(false);
    });
  };

  if (healthLoading && !health) {
    return <GitLoadingPanel label="Checking git connection…" />;
  }

  if (!ready) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect a flows repo first (setup wizard).
      </p>
    );
  }

  const busy =
    commitMut.isPending ||
    discardMut.isPending ||
    pushMut.isPending ||
    pullMut.isPending ||
    fetchMut.isPending ||
    checkoutMut.isPending ||
    createBranchMut.isPending;

  const busyLabel = pullMut.isPending
    ? "Pulling…"
    : pushMut.isPending
      ? "Pushing…"
      : fetchMut.isPending
        ? "Fetching…"
        : commitMut.isPending
          ? "Committing…"
          : discardMut.isPending
            ? "Discarding…"
            : checkoutMut.isPending
              ? "Checking out…"
              : createBranchMut.isPending
                ? "Creating branch…"
                : "Working…";

  const changesLoading = statusLoading && !status;
  const graphLoading = logLoading && !logData;

  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const aheadOfProd = status?.ahead_of_production ?? 0;
  const onProd = Boolean(status?.on_production);
  const hasConflicts = Boolean(status?.unresolved_conflicts);
  const hasUpstream = status?.has_upstream !== false;
  const remoteInFlight = Boolean(activeRemote);
  const canPull = !hasConflicts && behind > 0 && !remoteInFlight && !busy;
  const canPush = !hasConflicts && ahead > 0 && !remoteInFlight && !busy;
  const canSync = !hasConflicts && !remoteInFlight && !busy;
  const showMrBox = !onProd && aheadOfProd > 0;

  return (
    <div
      className="flex h-[calc(100vh-11rem)] min-h-[520px] flex-col gap-2"
      data-testid="git-history-page"
    >
      {busy && !activeRemote && <GitBusyBanner label={busyLabel} />}

      {/* Command bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {repoWebUrl ? (
            <a
              href={repoWebUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 max-w-[min(100vw,18rem)] items-center gap-1.5 rounded-md px-1 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={repoWebUrl}
            >
              <FaGitlab
                className="h-3.5 w-3.5 shrink-0 text-[#FC6D26]"
                aria-hidden
              />
              <span className="truncate text-sm font-semibold text-foreground">
                {repoLabel}
              </span>
            </a>
          ) : (
            <span className="inline-flex min-w-0 max-w-[min(100vw,18rem)] items-center gap-1.5 px-1 py-0.5">
              <FaGitlab
                className="h-3.5 w-3.5 shrink-0 text-[#FC6D26]"
                aria-hidden
              />
              <span
                className="truncate text-sm font-semibold"
                title={remote?.project_path || repoLabel}
              >
                {repoLabel}
              </span>
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className={cn(
                  "h-7 gap-1 px-2 font-mono text-sm font-medium",
                  onProd && "text-amber-600 dark:text-amber-400",
                )}
                disabled={busy}
              >
                {onProd ? (
                  <ForwardedIconComponent
                    name="Star"
                    className="h-3.5 w-3.5 shrink-0 fill-amber-500 text-amber-500"
                    strokeWidth={2}
                  />
                ) : null}
                {status?.branch || "—"}
                <ForwardedIconComponent
                  name="ChevronDown"
                  className="h-3.5 w-3.5 opacity-60"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-auto">
              <DropdownMenuLabel>Branches</DropdownMenuLabel>
              {mergedBranches.map((b) => {
                const name = b.name;
                const isCurrent = b.current || name === status?.branch;
                return (
                  <DropdownMenuItem
                    key={name}
                    disabled={busy || isCurrent}
                    onClick={() => checkoutBranch(name)}
                    className="font-mono text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    {b.local_only ? (
                      <span className="ml-2 text-[10px] text-sky-600 dark:text-sky-300">
                        local
                      </span>
                    ) : null}
                    {isCurrent ? (
                      <span className="ml-2 text-[10px] text-primary">current</span>
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={busy}
                onClick={openCreateBranch}
              >
                <ForwardedIconComponent
                  name="Plus"
                  className="mr-2 h-3.5 w-3.5"
                />
                Create branch…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          {dirtyCount > 0 ? (
            <span className="inline-flex items-center gap-0.5 font-mono text-[11px] text-amber-600 dark:text-amber-400">
              <ForwardedIconComponent
                name="PenLine"
                className="h-3 w-3"
                strokeWidth={2.5}
              />
              {dirtyCount}
            </span>
          ) : (
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              clean
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center">
          <div className="inline-flex overflow-hidden rounded-md border">
            <Button
              size="sm"
              variant="ghost"
              className="h-8 rounded-none px-2.5 text-xs"
              disabled={!canPull}
              onClick={pullNow}
              title={
                behind === 0
                  ? "Nothing to pull"
                  : `Pull ${behind} behind`
              }
            >
              {activeRemote === "pull" ? (
                <ForwardedIconComponent
                  name="Loader2"
                  className="mr-1 h-3.5 w-3.5 animate-spin"
                />
              ) : null}
              Pull{behind > 0 ? ` (${behind})` : ""}
            </Button>
            <div className="w-px self-stretch bg-border" />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 rounded-none px-2.5 text-xs"
              disabled={!canSync}
              onClick={syncNow}
              title="Fetch, then pull if behind, then push if ahead"
            >
              {activeRemote === "sync" ? (
                <ForwardedIconComponent
                  name="Loader2"
                  className="mr-1 h-3.5 w-3.5 animate-spin"
                />
              ) : null}
              Sync
            </Button>
            <div className="w-px self-stretch bg-border" />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 rounded-none px-2.5 text-xs"
              disabled={!canPush}
              onClick={pushNow}
              title={
                ahead === 0
                  ? "Nothing to push"
                  : !hasUpstream
                    ? `Publish branch — create origin/${status?.branch || "branch"} and push ${ahead}`
                    : onProd
                      ? `Push ${ahead} to production`
                      : `Push ${ahead} ahead`
              }
            >
              {activeRemote === "push" ? (
                <ForwardedIconComponent
                  name="Loader2"
                  className="mr-1 h-3.5 w-3.5 animate-spin"
                />
              ) : null}
              {!hasUpstream && ahead > 0 ? "Publish" : "Push"}
              {ahead > 0 ? ` (${ahead})` : ""}
            </Button>
          </div>
        </div>
      </div>

      {showMrBox && (
        <Link
          to="/git/merge-requests"
          className="group block rounded-lg border border-primary/30 bg-primary/5 px-4 py-4 shadow-sm transition-colors hover:border-primary/50 hover:bg-primary/10"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-semibold text-foreground">
                Open a merge request
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="font-mono text-foreground">
                  {status?.branch}
                </span>{" "}
                is {aheadOfProd} commit{aheadOfProd === 1 ? "" : "s"} ahead of{" "}
                <span className="font-mono text-foreground">{prodName}</span>.
                Propose a merge to production.
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground group-hover:opacity-90">
              Open MR
              <ForwardedIconComponent name="ArrowRight" className="h-4 w-4" />
            </span>
          </div>
        </Link>
      )}

      {conflicts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <ForwardedIconComponent
            name="AlertTriangle"
            className="h-4 w-4 text-destructive"
          />
          <span className="font-medium text-destructive">
            {conflicts.length} unresolved conflict
            {conflicts.length === 1 ? "" : "s"}
          </span>
          <span className="text-muted-foreground">
            Resolve before push/merge.
          </span>
          <ul className="flex flex-wrap gap-1.5">
            {conflicts.slice(0, 6).map((c) => (
              <Badge key={c.flow_id} variant="outline">
                {c.rel_path?.replace(/^flows\//, "") || c.flow_id.slice(0, 8)}
              </Badge>
            ))}
          </ul>
        </div>
      )}

      {opsLines.length > 0 && (
        <div className="flex items-center gap-2 overflow-hidden rounded-md border bg-muted/10 px-2 py-1 text-[10px] text-muted-foreground">
          <span className="shrink-0 font-semibold uppercase tracking-wide">
            Ops
          </span>
          <div className="min-w-0 flex-1 truncate font-mono">
            {opsLines
              .slice(0, 4)
              .map((line) => formatOpsLine(line))
              .join("  ·  ")}
          </div>
        </div>
      )}

      {/* Flows wide · graph thin (VS Code Git Graph style) */}
      <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(220px,300px)]">
        {/* Left: flows + commit */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-background shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Changes</span>
              <span className="text-xs text-muted-foreground">
                {dirtyCount === 0
                  ? "clean"
                  : query.trim()
                    ? `${visible.length} of ${dirtyCount}`
                    : `${dirtyCount} dirty`}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                size="xs"
                variant="ghost"
                disabled={visible.length === 0}
                onClick={selectAll}
              >
                Select all
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={selectedPaths.size === 0}
                onClick={() => setSelectedPaths(new Set())}
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="border-b px-3 py-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search changes…"
              className="h-8 bg-background"
            />
          </div>

          <ul className="min-h-0 flex-1 overflow-auto p-1.5">
            {changesLoading ? (
              <li>
                <GitLoadingPanel label="Loading changes…" compact />
              </li>
            ) : visible.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-muted-foreground">
                {query.trim() ? "No matching changes" : "No local changes"}
              </li>
            ) : (
              visible.map((e) => {
                const kind = kindOf(e);
                const style = KIND_STYLE[kind] || KIND_STYLE.unchanged;
                const checked = selectedPaths.has(e.path);
                const name = displayName(e);
                return (
                  <li key={e.path} className="mb-0.5">
                    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => togglePath(e.path, kind)}
                        aria-label={`Select ${name}`}
                      />
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => setDiffPath(e.path)}
                      >
                        {style.badge ? (
                          <span
                            className={cn(
                              "shrink-0 rounded border px-1 py-px font-mono text-[10px] font-semibold leading-none",
                              style.badgeCls,
                            )}
                            title={kind}
                          >
                            {style.badge}
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            "truncate text-sm font-medium",
                            style.text,
                            kind === "deleted" && "line-through opacity-80",
                          )}
                        >
                          {name}
                        </span>
                      </button>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100"
                        onClick={() => setDiffPath(e.path)}
                      >
                        Diff
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="text-destructive opacity-0 group-hover:opacity-100 hover:text-destructive"
                        disabled={busy}
                        onClick={() => rollbackOne(e.path, name)}
                      >
                        Rollback
                      </Button>
                    </div>
                  </li>
                );
              })
            )}
          </ul>

          {/* Commit composer — actions first so never clipped */}
          <div className="shrink-0 space-y-2 border-t bg-muted/15 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="min-w-[128px]"
                disabled={
                  busy || !commitMsg.trim() || selectedPaths.size === 0
                }
                onClick={commitSelected}
                data-testid="git-history-commit"
              >
                <ForwardedIconComponent
                  name="Check"
                  className="mr-1 h-3.5 w-3.5"
                />
                Commit selected
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy || selectedPaths.size === 0}
                onClick={discardSelected}
              >
                Rollback selected
              </Button>
              <span className="text-xs text-muted-foreground">
                {selectedPaths.size} selected · auto-commit off
              </span>
              <span className="ml-auto hidden text-[10px] text-muted-foreground xl:inline">
                green A · amber M · red D
              </span>
            </div>
            <Textarea
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder="Commit message for selected flows…"
              className="min-h-[56px] resize-none bg-background"
              data-testid="git-history-commit-msg"
            />
            {selectedPaths.size > 0 && (
              <p className="truncate text-xs text-muted-foreground">
                {[...selectedPaths]
                  .slice(0, 4)
                  .map((p) => {
                    const e = entries.find((x) => x.path === p);
                    return e ? displayName(e) : p;
                  })
                  .join(", ")}
                {selectedPaths.size > 4 ? ` +${selectedPaths.size - 4}` : ""}
              </p>
            )}
          </div>
        </section>

        {/* Right: thin Graph panel */}
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-sm">
          <div className="flex items-center justify-between border-b px-2.5 py-1.5">
            <span className="text-sm font-semibold">Graph</span>
            <span className="text-[10px] text-muted-foreground">
              {(logData?.commits || []).length}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {graphLoading ? (
              <GitLoadingPanel label="Loading graph…" compact />
            ) : (
              <GitGraphView
                commits={logData?.commits || []}
                fill
                selectedSha={commitSha}
                onSelect={(c) => setCommitSha(c.sha)}
              />
            )}
          </div>
        </section>
      </div>

      {/* Diff modal */}
      <Dialog
        open={Boolean(diffPath)}
        onOpenChange={(open) => {
          if (!open) setDiffPath(null);
        }}
      >
        <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-4 py-3">
            <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
              <span>Diff</span>
              {diffEntry && (
                <>
                  <span className="font-normal text-muted-foreground">·</span>
                  <span className={cn(KIND_STYLE[kindOf(diffEntry)]?.text)}>
                    {displayName(diffEntry)}
                  </span>
                  {KIND_STYLE[kindOf(diffEntry)]?.badge ? (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {KIND_STYLE[kindOf(diffEntry)].badge}
                    </Badge>
                  ) : null}
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto">
            {diffLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading diff…</p>
            ) : (
              <GitDiffView
                diff={diffData?.diff}
                emptyLabel={
                  kindOf(
                    diffEntry ||
                      ({ change_kind: "unchanged" } as GitStatusEntry),
                  ) === "unchanged"
                    ? "No local changes for this flow"
                    : "No textual diff"
                }
              />
            )}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-2">
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {diffEntry?.path}
            </span>
            {diffEntry && kindOf(diffEntry) !== "unchanged" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  togglePath(diffEntry.path, kindOf(diffEntry));
                }}
              >
                {selectedPaths.has(diffEntry.path)
                  ? "Unselect for commit"
                  : "Select for commit"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Commit detail modal */}
      <Dialog
        open={Boolean(commitSha)}
        onOpenChange={(open) => {
          if (!open) setCommitSha(null);
        }}
      >
        <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-4 py-3">
            <DialogTitle className="flex flex-wrap items-center gap-2 font-mono text-base">
              {commitDetail?.short_sha || commitSha?.slice(0, 8)}
              {(commitDetail?.refs || []).slice(0, 3).map((r) => (
                <Badge key={r} variant="outline" className="font-sans text-[10px]">
                  {r}
                </Badge>
              ))}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
            {commitLoading && !commitDetail ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <p className="whitespace-pre-wrap text-sm">
                  {commitDetail?.message || commitDetail?.summary}
                </p>
                <p className="text-xs text-muted-foreground">
                  {commitDetail?.author}
                  {commitDetail?.authored_date
                    ? ` · ${commitDetail.authored_date.slice(0, 19).replace("T", " ")}`
                    : ""}
                </p>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Files ({commitDetail?.files?.length ?? 0})
                  </div>
                  <ul className="space-y-1">
                    {(commitDetail?.files || []).map((f) => {
                      const style =
                        KIND_STYLE[f.change_kind || "modified"] ||
                        KIND_STYLE.modified;
                      return (
                        <li
                          key={f.path}
                          className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/40"
                        >
                          {style.badge ? (
                            <span
                              className={cn(
                                "shrink-0 rounded border px-1 py-px font-mono text-[10px] font-semibold",
                                style.badgeCls,
                              )}
                            >
                              {style.badge}
                            </span>
                          ) : null}
                          <span className={cn("truncate font-mono text-xs", style.text)}>
                            {f.path?.replace(/^flows\//, "")}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Production commit caution */}
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
              {prodName}
            </span>
            . This commits directly to production. Double-check the selected
            flows before continuing.
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
              className="bg-amber-500 text-amber-950 hover:bg-amber-400 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
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

      {/* Rollback danger confirm */}
      <ConfirmationModal
        open={Boolean(rollbackPrompt)}
        onClose={() => setRollbackPrompt(null)}
        onCancel={() => setRollbackPrompt(null)}
        title={rollbackPrompt?.title || "Rollback"}
        titleHeader="This cannot be undone"
        icon="RotateCcw"
        destructive
        size="x-small"
        cancelText="Cancel"
        confirmationText="Rollback"
        onConfirm={confirmRollback}
        loading={discardMut.isPending}
      >
        <ConfirmationModal.Content>
          <p className="text-sm text-muted-foreground">
            {rollbackPrompt?.body}
          </p>
        </ConfirmationModal.Content>
      </ConfirmationModal>

      <CreateBranchDialog
        open={branchOpen}
        onOpenChange={setBranchOpen}
        newBranch={newBranch}
        onNewBranchChange={setNewBranch}
        fromBranch={fromBranch}
        onFromBranchChange={setFromBranch}
        branchOptions={branchNames}
        busy={busy}
        onSubmit={createBranch}
      />
    </div>
  );
}
