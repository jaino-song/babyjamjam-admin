"use client";

import { useMemo, useState, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { FormDialogShell } from "@/components/app/ui/FormDialogShell";
import {
    CompactDateSelect,
    type CompactDateSelectOption,
} from "@/components/app/v3";
import {
    assertSupportedKoreanHolidayYear,
    KOREAN_HOLIDAY_CALENDAR,
    KOREAN_HOLIDAY_CALENDAR_VERSION,
    isBusinessDayKr,
} from "@/lib/date/business-days";

const SOURCE_COMPONENT = "ServiceRecordDateSelectionDialog";
const DEFAULT_DATA_COMPONENT = "desktop_service-record-admin_date-selection-dialog";
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ServiceRecordDateBlockReason =
    | "malformed"
    | "unsupported-year"
    | "non-business-day";

export interface ServiceRecordDateParts {
    year: number;
    month: number;
    day: number;
}

export interface InitialServiceRecordDateSelection {
    parts: ServiceRecordDateParts | null;
    reason: ServiceRecordDateBlockReason | null;
}

export interface ServiceRecordDateSelectionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentServiceDate: string;
    /** Explicitly retained selection after a failed save; never auto-submitted. */
    selectedServiceDate?: string | null;
    sessionLabel: ReactNode;
    onApply: (serviceDate: string) => void;
    error?: string | null;
    onReloadLatest?: () => void;
    busy?: boolean;
    disabled?: boolean;
    "data-component"?: string;
    dataComponent?: string;
}

interface DraftSelection {
    year: string;
    month: string;
    day: string;
    blockedReason: ServiceRecordDateBlockReason | null;
}

interface DraftSelectionState extends DraftSelection {
    resetKey: string;
}

function parseIsoDate(value: string): ServiceRecordDateParts | null {
    const match = ISO_DATE_PATTERN.exec(value);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1 || month < 1 || month > 12 || day < 1) return null;

    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        Number.isNaN(parsed.getTime())
        || parsed.getUTCFullYear() !== year
        || parsed.getUTCMonth() !== month - 1
        || parsed.getUTCDate() !== day
    ) {
        return null;
    }

    return { year, month, day };
}

function toIsoDate({ year, month, day }: ServiceRecordDateParts): string {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDateForDisplay(value: string): string | null {
    const parts = parseIsoDate(value);
    return parts ? `${String(parts.year).padStart(4, "0")}.${String(parts.month).padStart(2, "0")}.${String(parts.day).padStart(2, "0")}` : null;
}

function toDraftSelection(value: string): DraftSelection {
    const parts = parseIsoDate(value);
    if (!parts) {
        return { year: "", month: "", day: "", blockedReason: "malformed" };
    }

    try {
        assertSupportedKoreanHolidayYear(parts.year);
    } catch {
        return {
            year: "",
            month: "",
            day: "",
            blockedReason: "unsupported-year",
        };
    }

    if (!isBusinessDayKr(value)) {
        return {
            year: "",
            month: "",
            day: "",
            blockedReason: "non-business-day",
        };
    }

    return {
        year: String(parts.year),
        month: String(parts.month).padStart(2, "0"),
        day: String(parts.day).padStart(2, "0"),
        blockedReason: null,
    };
}

export function getSupportedKoreanBusinessYears(): number[] {
    return Object.keys(KOREAN_HOLIDAY_CALENDAR)
        .map(Number)
        .filter((year) => Number.isInteger(year))
        .sort((left, right) => left - right);
}

export function getBusinessDayOptions(year: number, month: number): CompactDateSelectOption[] {
    if (!getSupportedKoreanBusinessYears().includes(year) || month < 1 || month > 12) return [];

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const options: CompactDateSelectOption[] = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
        const value = toIsoDate({ year, month, day });
        if (!isBusinessDayKr(value)) continue;
        options.push({
            label: `${day}일`,
            value: String(day).padStart(2, "0"),
        });
    }
    return options;
}

