"use client";

import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";
import { isRealIsoDate, resolveFieldMessage } from "@babyjamjam/shared/utils/field-validation-message";

import { FieldMessageText } from "@/components/app/ui/field-message";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { Input } from "@/components/ui/input";
import { useFieldInputStates } from "@/hooks/useFieldInputStates";
import { toFieldMessageView, withGuidance, type FieldMessageView } from "@/lib/forms/field-message-text";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";

interface ServiceScheduleChangeModalProps {
    open: boolean;
    sessionIndex: number;
    currentDate: string;
    minimumDate: string;
    selectedDate: string;
    isPending: boolean;
    onDateChange: (date: string) => void;
    onClose: () => void;
    onSubmit: () => void;
}

const DATE_INPUT_ID = "service-schedule-change-date";
const DATE_MESSAGE_ID = `${DATE_INPUT_ID}-message`;
/** Static guidance for the date field; it sits in the label-row slot until an error or hint replaces it. */
const DATE_GUIDANCE = "현재 날짜 이후로 선택해 주세요";

export function ServiceScheduleChangeModal({
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
    const fields = useFieldInputStates<"date">();
    const label = `${sessionIndex}회차 서비스 제공 날짜`;

    // Partial input ("2026-1") sorts unpredictably against full dates, so only a real date counts.
    const isRealDate = isRealIsoDate(selectedDate);
    const isPostponed = isRealDate && selectedDate > currentDate;
    const isBeforeMinimum = isRealDate && isRealIsoDate(minimumDate) && selectedDate < minimumDate;

    const formatMessage = toFieldMessageView(
        locale,
        resolveFieldMessage("date", fields.stateOf("date", selectedDate), { required: true }),
        label,
    );
    const message: FieldMessageView | null = withGuidance(
        isBeforeMinimum
            ? { tone: "error", text: t(locale, "form.validation.date-not-before").replace("{date}", minimumDate) }
            : formatMessage,
        DATE_GUIDANCE,
    );
    const hasError = message?.tone === "error";

    return (
        <TwoButtonModal
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) onClose();
            }}
            dataComponent="desktop_clients-detail_service-schedule-change-modal"
            title="서비스 일정 변경"
            description={
                <>
                    <span>{sessionIndex}회차 서비스 제공 날짜를 조정합니다.</span>
                    <br />
                    <span>선택한 회차부터 이후 일정을 뒤로 미룹니다.</span>
                </>
            }
            isDescriptionVisuallyHidden={false}
            size="detail"
            approvalLabel="일정 변경"
            pendingLabel="변경 중..."
            approvalDisabled={!isPostponed || isBeforeMinimum}
            isPending={isPending}
            onApprove={onSubmit}
        >
            <div className="space-y-2 py-4">
                <div
                    data-component="desktop_clients-detail_service-schedule-change-modal_date-label-row"
                    className="flex h-[1lh] min-w-0 items-center justify-between gap-2 text-sm leading-[1.3]"
                >
                    <label
                        htmlFor={DATE_INPUT_ID}
                        className="shrink-0 whitespace-nowrap font-medium text-v3-text-primary"
                    >
                        {label}
                    </label>
                    {message ? (
                        <FieldMessageText
                            id={DATE_MESSAGE_ID}
                            tone={message.tone}
                            data-component="desktop_clients-detail_service-schedule-change-modal_date-message"
                            className="ml-auto min-w-0"
                        >
                            {message.text}
                        </FieldMessageText>
                    ) : null}
                </div>
                <Input
                    id={DATE_INPUT_ID}
                    type="text"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="2026-12-01"
                    value={selectedDate}
                    disabled={isPending}
                    error={hasError}
                    aria-invalid={hasError ? true : undefined}
                    aria-describedby={message ? DATE_MESSAGE_ID : undefined}
                    onChange={(event) => {
                        const nextDate = formatIsoDateInput(event.target.value);
                        fields.onChange("date", selectedDate, nextDate);
                        onDateChange(nextDate);
                    }}
                    {...fields.focusProps("date", selectedDate)}
                />
            </div>
        </TwoButtonModal>
    );
}
