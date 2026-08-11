import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Loading from "@/components/ui/loading";
import {
  useGetGitHealth,
  useGetGitMergeRequests,
} from "@/controllers/API/queries/git";
import { extractGitError } from "@/features/git/gitError";
import { GitLoadingPanel } from "@/features/git/GitLoadingPanel";
import { NewMergeRequestWizard } from "@/features/git/NewMergeRequestWizard";
import { cn } from "@/utils/utils";

type MrFilter = "opened" | "merged" | "closed" | "all";

const FILTERS: { value: MrFilter; label: string }[] = [
  { value: "opened", label: "Opened" },
  { value: "merged", label: "Merged" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

export default function GitMergeRequestsPage(): JSX.Element {
  const { data: health, isLoading: healthLoading } = useGetGitHealth();
  const ready = Boolean(health?.setup_complete ?? health?.repo_is_git);
  const [state, setState] = useState<MrFilter>("opened");
  const [query, setQuery] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const { data, isError, error, isLoading, isFetching } = useGetGitMergeRequests(
    { state },
    { enabled: ready },
  );

  const items = useMemo(() => {
    const all = data?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((mr) => {
      const hay = [
        mr.title,
        String(mr.iid),
        mr.source_branch,
        mr.target_branch,
        mr.state,
        mr.author?.name,
        mr.author?.username,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data?.items, query]);

  if (healthLoading && !health) {
    return <GitLoadingPanel label="Checking git connection…" />;
  }

  if (!ready) {
    return (
      <p className="text-sm text-muted-foreground">Connect a flows repo first.</p>
    );
  }

  const listLoading = isLoading && !data;
  const listRefreshing = isFetching && Boolean(data);

  return (
    <div className="flex flex-col gap-4" data-testid="git-mrs-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <ForwardedIconComponent
            name="Search"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search merge requests…"
            className="h-11 pl-9 text-base"
            disabled={listLoading}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 rounded-lg border border-border p-0.5">
            {FILTERS.map((tab) => (
              <Button
                key={tab.value}
                unstyled
                disabled={listLoading}
                onClick={() => setState(tab.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  state === tab.value
                    ? "bg-muted text-foreground hover:bg-muted/80"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Button>
            ))}
          </div>
          {listRefreshing && (
            <Loading className="text-muted-foreground" size={16} />
          )}
          <Button onClick={() => setWizardOpen(true)} disabled={listLoading}>
            <ForwardedIconComponent name="GitPullRequest" className="mr-1.5 h-4 w-4" />
            New merge request
          </Button>
        </div>
      </div>

      {isError && (
        <p className="text-sm text-destructive">
          {extractGitError(error).list.join(" ") ||
            "Failed to load merge requests (need GitLab remote + PAT)."}
        </p>
      )}

      {listLoading ? (
        <div className="rounded-md border">
          <GitLoadingPanel label="Loading merge requests…" compact />
        </div>
      ) : (
        <ul
          className={cn(
            "divide-y rounded-md border",
            listRefreshing && "opacity-70",
          )}
        >
          {items.map((mr) => (
            <li key={mr.iid}>
              <Link
                to={`/git/merge-requests/${mr.iid}`}
                className="flex flex-col gap-0.5 px-3 py-3 transition-colors hover:bg-muted/40"
              >
                <span className="text-sm font-medium">
                  !{mr.iid} {mr.title}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {mr.source_branch} → {mr.target_branch} · {mr.state}
                  {mr.merge_status ? ` · ${mr.merge_status}` : ""}
                </span>
              </Link>
            </li>
          ))}
          {items.length === 0 && !isError && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              No merge requests
            </li>
          )}
        </ul>
      )}

      <NewMergeRequestWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}
