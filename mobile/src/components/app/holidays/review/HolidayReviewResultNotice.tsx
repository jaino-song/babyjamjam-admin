"use client";

import { InfoCard } from "@/components/app/v3";
import { Button } from "@/components/ui/button";

import type { ReviewResolveSummary } from "./useHolidayReviewResolve";

const SOURCE_COMPONENT = "HolidayReviewResultNotice";
const DEFAULT_TITLE = "처리 결과";

interface HolidayReviewResultNoticeProps {
  summary: ReviewResolveSummary;
  /** Shown above the result lines (e.g. which change was processed). */
  title?: string;
  onDismiss?: () => void;
  dataComponent: string;
}

/** What a resolve did: how many were changed and, visibly, who was skipped and why. */
export function HolidayReviewResultNotice({
  summary,
  title,
  onDismiss,
  dataComponent,
}: HolidayReviewResultNoticeProps) {
  const { action, fixed, kept, skipped } = summary;
  const nothingDone = fixed === 0 && kept === 0 && skipped.length === 0;

  return (
    <div
      role="status"
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      data-slot="holiday-review-result"
    >
      <InfoCard data-component={`${dataComponent}_card`} title={title ?? DEFAULT_TITLE}>
        <div className="grid gap-2 text-sm text-v3-text">
          <div data-component={`${dataComponent}_card_summary`} className="grid gap-0.5">
            {fixed > 0 ? <p className="font-semibold text-v3-dark">{`${fixed}명 수정했어요`}</p> : null}
            {kept > 0 ? <p className="font-semibold text-v3-dark">{`${kept}명은 그대로 두었어요`}</p> : null}
            {nothingDone ? <p className="font-semibold text-v3-dark">처리할 고객이 없었어요</p> : null}
          </div>
          {skipped.length > 0 ? (
            <div
              data-component={`${dataComponent}_card_skipped`}
              data-slot="holiday-review-skipped"
              className="grid gap-1"
            >
              <p className="font-semibold text-v3-burgundy">
                {`${skipped.length}명은 ${action === "keep" ? "처리하지" : "수정하지"} 못했어요`}
              </p>
              <ul className="grid gap-0.5 text-xs">
                {skipped.map((skip) => (
                  <li key={skip.itemId} data-slot="holiday-review-skipped-row" className="break-words">
                    <b>{skip.name ?? "알 수 없는 고객"}</b>
                    {` · ${skip.reason}`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {onDismiss ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-component={`${dataComponent}_card_dismiss-trigger`}
              onClick={onDismiss}
            >
              닫기
            </Button>
          ) : null}
        </div>
      </InfoCard>
    </div>
  );
}
