"use client";

import { useRef, useState } from "react";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";
import { isRealIsoDate } from "@babyjamjam/shared/utils/field-validation-message";

import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { FieldLabelRow, fieldMessageId } from "@/components/app/ui/FieldLabelRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import { CALENDAR_CHANGED_FOR_SAVE_MESSAGE } from "@/hooks/calendar-save-message";
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
const CALENDAR_LOADING: SlotMessage = { text: "공휴일 정보를 불러오는 중이에요", tone: "muted" };
const CALENDAR_FAILED: SlotMessage = { text: "공휴일 정보를 불러오지 못했어요", tone: "err" };
const CALENDAR_NO_BRANCH: SlotMessage = { text: "지점을 선택한 뒤 다시 시도해 주세요", tone: "err" };
const CALENDAR_UNSUPPORTED_YEAR: SlotMessage = { text: "이 날짜의 공휴일 정보가 아직 없어요", tone: "err" };

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
    /** `allowNonBusinessDay` is true once the admin confirmed a weekend or holiday date. */
    onSubmit: (allowNonBusinessDay: boolean) => void;
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
    const selectedYear = isRealIsoDate(selectedDate) ? [Number(selectedDate.slice(0, 4))] : [];
    const {
        calendar,
        ready: isCalendarReady,
        error: calendarError,
        retry: retryCalendar,
        refreshForSave,
    } = useBusinessDayCalendar({ extraYears: selectedYear });
    // Weekends and holidays are blocked by default; an admin may still pick one
    // for a special case after confirming it in a second step.
    const [isConfirmingNonBusinessDay, setIsConfirmingNonBusinessDay] = useState(false);
    const submissionInFlightRef = useRef(false);
    const [isRefreshingCalendar, setIsRefreshingCalendar] = useState(false);
    const [saveMessage, setSaveMessage] = useState<SlotMessage | null>(null);
    const fieldMessages = useFieldMessages<"date">({
        values: { date: selectedDate },
        specs: { date: DATE_SPEC },
        locale,
    });

    const isRealDate = isRealIsoDate(selectedDate);
    const isBeforeMinimum = isRealDate && minimumDate !== null && selectedDate < minimumDate;
    const isValidChange = isRealDate && !isBeforeMinimum && selectedDate !== currentDate;

    // Until the branch calendar is ready the built-in list does not know the branch's own
    // holidays, so the date is not classified at all. A year the calendar has no data for
    // makes `isBusinessDay` throw; that also blocks approval instead of crashing the modal.
    let isNonBusinessDay: boolean | null = null;
    let isUnsupportedYear = false;
    if (isRealDate && isCalendarReady) {
        try {
            isNonBusinessDay = !calendar.isBusinessDay(selectedDate);
        } catch {
            isUnsupportedYear = true;
        }
    }
    const isCalendarBlocking = !isCalendarReady || isUnsupportedYear;
    const isCalendarFailed = (!isCalendarReady && calendarError === "load-failed") || saveMessage === CALENDAR_FAILED;
    const calendarMessage: SlotMessage | null = isCalendarReady
        ? isUnsupportedYear
            ? CALENDAR_UNSUPPORTED_YEAR
            : null
        : calendarError === "no-branch"
          ? CALENDAR_NO_BRANCH
          : calendarError === "load-failed"
            ? CALENDAR_FAILED
            : CALENDAR_LOADING;

    // An unchanged prefilled date is only called out once the user has touched the field.
    const rangeMessage: SlotMessage | null = isBeforeMinimum
        ? { text: `${minimumDate} 이후로 입력해 주세요`, tone: "err" }
        : (edited || fieldMessages.submitted) && isRealDate && !isValidChange
            ? { text: UNCHANGED_MESSAGE, tone: "err" }
            : null;
    // Always-on guidance comes last: any error or format hint replaces it, and it returns once they clear.
    const slot = pickSlotMessage(fieldMessages.slot("date"), rangeMessage, calendarMessage, saveMessage, DATE_GUIDANCE);
    const hasError = slot?.tone === "err";
    const dateBind = fieldMessages.bind("date");

    const handleApprove = async (confirmedNonBusinessDay = false) => {
        fieldMessages.markSubmitted();
        if (!isValidChange) {
            focusFirstInvalidField([DATE_INPUT_ID]);
            return;
        }
        if (isCalendarBlocking || isNonBusinessDay === null) return;
        if (submissionInFlightRef.current || isPending) return;
        submissionInFlightRef.current = true;
        setIsRefreshingCalendar(true);
        try {
            const fresh = await refreshForSave();
            if (!fresh.ok) {
                setIsConfirmingNonBusinessDay(false);
                setSaveMessage(CALENDAR_FAILED);
                return;
            }
            let freshNonBusinessDay: boolean;
            try {
                freshNonBusinessDay = !fresh.calendar.isBusinessDay(selectedDate);
            } catch {
                setIsConfirmingNonBusinessDay(false);
                setSaveMessage(CALENDAR_UNSUPPORTED_YEAR);
                return;
            }
            if (fresh.changed || freshNonBusinessDay !== isNonBusinessDay) {
                setIsConfirmingNonBusinessDay(false);
                setSaveMessage({ text: CALENDAR_CHANGED_FOR_SAVE_MESSAGE, tone: "muted" });
                return;
            }
            setSaveMessage(null);
            if (freshNonBusinessDay && !confirmedNonBusinessDay) {
                setIsConfirmingNonBusinessDay(true);
                return;
            }
            setIsConfirmingNonBusinessDay(false);
            onSubmit(freshNonBusinessDay);
        } finally {
            submissionInFlightRef.current = false;
            setIsRefreshingCalendar(false);
        }
    };

    return (
        <>
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
                approvalDisabled={isCalendarBlocking}
                isPending={isPending || isRefreshingCalendar}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen && !isPending && !isRefreshingCalendar) onClose();
                }}
                onApprove={handleApprove}
            >
                <div className="space-y-2 pt-5" data-component={`${dataComponent}_date-field`}>
                    <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                            <FieldLabelRow
                                data-component={`${dataComponent}_date-field`}
                                htmlFor={DATE_INPUT_ID}
                                label={`${sessionIndex}회차 서비스 제공 날짜`}
                                message={slot}
                            />
                        </div>
                        {isCalendarFailed ? (
                            <Button
                                type="button"
                                variant="link"
                                size="sm"
                                data-component={`${dataComponent}_calendar-retry`}
                                className="h-auto shrink-0 p-0 text-xs"
                                onClick={() => { setSaveMessage(null); retryCalendar(); }}
                            >
                                다시 시도
                            </Button>
                        ) : null}
                    </div>
                    <Input
                        id={DATE_INPUT_ID}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={10}
                        placeholder="2026-12-01"
                        value={selectedDate}
                        disabled={isPending || isRefreshingCalendar}
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
                            setSaveMessage(null);
                            setEdited(true);
                            onDateChange(formatIsoDateInput(event.target.value));
                        }}
                    />
                </div>
            </ApprovalTwoButtonModal>
            <ApprovalTwoButtonModal
                open={open && isConfirmingNonBusinessDay}
                data-component={`${dataComponent}_non-business-day-confirm`}
                title="주말·공휴일이에요"
                description={
                    <>
                        <span>{selectedDate}은 서비스를 제공하지 않는 날이에요.</span>
                        <br />
                        <span>그래도 이 날짜로 옮길까요? 이후 회차는 다음 영업일부터 이어져요.</span>
                    </>
                }
                isDescriptionVisuallyHidden={false}
                cancelLabel="다시 고르기"
                approvalLabel="이 날짜로 옮기기"
                pendingLabel="변경 중..."
                isPending={isPending || isRefreshingCalendar}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen && !isPending && !isRefreshingCalendar) setIsConfirmingNonBusinessDay(false);
                }}
                onApprove={() => handleApprove(true)}
            />
        </>
    );
}
