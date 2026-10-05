"use client";

import { MobileTwoButtonModal } from "@/components/app/ui/MobileTwoButtonModal";

interface HolidayReviewConfirmDialogProps {
  open: boolean;
  /** "10/5 대체공휴일(개천절) 추가" */
  eventLabel: string;
  count: number;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  dataComponent: string;
}

/** Confirms the one-click bulk fix: it rewrites end dates for every open safe client of one change. */
export function HolidayReviewConfirmDialog({
  open,
  eventLabel,
  count,
  onConfirm,
  onOpenChange,
  dataComponent,
}: HolidayReviewConfirmDialogProps) {
  return (
    <MobileTwoButtonModal
      data-component={`${dataComponent}_confirm`}
      open={open}
      title={`${count}명의 종료일을 한 번에 수정할까요?`}
      description={`「${eventLabel}」 때문에 종료일이 달라지는 고객 중 바로 수정 가능한 ${count}명의 종료일을 새로 계산한 날짜로 바꿔요. 직접 확인이 필요한 고객은 바뀌지 않아요.`}
      cancelLabel="취소"
      confirmLabel={`${count}명 수정`}
      confirmVariant="default"
      actionOrder="cancel-confirm"
      onOpenChange={onOpenChange}
      onCancel={() => onOpenChange(false)}
      onConfirm={onConfirm}
    />
  );
}
