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
      className="h-full min-h-0 overflow-y-auto rounded-[28px] bg-white shadow-v3"
    >
      {/* Header skeleton */}
      <div className="space-y-[calc(16px*var(--glint-ui-scale,1))] p-[calc(24px*var(--glint-ui-scale,1))]">
        <div className="flex items-start justify-between gap-[calc(16px*var(--glint-ui-scale,1))]">
          <div className="flex-1 space-y-[calc(8px*var(--glint-ui-scale,1))]">
            <Skeleton className="h-[calc(24px*var(--glint-ui-scale,1))] w-2/3 bg-v3-dim-white" />
            <div className="flex items-center gap-[calc(16px*var(--glint-ui-scale,1))]">
              <Skeleton className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(96px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
              <Skeleton className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(96px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
            </div>
          </div>
          {headerBadge && (
            <Skeleton className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(64px*var(--glint-ui-scale,1))] shrink-0 rounded-full bg-v3-dim-white" />
          )}
          {headerActions > 0 && (
            <div className="flex shrink-0 gap-[calc(8px*var(--glint-ui-scale,1))]">
              {Array.from({ length: headerActions }).map((_, i) => (
                <Skeleton key={i} className="h-[calc(32px*var(--glint-ui-scale,1))] w-[calc(56px*var(--glint-ui-scale,1))] rounded-[10px] bg-v3-dim-white" />
              ))}
            </div>
          )}
        </div>
        {headerBanner && (
          <Skeleton className="h-[calc(40px*var(--glint-ui-scale,1))] w-full rounded-[14px] bg-v3-dim-white" />
        )}
      </div>

      {/* Content skeleton */}
      <div className="space-y-[calc(20px*var(--glint-ui-scale,1))] p-[calc(24px*var(--glint-ui-scale,1))] pt-0">
        {sections.map((section, idx) => (
          <div key={idx} className="space-y-[calc(12px*var(--glint-ui-scale,1))] rounded-[18px] bg-v3-dim-white p-[calc(16px*var(--glint-ui-scale,1))]">
            {section.titleWidth && (
              <Skeleton className={`h-[calc(12px*var(--glint-ui-scale,1))] ${section.titleWidth} bg-white/70`} />
            )}
            <div className="space-y-[calc(8px*var(--glint-ui-scale,1))]">
              {section.rows.map((width, rowIdx) => (
                <Skeleton key={rowIdx} className={`h-[calc(16px*var(--glint-ui-scale,1))] ${width} bg-white/70`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
