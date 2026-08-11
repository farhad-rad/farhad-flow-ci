import { cn } from "@/utils/utils";

/** Colored unified-diff viewer (JSON-friendly line wrap). */
export function GitDiffView({
  diff,
  emptyLabel = "No changes",
}: {
  diff?: string | null;
  emptyLabel?: string;
}): JSX.Element {
  const text = (diff || "").trimEnd();
  if (!text) {
    return (
      <p className="p-3 text-sm text-muted-foreground">{emptyLabel}</p>
    );
  }

  const lines = text.split("\n");
  return (
    <div
      className="max-h-full overflow-auto font-mono text-[11px] leading-5"
      data-testid="git-diff-view"
    >
      {lines.map((line, i) => {
        const kind =
          line.startsWith("+++") || line.startsWith("---")
            ? "file"
            : line.startsWith("@@")
              ? "hunk"
              : line.startsWith("+")
                ? "add"
                : line.startsWith("-")
                  ? "del"
                  : line.startsWith("diff ")
                    ? "meta"
                    : "ctx";
        return (
          <div
            key={`${i}-${line.slice(0, 24)}`}
            className={cn(
              "whitespace-pre-wrap break-all px-3",
              kind === "add" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              kind === "del" && "bg-red-500/10 text-red-700 dark:text-red-300",
              kind === "hunk" && "bg-sky-500/10 text-sky-700 dark:text-sky-300",
              kind === "file" && "text-muted-foreground",
              kind === "meta" && "text-muted-foreground",
            )}
          >
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}

export default GitDiffView;