export function getInitialServiceRecordDateSelection(value: string): InitialServiceRecordDateSelection {
    const parts = parseIsoDate(value);
    if (!parts) return { parts: null, reason: "malformed" };

    try {
        assertSupportedKoreanHolidayYear(parts.year);
    } catch {
        return { parts: null, reason: "unsupported-year" };
    }

    return isBusinessDayKr(value)
        ? { parts, reason: null }
        : { parts: null, reason: "non-business-day" };
}

export function isSelectableServiceRecordDate(value: string): boolean {
    const parts = parseIsoDate(value);
    if (!parts) return false;

    try {
        assertSupportedKoreanHolidayYear(parts.year);
        return isBusinessDayKr(value);
    } catch {
        return false;
    }
}

function getMonthOptions(): CompactDateSelectOption[] {
    return Array.from({ length: 12 }, (_, index) => {
        const month = index + 1;
        return { label: `${month}월`, value: String(month).padStart(2, "0") };
    });
}

function getYearOptions(): CompactDateSelectOption[] {
    return getSupportedKoreanBusinessYears().map((year) => ({
        label: `${year}년`,
        value: String(year),
    }));
}

function getBlockedMessage(reason: ServiceRecordDateBlockReason): string {
    switch (reason) {
        case "malformed":
            return "현재 제공일 형식이 올바르지 않아 변경할 수 없습니다.";
        case "unsupported-year":
            return `현재 제공일의 연도를 지원하지 않는 달력입니다. 지원 달력 버전: ${KOREAN_HOLIDAY_CALENDAR_VERSION}`;
        case "non-business-day":
            return "현재 제공일이 주말 또는 공휴일이어서 변경할 수 없습니다.";
    }
}

function getSelectionDate(selection: DraftSelection): string | null {
    if (selection.blockedReason || !/^\d{4}$/.test(selection.year) || !/^\d{2}$/.test(selection.month) || !/^\d{2}$/.test(selection.day)) {
        return null;
    }

    const value = `${selection.year}-${selection.month}-${selection.day}`;
    return isSelectableServiceRecordDate(value) ? value : null;
}

