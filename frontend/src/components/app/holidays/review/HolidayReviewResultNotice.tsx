"use client";

import { Button } from "@/components/ui/button";

import type { ReviewResolveSummary } from "./useHolidayReviewResolve";

const SOURCE_COMPONENT = "HolidayReviewResultNotice";

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
      className="grid gap-1.5 rounded-xl bg-v3-dim-white px-3.5 py-3 text-sm text-v3-text"
    >
      <div data-component={`${dataComponent}_header`} className="flex items-start justify-between gap-2">
        <div className="grid gap-0.5">
          {title ? <p className="text-xs font-semibold text-v3-text-muted">{title}</p> : null}
          {fixed > 0 ? <p className="font-semibold text-v3-dark">{`${fixed}명 수정했어요`}</p> : null}
          {kept > 0 ? <p className="font-semibold text-v3-dark">{`${kept}명은 그대로 두었어요`}</p> : null}
          {nothingDone ? <p className="font-semibold text-v3-dark">처리할 고객이 없었어요</p> : null}
        </div>
        {onDismiss ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-component={`${dataComponent}_dismiss-trigger`}
            onClick={onDismiss}
          >
            닫기
          </Button>
        ) : null}
      </div>
      {skipped.length > 0 ? (
        <div data-component={`${dataComponent}_skipped`} data-slot="holiday-review-skipped" className="grid gap-1">
          <p className="font-semibold text-v3-burgundy">
            {`${skipped.length}명은 ${action === "keep" ? "처리하지" : "수정하지"} 못했어요`}
          </p>
          <ul className="grid gap-0.5 text-xs">
            {skipped.map((skip) => (
              <li key={skip.itemId} data-slot="holiday-review-skipped-row">
                <b>{skip.name ?? "알 수 없는 고객"}</b>
                {` · ${skip.reason}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
