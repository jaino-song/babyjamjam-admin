"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { holidayReviewApi, holidayReviewKeys, type HolidayReviewEvent } from "@/services/holiday-review";
import { getUserErrorMessage } from "@babyjamjam/shared";

import { HolidayReviewConfirmDialog } from "./HolidayReviewConfirmDialog";
import { HolidayReviewEventCard } from "./HolidayReviewEventCard";
import { HolidayReviewListDialog } from "./HolidayReviewListDialog";
import { HolidayReviewResultNotice } from "./HolidayReviewResultNotice";
import { describeReviewEvent } from "./review-format";
import { useHolidayReviewResolve, type ReviewResolveSummary } from "./useHolidayReviewResolve";

const SOURCE_COMPONENT = "HolidayReviewCards";
const DATA_COMPONENT = "mobile_holidays_settings_review";

interface HolidayReviewCardsProps {
  branchId: string;
}

interface LastResult {
  title: string;
  summary: ReviewResolveSummary;
}

/**
 * Holiday changes (public data or this branch's own settings) that left some clients' stored end date
 * different from the recalculated one. The root is always rendered so the settings section keeps its slot.
 */
export function HolidayReviewCards({ branchId }: HolidayReviewCardsProps) {
  const { toast } = useToast();
  const [confirmEventId, setConfirmEventId] = useState<string | null>(null);
  // Snapshot taken when the list opens: the sheet (and its result notice) must outlive the refetch that
  // drops the event once its last open items are resolved, until the user closes it.
  const [openedEvent, setOpenedEvent] = useState<HolidayReviewEvent | null>(null);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);

  const eventsQuery = useQuery({
    queryKey: holidayReviewKeys.events(branchId),
    queryFn: () => holidayReviewApi.listEvents(branchId),
  });
  const resolve = useHolidayReviewResolve(branchId);

  const events = eventsQuery.data ?? [];
  const confirmEvent = events.find((event) => event.id === confirmEventId) ?? null;
  const liveOpenedEvent = openedEvent ? events.find((event) => event.id === openedEvent.id) : undefined;
  const listEvent = openedEvent ? (liveOpenedEvent ?? { ...openedEvent, safeOpen: 0, riskOpen: 0 }) : null;
  const fixingEventId = resolve.isPending ? (resolve.variables?.eventId ?? null) : null;

  function fixSafe(eventId: string, label: string) {
    setConfirmEventId(null);
    setLastResult(null);
    resolve.mutate(
      { eventId, action: "fix", selection: "all-safe" },
      {
        onSuccess: (summary) => setLastResult({ title: label, summary }),
        onError: (error) => toast({ variant: "destructive", description: getUserErrorMessage(error) }),
      },
    );
  }

  return (
    <div
      data-component={`${DATA_COMPONENT}-cards`}
      data-source-component={SOURCE_COMPONENT}
      data-slot="holiday-review-cards"
      className="grid gap-3"
    >
      {eventsQuery.isError && events.length === 0 ? (
        <div
          data-component={`${DATA_COMPONENT}_load-error`}
          className="grid gap-2 text-xs text-v3-text-muted"
        >
          <p>종료일 확인이 필요한 공휴일 변경을 불러오지 못했어요.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-component={`${DATA_COMPONENT}_load-error_retry-trigger`}
            onClick={() => void eventsQuery.refetch()}
          >
            다시 시도
          </Button>
        </div>
      ) : null}

      {events.length > 0 ? (
        <Alert
          variant="warning"
          role="status"
          hideIcon
          contentClassName="!pl-0"
          data-component={DATA_COMPONENT}
          data-source-component={SOURCE_COMPONENT}
          data-slot="holiday-review-panel"
        >
          <div className="grid gap-3">
            <p className="flex flex-wrap items-center gap-x-2 font-bold">
              공휴일 변경으로 종료일 확인이 필요해요
              <small className="font-medium text-v3-text">· 이 지점 고객만</small>
            </p>
            {events.map((event) => (
              <HolidayReviewEventCard
                key={event.id}
                event={event}
                fixing={fixingEventId === event.id}
                disabled={resolve.isPending}
                dataComponent={`${DATA_COMPONENT}_event`}
                onOpenList={() => setOpenedEvent(event)}
                onFixSafe={() => setConfirmEventId(event.id)}
              />
            ))}
            <p data-slot="holiday-review-help" className="text-xs leading-relaxed text-v3-text">
              <b>바로 수정 가능</b>: 바뀐 날짜 이후 서비스 기록이 없고 서비스 기록이 확정되지 않은 고객 ·{" "}
              <b>직접 확인 필요</b>: 바뀐 날짜에 이미 근무 기록이 있거나 서비스 기록이 확정된 고객
            </p>
          </div>
        </Alert>
      ) : null}

      {lastResult ? (
        <HolidayReviewResultNotice
          title={lastResult.title}
          summary={lastResult.summary}
          dataComponent={`${DATA_COMPONENT}_result`}
          onDismiss={() => setLastResult(null)}
        />
      ) : null}

      {confirmEvent ? (
        <HolidayReviewConfirmDialog
          open
          eventLabel={describeReviewEvent(confirmEvent)}
          count={confirmEvent.safeOpen}
          dataComponent={DATA_COMPONENT}
          onOpenChange={(open) => {
            if (!open) setConfirmEventId(null);
          }}
          onConfirm={() => fixSafe(confirmEvent.id, describeReviewEvent(confirmEvent))}
        />
      ) : null}

      {listEvent ? (
        <HolidayReviewListDialog
          branchId={branchId}
          event={listEvent}
          dataComponent={`${DATA_COMPONENT}_list-dialog`}
          onClose={() => setOpenedEvent(null)}
        />
      ) : null}
    </div>
  );
}