export function ServiceRecordDateSelectionDialog({
    open,
    onOpenChange,
    currentServiceDate,
    selectedServiceDate = null,
    sessionLabel,
    onApply,
    error = null,
    onReloadLatest,
    busy = false,
    disabled = false,
    "data-component": canonicalDataComponent,
    dataComponent: legacyDataComponent,
}: ServiceRecordDateSelectionDialogProps) {
    const dataComponent = canonicalDataComponent ?? legacyDataComponent ?? DEFAULT_DATA_COMPONENT;
    const selectionSourceDate = selectedServiceDate ?? currentServiceDate;
    const resetKey = `${open ? "open" : "closed"}:${currentServiceDate}:${selectionSourceDate}`;
    const [draftState, setDraftState] = useState<DraftSelectionState>(() => ({
        ...toDraftSelection(selectionSourceDate),
        resetKey,
    }));
    const [validationState, setValidationState] = useState<{ resetKey: string; error: string | null }>(() => ({
        resetKey,
        error: null,
    }));
    const selection: DraftSelection = draftState.resetKey === resetKey
        ? draftState
        : toDraftSelection(selectionSourceDate);
    const applyError = validationState.resetKey === resetKey ? validationState.error : null;

    const updateSelection = (update: (current: DraftSelection) => DraftSelection) => {
        setDraftState((current) => ({
            ...update(current.resetKey === resetKey ? current : toDraftSelection(selectionSourceDate)),
            resetKey,
        }));
    };
    const clearApplyError = () => setValidationState({ resetKey, error: null });

    const yearOptions = useMemo(() => getYearOptions(), []);
    const monthOptions = useMemo(() => getMonthOptions(), []);
    const dayOptions = useMemo(
        () => selection.year && selection.month
            ? getBusinessDayOptions(Number(selection.year), Number(selection.month))
            : [],
        [selection.month, selection.year],
    );
    const selectedDate = useMemo(() => getSelectionDate(selection), [selection]);
    const isBlocked = selection.blockedReason !== null;
    const controlsDisabled = busy || disabled;
    const applyDisabled = controlsDisabled || isBlocked || selectedDate === null;
    const currentDisplayDate = formatDateForDisplay(currentServiceDate);
    const yearId = `${dataComponent}-year`;
    const monthId = `${dataComponent}-month`;
    const dayId = `${dataComponent}-day`;

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen && busy) return;
        onOpenChange(nextOpen);
    };

    const handleApply = () => {
        const nextDate = getSelectionDate(selection);
        if (!nextDate || !isSelectableServiceRecordDate(nextDate)) {
            setValidationState({
                resetKey,
                error: "선택한 날짜가 영업일이 아닙니다. 다시 선택해 주세요.",
            });
            return;
        }
        clearApplyError();
        onApply(nextDate);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={handleOpenChange}
        >
            <FormDialogShell
                data-component={dataComponent}
                size="compact"
                mobileSheet
                title={<>{sessionLabel} 서비스 제공일 수정</>}
                description="서비스 제공일을 선택해 주세요. 다음 회차와 겹치면 뒤 회차의 이동 여부를 확인합니다. 변경사항은 회차 화면에서 수정 확인을 눌러야 저장됩니다."
                contentClassName="flex flex-col gap-4 max-sm:px-[22px] max-sm:pt-1 max-sm:pb-[22px]"
                footerClassName="grid grid-cols-[1fr_2fr] gap-2.5 px-[22px] pb-[max(22px,env(safe-area-inset-bottom))]"
                footer={(
                    <>
                        <Button
                            type="button"
                            variant="neutral"
                            className="h-[52px] rounded-xl text-base"
                            data-component={`${dataComponent}_actions_cancel`}
                            disabled={busy}
                            onClick={() => handleOpenChange(false)}
                        >
                            취소
                        </Button>
                        <Button
                            type="button"
                            variant="positive"
                            className="h-[52px] rounded-xl text-base"
                            data-component={`${dataComponent}_actions_apply`}
                            disabled={applyDisabled}
                            aria-busy={busy || undefined}
                            onClick={handleApply}
                        >
                            {busy ? "적용 중…" : "수정"}
                        </Button>
                    </>
                )}
            >
                <div
                    data-component={`${dataComponent}_content_date-form`}
                    data-slot="date-form"
                    data-source-component={SOURCE_COMPONENT}
                    className="flex flex-col gap-4"
                >
                    <div
                        data-component={`${dataComponent}_content_date-form_current-date`}
                        data-slot="current-date"
                        className="flex flex-col gap-1"
                    >
                        <span className="text-sm text-v3-text-muted">
                            {currentDisplayDate ? `현재 ${Number(currentServiceDate.slice(0, 4))}년 ${Number(currentServiceDate.slice(5, 7))}월 ${Number(currentServiceDate.slice(8, 10))}일` : "현재 제공일을 확인할 수 없습니다."}
                        </span>
                    </div>

                    <p
                        data-component={`${dataComponent}_content_date-form_policy`}
                        data-slot="policy"
                        className="text-sm font-semibold text-v3-dark"
                    >
                        변경할 날짜
                    </p>

                    {isBlocked ? (
                        <Alert
                            variant="warning"
                            data-component={`${dataComponent}_content_date-form_blocked`}
                            data-slot="blocked"
                        >
                            <AlertTitle>날짜를 변경할 수 없습니다.</AlertTitle>
                            <AlertDescription>{getBlockedMessage(selection.blockedReason!)}</AlertDescription>
                        </Alert>
                    ) : (
                        <>
                            <div
                                data-component={`${dataComponent}_content_date-form_controls`}
                                data-slot="date-controls"
                                className="grid grid-cols-[1.3fr_1fr_1fr] items-end gap-2.5"
                                role="group"
                                aria-label="새 제공일"
                            >
                                <div
                                    data-component={`${dataComponent}_content_date-form_controls_year`}
                                    data-slot="year-field"
                                    className="flex flex-col gap-1"
                                >
                                    <Label htmlFor={yearId}>연도</Label>
                                    <CompactDateSelect
                                        id={yearId}
                                        triggerClassName="w-full h-[54px] rounded-xl px-3 text-base font-semibold"
                                        contentClassName="w-auto min-w-[100px] [&_[role=option]]:min-h-11 [&_[role=option]]:text-base"
                                        ariaLabel="연도"
                                        value={selection.year}
                                        onValueChange={(value) => {
                                            updateSelection((current) => ({ ...current, year: value, day: "" }));
                                            clearApplyError();
                                        }}
                                        options={yearOptions}
                                        disabled={controlsDisabled}
                                        dataComponent={`${dataComponent}_content_date-form_controls_year_select`}
                                        contentDataComponent={`${dataComponent}_content_date-form_controls_year_options`}
                                    />
                                </div>
                                <div
                                    data-component={`${dataComponent}_content_date-form_controls_month`}
                                    data-slot="month-field"
                                    className="flex flex-col gap-1"
                                >
                                    <Label htmlFor={monthId}>월</Label>
                                    <CompactDateSelect
                                        id={monthId}
                                        triggerClassName="w-full h-[54px] rounded-xl px-3 text-base font-semibold"
                                        contentClassName="w-auto min-w-[100px] [&_[role=option]]:min-h-11 [&_[role=option]]:text-base"
                                        ariaLabel="월"
                                        value={selection.month}
                                        onValueChange={(value) => {
                                            updateSelection((current) => ({ ...current, month: value, day: "" }));
                                            clearApplyError();
                                        }}
                                        options={monthOptions}
                                        disabled={controlsDisabled}
                                        dataComponent={`${dataComponent}_content_date-form_controls_month_select`}
                                        contentDataComponent={`${dataComponent}_content_date-form_controls_month_options`}
                                    />
                                </div>
                                <div
                                    data-component={`${dataComponent}_content_date-form_controls_day`}
                                    data-slot="day-field"
                                    className="flex flex-col gap-1"
                                >
                                    <Label htmlFor={dayId}>일</Label>
                                    <CompactDateSelect
                                        id={dayId}
                                        triggerClassName="w-full h-[54px] rounded-xl px-3 text-base font-semibold"
                                        contentClassName="w-auto min-w-[100px] [&_[role=option]]:min-h-11 [&_[role=option]]:text-base"
                                        ariaLabel="일"
                                        value={selection.day}
                                        onValueChange={(value) => {
                                            updateSelection((current) => ({ ...current, day: value }));
                                            clearApplyError();
                                        }}
                                        options={dayOptions}
                                        placeholder="일"
                                        disabled={controlsDisabled || dayOptions.length === 0}
                                        dataComponent={`${dataComponent}_content_date-form_controls_day_select`}
                                        contentDataComponent={`${dataComponent}_content_date-form_controls_day_options`}
                                    />
                                </div>
                            </div>

                            <p
                                data-component={`${dataComponent}_content_date-form_selection-hint`}
                                data-slot="selection-hint"
                                className="text-xs leading-5 text-v3-text-muted"
                            >
                                주말·공휴일을 제외한 영업일만 선택할 수 있어요.
                            </p>
                            {applyError ? (
                                <p
                                    data-component={`${dataComponent}_content_date-form_validation-error`}
                                    data-slot="validation-error"
                                    className="text-sm text-v3-burgundy"
                                    role="alert"
                                >
                                    {applyError}
                                </p>
                            ) : null}
                        </>
                    )}
                    {error ? (
                        <Alert
                            variant="destructive"
                            data-component={`${dataComponent}_content_date-form_request-error`}
                            data-slot="request-error"
                        >
                            <AlertTitle>제공일을 저장하지 못했습니다.</AlertTitle>
                            <AlertDescription className="flex flex-col gap-2">
                                <span>{error}</span>
                                {onReloadLatest ? (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="neutral"
                                        disabled={busy}
                                        onClick={onReloadLatest}
                                    >
                                        최신 초안 불러오기
                                    </Button>
                                ) : null}
                            </AlertDescription>
                        </Alert>
                    ) : null}
                </div>
            </FormDialogShell>
        </Dialog>
    );
}
