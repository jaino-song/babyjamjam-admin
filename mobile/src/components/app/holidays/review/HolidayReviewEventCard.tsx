"use client";

import { StatusBadge } from "@/components/app/ui/status-badge";
import { InfoCard } from "@/components/app/v3";
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
    >
      <InfoCard data-component={`${dataComponent}_card`} title={describeReviewEvent(event)}>
        <div className="grid gap-3">
          <div data-component={`${dataComponent}_card_main`} className="grid gap-1.5">
            <p className="flex flex-wrap items-center gap-2">
              <StatusBadge data-component={`${dataComponent}_card_main_source`} variant="neutral">
                {reviewSourceLabel(event)}
              </StatusBadge>
              <span className="text-xs text-v3-text-muted">{formatLastSynced(event.createdAt)}</span>
            </p>
            <p data-slot="holiday-review-meta" className="text-xs text-v3-text-muted">
              <span>{`${event.safeOpen}명 바로 수정 가능`}</span>
              {" · "}
              <span>{`${event.riskOpen}명 직접 확인 필요`}</span>
            </p>
          </div>
          <div data-component={`${dataComponent}_card_actions`} className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-component={`${dataComponent}_card_actions_list-trigger`}
              disabled={disabled}
              onClick={onOpenList}
            >
              목록 보기
            </Button>
            <Button
              type="button"
              size="sm"
              data-component={`${dataComponent}_card_actions_fix-safe-trigger`}
              disabled={disabled || event.safeOpen === 0}
              aria-busy={fixing || undefined}
              onClick={onFixSafe}
            >
              {fixing ? "수정 중..." : `${event.safeOpen}명 한 번에 수정`}
            </Button>
          </div>
        </div>
      </InfoCard>
    </div>
  );
}
