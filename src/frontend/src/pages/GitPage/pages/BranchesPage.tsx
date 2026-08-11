import { useMemo, useState } from "react";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useDeleteGitBranch,
  useGetGitBranches,
  useGetGitHealth,
  useGetGitProductionBranch,
  useGetGitStatus,
  usePostGitCheckout,
  usePostGitCreateBranch,
  usePostGitSyncBranches,
} from "@/controllers/API/queries/git";
import { CreateBranchDialog } from "@/features/git/CreateBranchDialog";
import { GitConfirmDialog } from "@/features/git/GitConfirmDialog";
import { extractGitError } from "@/features/git/gitError";
import {
  mergeGitBranches,
  type RawGitBranch,
} from "@/features/git/mergeBranches";
import {
  GitBusyBanner,
  GitLoadingPanel,
} from "@/features/git/GitLoadingPanel";
import useAlertStore from "@/stores/alertStore";
import { cn } from "@/utils/utils";

function AheadBehind({
  ahead,
  behind,
  localOnly,
}: {
  ahead: number | null;
  behind: number | null;
  localOnly: boolean;
}): JSX.Element {
  if (localOnly || ahead == null || behind == null) {
    return (
      <span className="min-w-[3.5rem] text-center font-mono text-xs text-muted-foreground">
        —
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-[3.5rem] items-center justify-center gap-1 font-mono text-xs tabular-nums">
      <span
        className={
          ahead > 0
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-muted-foreground"
        }
      >
        {ahead}
      </span>
      <span className="text-muted-foreground">|</span>
      <span
        className={
          behind > 0
            ? "text-red-600 dark:text-red-400"
            : "text-muted-foreground"
        }
      >
        {behind}
      </span>
    </span>
  );
}

export default function GitBranchesPage(): JSX.Element {
  const { data: health, isLoading: healthLoading } = useGetGitHealth();
  const ready = Boolean(health?.setup_complete ?? health?.repo_is_git);
  const {
    data: branchesData,
    refetch,
    isLoading: branchesLoading,
    isFetching: branchesFetching,
  } = useGetGitBranches({ enabled: ready });
  const { data: status } = useGetGitStatus({ enabled: ready });
  const { data: prod } = useGetGitProductionBranch({ enabled: ready });
  const createMut = usePostGitCreateBranch();
  const checkoutMut = usePostGitCheckout();
  const deleteMut = useDeleteGitBranch();
  const syncMut = usePostGitSyncBranches();
  const setSuccessData = useAlertStore((s) => s.setSuccessData);
  const setErrorData = useAlertStore((s) => s.setErrorData);

  const [query, setQuery] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [fromBranch, setFromBranch] = useState("");
  const [syncOpen, setSyncOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const prodName = prod?.name || health?.production_branch || "";
  const currentBranch = status?.branch || null;

  const merged = useMemo(
    () =>
      mergeGitBranches(
        (branchesData?.branches as RawGitBranch[]) ?? [],
        currentBranch,
        prodName,
      ),
    [branchesData?.branches, currentBranch, prodName],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter((b) => b.name.toLowerCase().includes(q));
  }, [merged, query]);

  const branchOptions = useMemo(() => {
    const names = merged.map((b) => b.name);
    if (currentBranch && !names.includes(currentBranch)) {
      names.unshift(currentBranch);
    }
    return names;
  }, [merged, currentBranch]);

  const busy =
    createMut.isPending ||
    checkoutMut.isPending ||
    deleteMut.isPending ||
    syncMut.isPending;

  const busyLabel = syncMut.isPending
    ? "Syncing branches…"
    : createMut.isPending
      ? "Creating branch…"
      : checkoutMut.isPending
        ? "Checking out…"
        : deleteMut.isPending
          ? "Deleting branch…"
          : "Working…";

  const run = async (title: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      setSuccessData({ title });
      await refetch();
    } catch (err) {
      setErrorData(extractGitError(err));
    }
  };

  const openCreate = () => {
    setFromBranch(currentBranch || prodName || branchOptions[0] || "");
    setNewBranch("");
    setBranchOpen(true);
  };

  const createBranch = () => {
    const name = newBranch.trim();
    if (!name) return;
    void run(`Branch ${name}`, async () => {
      await createMut.mutateAsync({
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
      <p className="text-sm text-muted-foreground">Connect a flows repo first.</p>
    );
  }

  const listLoading = branchesLoading && !branchesData;

  return (
    <div className="flex flex-col gap-4" data-testid="git-branches-page">
      {busy && <GitBusyBanner label={busyLabel} />}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <ForwardedIconComponent
            name="Search"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="h-9 pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search branches…"
            disabled={listLoading || busy}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || listLoading}
          loading={syncMut.isPending}
          onClick={() => setSyncOpen(true)}
        >
          <ForwardedIconComponent name="RefreshCw" className="mr-1.5 h-3.5 w-3.5" />
          Sync with remote
        </Button>
        <Button size="sm" disabled={busy || listLoading} onClick={openCreate}>
          <ForwardedIconComponent name="Plus" className="mr-1.5 h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      {listLoading ? (
        <div className="rounded-md border">
          <GitLoadingPanel label="Loading branches…" compact />
        </div>
      ) : (
        <ul
          className={cn(
            "divide-y rounded-md border",
            (busy || branchesFetching) && "opacity-70",
          )}
        >
          {filtered.map((b) => (
            <li
              key={b.name}
              className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
            >
              <span
                className={cn(
                  "font-mono",
                  b.current && "font-semibold text-primary",
                )}
              >
                {b.name}
              </span>
              {b.current && (
                <span className="rounded bg-muted px-1.5 text-xs">current</span>
              )}
              {b.is_production && (
                <span className="rounded bg-amber-500/15 px-1.5 text-xs text-amber-700 dark:text-amber-300">
                  production
                </span>
              )}
              {b.local_only && (
                <span className="rounded bg-sky-500/15 px-1.5 text-xs text-sky-700 dark:text-sky-300">
                  Local Only
                </span>
              )}
              <div className="ml-auto flex items-center gap-3">
                <AheadBehind
                  ahead={b.ahead}
                  behind={b.behind}
                  localOnly={b.local_only || !b.has_local}
                />
                <Button
                  size="xs"
                  variant="outline"
                  disabled={b.current || busy}
                  onClick={() =>
                    void run(`Checked out ${b.name}`, () =>
                      checkoutMut.mutateAsync({ name: b.name }),
                    )
                  }
                >
                  Checkout
                </Button>
                {b.has_local && !b.current ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={b.is_production || busy}
                    onClick={() => setDeleteTarget(b.name)}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-3 py-4 text-sm text-muted-foreground">
              No branches
            </li>
          )}
        </ul>
      )}

      <CreateBranchDialog
        open={branchOpen}
        onOpenChange={setBranchOpen}
        newBranch={newBranch}
        onNewBranchChange={setNewBranch}
        fromBranch={fromBranch}
        onFromBranchChange={setFromBranch}
        branchOptions={branchOptions}
        busy={busy}
        onSubmit={createBranch}
      />

      <GitConfirmDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        tone="danger"
        title="Sync with remote"
        description="Deletes every local branch except the current one, then fetches from origin. This cannot be undone."
        confirmLabel="Sync & wipe locals"
        busy={busy}
        onConfirm={() => {
          setSyncOpen(false);
          void run("Synced branches from remote", () =>
            syncMut.mutateAsync({}),
          );
        }}
      />

      <GitConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        tone="danger"
        title="Delete local branch"
        description={`Delete local branch ${deleteTarget}? Remote is not touched.`}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => {
          const name = deleteTarget;
          setDeleteTarget(null);
          if (!name) return;
          void run(`Deleted ${name}`, () =>
            deleteMut.mutateAsync({ name, force: true }),
          );
        }}
      />
    </div>
  );
}
