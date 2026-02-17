import { Skeleton } from "@/components/ui/skeleton";

export interface DetailSkeletonSection {
  titleWidth?: string;
  rows: string[];
}

export interface DetailSkeletonProps {
  sections: DetailSkeletonSection[];
  headerActions?: number;
  headerBadge?: boolean;
  headerBanner?: boolean;
  name?: string;
}

export function DetailSkeleton({
  sections,
  headerActions = 0,
  headerBadge = false,
  headerBanner = false,
  name,
}: DetailSkeletonProps) {
  return (
    <div
      data-component={name}
      className="bg-white rounded-[28px] shadow-v3 h-full min-h-0 overflow-y-auto"
    >
      {/* Header skeleton */}
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-2/3 bg-v3-dim-white" />
            <div className="flex items-center gap-4">
              <Skeleton className="h-3 w-24 bg-v3-dim-white" />
              <Skeleton className="h-3 w-24 bg-v3-dim-white" />
            </div>
          </div>
          {headerBadge && (
            <Skeleton className="h-5 w-16 rounded-full bg-v3-dim-white shrink-0" />
          )}
          {headerActions > 0 && (
            <div className="flex gap-2 shrink-0">
              {Array.from({ length: headerActions }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-14 rounded-[10px] bg-v3-dim-white" />
              ))}
            </div>
          )}
        </div>
        {headerBanner && (
          <Skeleton className="h-10 w-full rounded-[14px] bg-v3-dim-white" />
        )}
      </div>

      {/* Content skeleton */}
      <div className="p-6 pt-0 space-y-5">
        {sections.map((section, idx) => (
          <div key={idx} className="bg-v3-dim-white rounded-[18px] p-4 space-y-3">
            {section.titleWidth && (
              <Skeleton className={`h-3 ${section.titleWidth} bg-white/70`} />
            )}
            <div className="space-y-2">
              {section.rows.map((width, rowIdx) => (
                <Skeleton key={rowIdx} className={`h-4 ${width} bg-white/70`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
