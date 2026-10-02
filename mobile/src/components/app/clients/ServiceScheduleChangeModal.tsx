"use client";

import { useState } from "react";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";
import { isRealIsoDate } from "@babyjamjam/shared/utils/field-validation-message";

import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { FieldLabelRow, fieldMessageId } from "@/components/app/ui/FieldLabelRow";
import { Input } from "@/components/ui/input";
import { useFieldMessages } from "@/hooks/use-field-messages";
import { useLocale } from "@/providers/LocaleProvider";
import {
    focusFirstInvalidField,
    pickSlotMessage,
    type FieldSpec,
    type SlotMessage,
} from "@/lib/validations/field-message";

const DATE_INPUT_ID = "service-schedule-change-date";
const UNCHANGED_MESSAGE = "현재 예정일과 다른 날짜를 입력해 주세요";
const DATE_GUIDANCE: SlotMessage = { text: "출산일 이후만 가능해요", tone: "muted" };

const DATE_SPEC: FieldSpec = { kind: "date", label: "서비스 제공 날짜", required: true };

interface ServiceScheduleChangeModalProps {
    "data-component": string;
    open: boolean;
    sessionIndex: number;
    currentDate: string;
    minimumDate: string | null;
    selectedDate: string;
    isPending: boolean;
    onDateChange: (date: string) => void;
    onClose: () => void;
    onSubmit: () => void;
}

export function ServiceScheduleChangeModal({
    "data-component": dataComponent,
    open,
    sessionIndex,
    currentDate,
    minimumDate,
    selectedDate,
    isPending,
    onDateChange,
    onClose,
    onSubmit,
}: ServiceScheduleChangeModalProps) {
    const locale = useLocale();
    const [edited, setEdited] = useState(false);
    const fieldMessages = useFieldMessages<"date">({
        values: { date: selectedDate },
        specs: { date: DATE_SPEC },
        locale,
    });

    const isRealDate = isRealIsoDate(selectedDate);
    const isBeforeMinimum = isRealDate && minimumDate !== null && selectedDate < minimumDate;
    const isValidChange = isRealDate && !isBeforeMinimum && selectedDate !== currentDate;

    // An unchanged prefilled date is only called out once the user has touched the field.
    const rangeMessage: SlotMessage | null = isBeforeMinimum
        ? { text: `${minimumDate} 이후로 입력해 주세요`, tone: "err" }
        : (edited || fieldMessages.submitted) && isRealDate && !isValidChange
            ? { text: UNCHANGED_MESSAGE, tone: "err" }
            : null;
    // Always-on guidance comes last: any error or format hint replaces it, and it returns once they clear.
    const slot = pickSlotMessage(fieldMessages.slot("date"), rangeMessage, DATE_GUIDANCE);
    const hasError = slot?.tone === "err";
    const dateBind = fieldMessages.bind("date");

    const handleApprove = () => {
        fieldMessages.markSubmitted();
        if (!isValidChange) {
            focusFirstInvalidField([DATE_INPUT_ID]);
            return;
        }
        onSubmit();
    };

    return (
        <ApprovalTwoButtonModal
            open={open}
            data-component={dataComponent}
            title="서비스 일정 변경"
            description={
                <>
                    <span>{sessionIndex}회차 서비스 제공 날짜를 조정합니다.</span>
                    <br />
                    <span>선택한 회차부터 이후 일정을 함께 옮깁니다.</span>
                </>
            }
            isDescriptionVisuallyHidden={false}
            size="detail"
            cancelLabel="취소"
            approvalLabel="일정 변경"
            pendingLabel="변경 중..."
            isPending={isPending}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && !isPending) onClose();
            }}
            onApprove={handleApprove}
        >
            <div className="space-y-2 pt-5" data-component={`${dataComponent}_date-field`}>
                <FieldLabelRow
                    data-component={`${dataComponent}_date-field`}
                    htmlFor={DATE_INPUT_ID}
                    label={`${sessionIndex}회차 서비스 제공 날짜`}
                    message={slot}
                />
                <Input
                    id={DATE_INPUT_ID}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={10}
                    placeholder="2026-12-01"
                    value={selectedDate}
                    disabled={isPending}
                    className="h-12 rounded-2xl bg-white px-4 text-base"
                    error={hasError}
                    aria-invalid={hasError ? true : undefined}
                    aria-describedby={fieldMessageId(DATE_INPUT_ID)}
                    onFocus={dateBind.onFocus}
                    onBlur={() => {
                        setEdited(true);
                        dateBind.onBlur();
                    }}
                    onChange={(event) => {
                        setEdited(true);
                        onDateChange(formatIsoDateInput(event.target.value));
                    }}
                />
            </div>
        </ApprovalTwoButtonModal>
    );
}
