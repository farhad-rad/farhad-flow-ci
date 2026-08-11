import { cn } from "@/utils/utils";

export type GraphCommit = {
  sha: string;
  short_sha: string;
  summary: string;
  author?: string | null;
  authored_date?: string | null;
  parents?: string[];
  refs?: string[];
};

type LaidOut = GraphCommit & { column: number; color: string };

/**
 * Classic streaming swimlane layout (newest → oldest), same family as
 * VS Code Git Graph / git log --graph:
 * - lanes[] holds the next expected parent SHA per column
 * - first parent continues the commit's lane
 * - 2nd+ parents (merge) fork to new lanes on the right
 * - multiple lanes waiting for the same SHA converge at that commit
 *
 * Previous impl wrongly inherited the merge commit's column onto *all*
 * parents, flattening branches onto one blue line.
 */
function layoutCommits(commits: GraphCommit[]): LaidOut[] {
  type Lane = { hash: string; color: string };
  const lanes: (Lane | null)[] = [];
  let colorIndex = 0;
  const nextColor = () => {
    const c = COLORS[colorIndex % COLORS.length]!;
    colorIndex += 1;
    return c;
  };
  const firstFree = () => {
    const i = lanes.findIndex((l) => l == null);
    return i === -1 ? lanes.length : i;
  };

  const columnBySha = new Map<string, number>();
  const colorBySha = new Map<string, string>();

  for (const commit of commits) {
    const { sha } = commit;
    const parents = commit.parents || [];

    let col = lanes.findIndex((l) => l?.hash === sha);
    let color: string;
    if (col === -1) {
      // New tip (or unparented tip in the window). Pin first row / HEAD to lane 0.
      const preferZero =
        lanes[0] == null &&
        (columnBySha.size === 0 ||
          (commit.refs || []).some(
            (r) => r === "HEAD" || r.startsWith("HEAD"),
          ));
      col = preferZero ? 0 : firstFree();
      color = nextColor();
      while (lanes.length <= col) lanes.push(null);
    } else {
      color = lanes[col]!.color;
    }

    // Every lane targeting this commit converges here.
    for (let k = 0; k < lanes.length; k++) {
      if (lanes[k]?.hash === sha) lanes[k] = null;
    }

    columnBySha.set(sha, col);
    colorBySha.set(sha, color);

    if (parents.length === 0) {
      lanes[col] = null;
    } else {
      // First parent continues this lane (straight spine).
      lanes[col] = { hash: parents[0]!, color };

      // Merge parents fork to the right.
      for (let pi = 1; pi < parents.length; pi++) {
        const parent = parents[pi]!;
        let pc = lanes.findIndex((l) => l?.hash === parent);
        if (pc === -1) {
          pc = firstFree();
          while (lanes.length <= pc) lanes.push(null);
          lanes[pc] = { hash: parent, color: nextColor() };
        }
      }
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] == null) {
      lanes.pop();
    }
  }

  return commits.map((c) => ({
    ...c,
    column: columnBySha.get(c.sha) ?? 0,
    color: colorBySha.get(c.sha) ?? COLORS[0]!,
  }));
}

const COL_W = 16;
const ROW_H = 30;
const DOT = 4.5;
const PAD_X = 10;

/** VS Code Git Graph–ish palette. */
const COLORS = [
  "#3794ff",
  "#c586c0",
  "#4ec9b0",
  "#dcdcaa",
  "#ce9178",
  "#9cdcfe",
  "#f44747",
  "#b5cea8",
];

