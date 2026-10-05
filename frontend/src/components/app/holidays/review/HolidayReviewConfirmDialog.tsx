"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SOURCE_COMPONENT = "HolidayReviewConfirmDialog";

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-component={`${dataComponent}_confirm`}
        data-source-component={SOURCE_COMPONENT}
      >
        <DialogHeader>
          <DialogTitle>{`${count}명의 종료일을 한 번에 수정할까요?`}</DialogTitle>
          <DialogDescription>
            {`「${eventLabel}」 때문에 종료일이 달라지는 고객 중 바로 수정 가능한 ${count}명의 종료일을 새로 계산한 날짜로 바꿔요. 직접 확인이 필요한 고객은 바뀌지 않아요.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            variant="positive"
            data-component={`${dataComponent}_confirm_submit`}
            onClick={onConfirm}
          >
            {`${count}명 수정`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
