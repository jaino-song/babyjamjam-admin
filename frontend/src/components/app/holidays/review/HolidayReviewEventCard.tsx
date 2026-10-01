"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { HolidayReviewEvent } from "@/services/holiday-review";

import { formatLastSynced } from "../holiday-format";
import { describeReviewEvent, reviewSourceLabel } from "./review-format";

const SOURCE_COMPONENT = "HolidayReviewEventCard";

interface HolidayReviewEventCardProps {
  event: HolidayReviewEvent;
  /** True while this event's bulk fix is running. */
  fixing: boolean;
  /** True while any resolve is running (every action is blocked). */
  disabled: boolean;
  onOpenList: () => void;
  onFixSafe: () => void;
  dataComponent: string;
}

export function HolidayReviewEventCard({
  event,
  fixing,
  disabled,
  onOpenList,
  onFixSafe,
  dataComponent,
}: HolidayReviewEventCardProps) {
  return (
    <div
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      data-slot="holiday-review-card"
      className="grid grid-cols-1 items-center gap-2.5 rounded-xl bg-white px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div data-component={`${dataComponent}_main`} className="grid min-w-0 gap-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-v3-dark">
          <span data-slot="holiday-review-name">{describeReviewEvent(event)}</span>
          <Badge variant="secondary">{reviewSourceLabel(event)}</Badge>
          <span className="text-xs font-normal text-v3-text-muted">{formatLastSynced(event.createdAt)}</span>
        </p>
        <p data-slot="holiday-review-meta" className="text-xs text-v3-text-muted">
          <span>{`${event.safeOpen}명 바로 수정 가능`}</span>
          {" · "}
          <span>{`${event.riskOpen}명 직접 확인 필요`}</span>
        </p>
      </div>
      <div data-component={`${dataComponent}_actions`} className="flex flex-wrap gap-1.5 sm:justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-component={`${dataComponent}_list-trigger`}
          disabled={disabled}
          onClick={onOpenList}
        >
          목록 보기
        </Button>
        <Button
          type="button"
          variant="positive"
          size="sm"
          data-component={`${dataComponent}_fix-safe-trigger`}
          disabled={disabled || event.safeOpen === 0}
          aria-busy={fixing || undefined}
          onClick={onFixSafe}
        >
          {fixing ? "수정 중..." : `${event.safeOpen}명 한 번에 수정`}
        </Button>
      </div>
    </div>
  );
}
