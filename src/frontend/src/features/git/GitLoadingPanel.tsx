import Loading from "@/components/ui/loading";
import { cn } from "@/utils/utils";

/** Centered spinner + label for git page / section loads. */
export function GitLoadingPanel({
  label = "Loading…",
  className,
  compact = false,
}: {
  label?: string;
  className?: string;
  compact?: boolean;
}): JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground",
        compact ? "py-6" : "min-h-[12rem] py-10",
        className,
      )}
      data-testid="git-loading-panel"
      role="status"
      aria-live="polite"
    >
      <Loading className="text-muted-foreground" size={compact ? 20 : 28} />
      <span>{label}</span>
    </div>
  );
}

/** Thin bar when mutations lock the page (checkout/sync/push…). */
export function GitBusyBanner({
  label = "Working…",
  className,
}: {
  label?: string;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground",
        className,
      )}
      data-testid="git-busy-banner"
      role="status"
      aria-live="polite"
    >
      <Loading className="shrink-0 text-primary" size={16} />
      <span>{label}</span>
    </div>
  );
}
