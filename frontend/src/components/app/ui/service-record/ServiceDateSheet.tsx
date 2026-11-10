"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { isoDateInKorea, type KrBusinessDayCalendar } from "@/lib/date/business-days";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_CELL_BASE = "relative flex min-h-[calc(44px*var(--glint-ui-scale,1))] min-w-0 flex-col items-center justify-center rounded-[calc(10px*var(--glint-ui-scale,1))] border text-[calc(14px*var(--glint-ui-scale,1))] font-bold leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-v3-primary";
const HATCHED = "border-v3-border text-v3-text-muted/70 bg-[repeating-linear-gradient(135deg,#fff_0_5px,hsl(214_20%_96%)_5px_10px)]";
const ICON_BUTTON = "h-[calc(44px*var(--glint-ui-scale,1))] w-[calc(44px*var(--glint-ui-scale,1))] rounded-[calc(12px*var(--glint-ui-scale,1))]";
const ACTION_BUTTON = "h-[calc(44px*var(--glint-ui-scale,1))] flex-1 text-[calc(16px*var(--glint-ui-scale,1))] leading-[calc(24px*var(--glint-ui-scale,1))]";

interface DateParts { year: number; month: number; day: number }

function parseIsoDate(value: string): DateParts | null {
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

function isOutsideWindow(value: string, windowStart: string | null, windowEnd: string | null): boolean {
    return Boolean((windowStart && value < windowStart) || (windowEnd && value > windowEnd));
}

/** Admin eligibility: inclusive case margin and the client's service-day calendar only. */
export function isSelectableServiceRecordDate(
    value: string,
    calendar: KrBusinessDayCalendar,
    windowStart: string | null = null,
    windowEnd: string | null = null,
): boolean {
    const parts = parseIsoDate(value);
    if (!parts || isOutsideWindow(value, windowStart, windowEnd)) return false;
    try {
        calendar.assertSupportedYear(parts.year);
        return calendar.isBusinessDay(value);
    } catch {
        // An unloaded calendar year must never become selectable.
        return false;
    }
}

function formatServiceDate(iso: string, short = false): string {
    const weekday = WEEKDAYS[new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay()];
    return `${iso.slice(short ? 5 : 0, 10).replaceAll("-", ".")}(${weekday})`;
}

export interface AdminServiceDateSheetProps {
    "data-component": string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentServiceDate: string;
    calendar: KrBusinessDayCalendar;
    windowStart?: string | null;
    windowEnd?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    otherSessions: ReadonlyArray<{ sessionIndex: number; serviceDate: string }>;
    selectedServiceDate?: string | null;
    sessionLabel: string;
    onApply: (isoDate: string) => void;
    error?: string | null;
    disabled?: boolean;
}

/** Unmount the draft on close so cancellation never retains a pending selection. */
export function AdminServiceDateSheet(props: AdminServiceDateSheetProps) {
    return props.open ? <DateSheetContent key={`${props.sessionLabel}:${props.currentServiceDate}`} {...props} /> : null;
}

function DateSheetContent({
    "data-component": root, onOpenChange, currentServiceDate, calendar,
    windowStart = null, windowEnd = null, startDate, endDate, otherSessions,
    selectedServiceDate, sessionLabel, onApply, error, disabled = false,
}: AdminServiceDateSheetProps) {
    const initial = parseIsoDate(currentServiceDate) ? currentServiceDate : isoDateInKorea();
    const [month, setMonth] = useState(initial.slice(0, 7));
    const visibleMonth = windowStart && month < windowStart.slice(0, 7) ? windowStart.slice(0, 7)
        : windowEnd && month > windowEnd.slice(0, 7) ? windowEnd.slice(0, 7) : month;
    const [selected, setSelected] = useState(selectedServiceDate ?? "");
    const [applyError, setApplyError] = useState<string | null>(null);
    const [year, monthNumber] = visibleMonth.split("-").map(Number);
    const startWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
    const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const shiftMonth = (delta: number) => new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7);
    const previous = shiftMonth(-1);
    const next = shiftMonth(1);
    const child = (suffix: string) => `${root}_${suffix}`;
    const close = () => onOpenChange(false);
    const apply = () => {
        if (disabled || !selected) return;
        if (!isSelectableServiceRecordDate(selected, calendar, windowStart, windowEnd)) {
            setApplyError(isOutsideWindow(selected, windowStart, windowEnd)
                ? "고를 수 있는 기간이 아니에요."
                : "선택한 날짜가 영업일이 아닙니다. 다시 선택해 주세요.");
            return;
        }
        setApplyError(null);
        onApply(selected);
    };

    return (
        <Sheet open onOpenChange={onOpenChange}>
            <SheetContent side="bottom" data-component={root} data-source-component="AdminServiceDateSheet"
                className="flex h-[80dvh] max-h-[94dvh] min-w-0 flex-col gap-0 overflow-hidden rounded-t-[calc(28px*var(--glint-ui-scale,1))] bg-white p-0 sm:bottom-6 sm:left-1/2 sm:right-auto sm:w-[calc(480px*var(--glint-ui-scale,1))] sm:max-w-[calc(100vw-48px)] sm:-translate-x-1/2 sm:rounded-[calc(28px*var(--glint-ui-scale,1))]">
                <div aria-hidden="true" data-component={child("handle")} data-slot="date-sheet-handle" className="mx-auto mt-[calc(12px*var(--glint-ui-scale,1))] h-[calc(4px*var(--glint-ui-scale,1))] w-[calc(36px*var(--glint-ui-scale,1))] shrink-0 rounded-full bg-v3-border" />
                <SheetHeader data-component={child("header")} className="gap-[calc(2px*var(--glint-ui-scale,1))] px-[calc(22px*var(--glint-ui-scale,1))] pb-[calc(8px*var(--glint-ui-scale,1))] pt-[calc(12px*var(--glint-ui-scale,1))] pr-[calc(64px*var(--glint-ui-scale,1))]">
                    <SheetTitle data-component={child("header_title")} className="text-[calc(24px*var(--glint-ui-scale,1))] leading-[calc(32px*var(--glint-ui-scale,1))] font-bold text-v3-dark">{sessionLabel} 서비스 제공일 수정</SheetTitle>
                    <SheetDescription data-component={child("header_description")} className="text-[calc(14px*var(--glint-ui-scale,1))] leading-[calc(20px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">새로운 날짜를 선택해 주세요.</SheetDescription>
                    <Button data-component={child("header_close")} type="button" variant="ghost" size="icon" aria-label="닫기" className={cn(ICON_BUTTON, "absolute right-[calc(8px*var(--glint-ui-scale,1))] top-[calc(12px*var(--glint-ui-scale,1))] text-v3-text-muted")} onClick={close}><X aria-hidden="true" /></Button>
                </SheetHeader>
                <div data-component={child("calendar")} data-slot="calendar" className="min-h-0 flex-1 overflow-y-auto px-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(16px*var(--glint-ui-scale,1))]">
                    {startDate && endDate ? <p data-component={child("calendar_window")} className="mb-[calc(8px*var(--glint-ui-scale,1))] text-[calc(14px*var(--glint-ui-scale,1))] leading-[calc(20px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">서비스 기간: {formatServiceDate(startDate, true)} ~ {formatServiceDate(endDate, true)}</p> : null}
                    <div data-component={child("calendar_navigation")} className="mb-[calc(8px*var(--glint-ui-scale,1))] flex items-center justify-between gap-[calc(8px*var(--glint-ui-scale,1))]">
                        <b data-component={child("calendar_navigation_month")} className="text-[calc(16px*var(--glint-ui-scale,1))] leading-[calc(24px*var(--glint-ui-scale,1))] text-v3-dark" aria-live="polite">{year}년 {monthNumber}월</b>
                        <div className="flex gap-[calc(4px*var(--glint-ui-scale,1))]">
                            <Button data-component={child("calendar_navigation_previous")} type="button" variant="outline" size="icon" className={ICON_BUTTON} aria-label="이전 달" disabled={Boolean(windowStart && previous < windowStart.slice(0, 7))} onClick={() => setMonth(previous)}><ChevronLeft aria-hidden="true" /></Button>
                            <Button data-component={child("calendar_navigation_next")} type="button" variant="outline" size="icon" className={ICON_BUTTON} aria-label="다음 달" disabled={Boolean(windowEnd && next > windowEnd.slice(0, 7))} onClick={() => setMonth(next)}><ChevronRight aria-hidden="true" /></Button>
                        </div>
                    </div>
                    <div data-component={child("calendar_weekdays")} aria-hidden="true" className="mb-[calc(8px*var(--glint-ui-scale,1))] grid grid-cols-7 gap-[calc(4px*var(--glint-ui-scale,1))] text-center text-[calc(14px*var(--glint-ui-scale,1))] leading-[calc(20px*var(--glint-ui-scale,1))] font-bold text-v3-text-muted">{WEEKDAYS.map((label) => <span key={label}>{label}</span>)}</div>
                    <div data-component={child("calendar_days")} data-slot="calendar-days" className="grid grid-cols-7 gap-[calc(4px*var(--glint-ui-scale,1))]">
                        {Array.from({ length: startWeekday }, (_, index) => <span key={`empty-${index}`} />)}
                        {Array.from({ length: count }, (_, index) => {
                            const iso = `${visibleMonth}-${String(index + 1).padStart(2, "0")}`;
                            const usedBy = otherSessions.find((row) => row.serviceDate.slice(0, 10) === iso);
                            const isCurrent = iso === currentServiceDate;
                            const isSelected = iso === selected;
                            const blocked = !isSelectableServiceRecordDate(iso, calendar, windowStart, windowEnd);
                            const isInPeriod = Boolean(startDate && endDate && startDate.slice(0, 10) <= iso && iso <= endDate.slice(0, 10));
                            return <button key={iso} type="button" data-component={child(`calendar_days_day-${index + 1}`)} data-slot="calendar-day" data-day-state={blocked ? "blocked" : isCurrent ? "current" : "available"} data-in-period={isInPeriod ? "true" : undefined}
                                aria-label={`${formatServiceDate(iso)}${usedBy ? ` ${usedBy.sessionIndex}회차` : isCurrent ? " 지금" : ""}`} aria-pressed={isSelected} disabled={blocked || disabled}
                                onClick={() => { setSelected(iso); setApplyError(null); }}
                                className={cn(MONTH_CELL_BASE, "border-v3-border bg-white text-v3-dark", !blocked && "cursor-pointer", blocked && HATCHED,
                                    isInPeriod && "border-[1.5px] border-v3-primary!",
                                    isCurrent && "border-dashed border-v3-primary! text-v3-primary", isSelected && "border-v3-primary! bg-v3-primary text-white")}>
                                <span>{index + 1}</span>
                                {usedBy || isCurrent ? <small data-component={child(`calendar_days_day-${index + 1}_annotation`)} className="mt-[calc(2px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] font-extrabold leading-none">{usedBy ? `${usedBy.sessionIndex}회차` : "지금"}</small> : null}
                            </button>;
                        })}
                    </div>
                    <div data-component={child("calendar_legend")} data-slot="legend" className="mt-[calc(12px*var(--glint-ui-scale,1))] flex flex-wrap gap-x-[calc(12px*var(--glint-ui-scale,1))] gap-y-[calc(4px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] leading-[calc(16px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">
                        <span data-component={child("calendar_legend_selected")}><i aria-hidden="true" className="mr-[calc(4px*var(--glint-ui-scale,1))] inline-block h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(12px*var(--glint-ui-scale,1))] rounded bg-v3-primary align-middle" />선택한 날</span>
                        <span data-component={child("calendar_legend_available")}><i aria-hidden="true" className="mr-[calc(4px*var(--glint-ui-scale,1))] inline-block h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(12px*var(--glint-ui-scale,1))] rounded border border-v3-border align-middle" />선택 가능</span>
                        <span data-component={child("calendar_legend_blocked")}><i aria-hidden="true" className={cn("mr-[calc(4px*var(--glint-ui-scale,1))] inline-block h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(12px*var(--glint-ui-scale,1))] rounded border align-middle", HATCHED)} />선택 불가</span>
                    </div>
                    {applyError ? <Alert variant="destructive" data-component={child("calendar_validation-error")} className="mt-[calc(12px*var(--glint-ui-scale,1))]"><AlertDescription>{applyError}</AlertDescription></Alert> : null}
                    {error ? <Alert variant="destructive" data-component={child("calendar_request-error")} className="mt-[calc(12px*var(--glint-ui-scale,1))]">
                        <AlertTitle>제공일을 저장하지 못했습니다.</AlertTitle><AlertDescription>{error}</AlertDescription>
                    </Alert> : null}
                </div>
                <div data-component={child("actions")} data-slot="actions" className="flex shrink-0 gap-[calc(8px*var(--glint-ui-scale,1))] border-t border-v3-border px-[calc(16px*var(--glint-ui-scale,1))] pt-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(16px*var(--glint-ui-scale,1)+env(safe-area-inset-bottom))]">
                    <Button className={ACTION_BUTTON} data-component={child("actions_cancel")} type="button" variant="outline" onClick={close}>취소</Button>
                    <Button className={ACTION_BUTTON} data-component={child("actions_select")} type="button" variant="positive" disabled={disabled || !selected} onClick={apply}>선택</Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