function colorForRef(ref: string, fallbackCol: number): string {
  if (ref === "HEAD" || ref.startsWith("HEAD")) return COLORS[0]!;
  let h = 0;
  for (let i = 0; i < ref.length; i++) h = (h * 31 + ref.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % COLORS.length;
  return COLORS[idx] || COLORS[fallbackCol % COLORS.length]!;
}

function prettyRef(ref: string): { label: string; remote: boolean } {
  if (ref.startsWith("origin/")) {
    return { label: ref.slice("origin/".length), remote: true };
  }
  const slash = ref.indexOf("/");
  if (slash > 0 && !ref.includes("HEAD")) {
    const maybeRemote = ref.slice(0, slash);
    if (maybeRemote !== "refs" && !ref.startsWith("refs/")) {
      return { label: ref.slice(slash + 1), remote: true };
    }
  }
  return { label: ref, remote: false };
}

export function GitGraphView({
  commits,
  fill = false,
  selectedSha,
  onSelect,
}: {
  commits: GraphCommit[];
  fill?: boolean;
  selectedSha?: string | null;
  onSelect?: (commit: GraphCommit) => void;
}): JSX.Element {
  if (!commits.length) {
    return (
      <p className="p-3 text-sm text-muted-foreground">No commits yet</p>
    );
  }

  const laid = layoutCommits(commits);
  const maxCol = Math.max(...laid.map((c) => c.column), 0);
  const railW = (maxCol + 1) * COL_W + PAD_X * 2;
  const height = laid.length * ROW_H;
  const indexBySha = new Map(laid.map((c, i) => [c.sha, i]));

  return (
    <div
      className={cn(
        "font-sans",
        fill ? "h-full overflow-auto" : "max-h-72 overflow-auto",
      )}
      data-testid="git-graph-view"
    >
      <div className="relative" style={{ minHeight: height }}>
        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={railW}
          height={height}
          aria-hidden
        >
          {laid.map((c, i) => {
            const x = PAD_X + c.column * COL_W;
            const y = i * ROW_H + ROW_H / 2;
            const edges = (c.parents || [])
              .map((p, parentIdx) => {
                const pi = indexBySha.get(p);
                if (pi === undefined) return null;
                const parent = laid[pi]!;
                const px = PAD_X + parent.column * COL_W;
                const py = pi * ROW_H + ROW_H / 2;
                // First-parent edge keeps child color; merge edge uses the
                // parent (branch) color so the fork reads as a second line.
                const stroke =
                  parentIdx === 0 ? c.color : parent.color || c.color;
                return { px, py, stroke, straight: parent.column === c.column };
              })
              .filter(Boolean) as Array<{
              px: number;
              py: number;
              stroke: string;
              straight: boolean;
            }>;

            return (
              <g key={c.sha}>
                {edges.map((e, ei) =>
                  e.straight ? (
                    <line
                      key={ei}
                      x1={x}
                      y1={y}
                      x2={e.px}
                      y2={e.py}
                      stroke={e.stroke}
                      strokeWidth={2}
                      opacity={0.95}
                    />
                  ) : (
                    <path
                      key={ei}
                      d={`M ${x} ${y} C ${x} ${(y + e.py) / 2}, ${e.px} ${(y + e.py) / 2}, ${e.px} ${e.py}`}
                      fill="none"
                      stroke={e.stroke}
                      strokeWidth={2}
                      opacity={0.95}
                    />
                  ),
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={DOT}
                  fill={c.color}
                  stroke="hsl(var(--background))"
                  strokeWidth={1.5}
                />
              </g>
            );
          })}
        </svg>

        <ul className="relative" style={{ paddingLeft: railW + 4 }}>
          {laid.map((c) => {
            const selected = selectedSha === c.sha;
            const isMerge =
              (c.parents?.length ?? 0) > 1 ||
              /^merge\b/i.test(c.summary || "");
            const refs = (c.refs || []).slice(0, 5);
            const title = [
              c.summary,
              c.author,
              c.authored_date?.slice(0, 19).replace("T", " "),
              c.short_sha,
            ]
              .filter(Boolean)
              .join(" · ");

            const inner = (
              <div className="flex min-w-0 items-center gap-1.5">
                {refs.map((r) => {
                  const { label, remote } = prettyRef(r);
                  const bg = colorForRef(r, c.column);
                  return (
                    <span
                      key={r}
                      className="inline-flex max-w-[7.5rem] shrink-0 items-center gap-0.5 truncate rounded px-1 py-px text-[10px] font-medium leading-tight text-white"
                      style={{ backgroundColor: bg }}
                      title={r}
                    >
                      <svg
                        viewBox="0 0 16 16"
                        className="h-2.5 w-2.5 shrink-0 opacity-90"
                        fill="currentColor"
                        aria-hidden
                      >
                        <path d="M5 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9.5 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm4 6.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM3.75 5.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5a.75.75 0 0 1 .75-.75Zm6.5.75a.75.75 0 0 0-1.5 0v1.378A3.74 3.74 0 0 0 6.25 11v.5a.75.75 0 0 0 1.5 0V11A2.25 2.25 0 0 1 10 8.75V6.25Z" />
                      </svg>
                      <span className="truncate">{label}</span>
                      {remote ? (
                        <span className="shrink-0 opacity-80">·origin</span>
                      ) : null}
                    </span>
                  );
                })}
                <span
                  className={cn(
                    "min-w-0 truncate text-[12px] leading-tight",
                    isMerge ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {c.summary}
                </span>
              </div>
            );

            return (
              <li
                key={c.sha}
                className="border-b border-border/30"
                style={{ height: ROW_H }}
                title={title}
              >
                {onSelect ? (
                  <button
                    type="button"
                    className={cn(
                      "flex h-full w-full items-center px-1 text-left transition-colors hover:bg-muted/50",
                      selected && "bg-primary/15",
                    )}
                    onClick={() => onSelect(c)}
                  >
                    {inner}
                  </button>
                ) : (
                  <div className="flex h-full w-full items-center px-1">
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default GitGraphView;
