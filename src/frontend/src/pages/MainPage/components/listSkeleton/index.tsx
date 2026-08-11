import { Skeleton } from "@/components/ui/skeleton";

const ListSkeleton = () => {
  return (
    <div className="flow-glass-card relative flex min-h-[7.5rem] flex-col gap-3 overflow-hidden rounded-2xl border border-border/60 px-4 py-4 shadow-page-hero">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 page-hero-gradient opacity-40"
      />
      <div className="relative flex items-start gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-[55%]" />
          <Skeleton className="h-3 w-[90%]" />
          <Skeleton className="h-3 w-[35%]" />
        </div>
      </div>
    </div>
  );
};

export default ListSkeleton;
