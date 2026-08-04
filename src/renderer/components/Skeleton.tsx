export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} />;
}

/** Matches the GameCard footprint so the grid doesn't reflow when data loads. */
export function CardSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="aspect-[3/4] w-full rounded-lg" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}
