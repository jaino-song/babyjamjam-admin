"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { hasServiceDaysForGap } from "@babyjamjam/shared/utils/service-record-schedule";
import type { ServiceRecordContext } from "@babyjamjam/service-record-ui";
import { isoDateInKorea, type KrBusinessDayCalendar } from "@/lib/date/business-days";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
// Keep the admin schedule sheet's cell sizing and blocked hatch unchanged.
const MONTH_CELL_BASE = "relative flex min-h-11 min-w-0 flex-col items-center justify-center rounded-[10px] border text-sm font-bold leading-none";
const HATCHED = "border-v3-border text-v3-text-muted/70 bg-[repeating-linear-gradient(135deg,#fff_0_5px,hsl(214_20%_96%)_5px_10px)]";
export const GAP_ROOM = "사이에 아직 안 쓴 회차가 있어요. 그 회차의 날짜를 남겨 주세요.";
export const ORDER_BEFORE = "앞 회차보다 이르게 바꿀 수 없어요. 앞 회차를 먼저 변경해 주세요.";
export const ORDER_AFTER = "뒷 회차보다 늦게 바꿀 수 없어요. 뒷 회차를 먼저 변경해 주세요.";

export function offsetServiceDate(iso: string | null | undefined, days: number): string | null {
    if (!iso) return null;
    const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

export function formatServiceDate(iso: string, short = false): string {
    if (!iso) return "";
    const weekday = WEEKDAYS[new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay()];
    return `${iso.slice(short ? 5 : 0, 10).replaceAll("-", ".")}(${weekday})`;
}

type DateState = "available" | "current" | "used" | "before" | "after" | "blocked" | "gap";
interface DateRules {
    context: ServiceRecordContext;
    day: number;
    calendar: KrBusinessDayCalendar;
    calendarReady: boolean;
}

export function classifyServiceDate(iso: string, { context, day, calendar, calendarReady }: DateRules): DateState {
    const current = context.sessions.find((row) => row.sessionIndex === day)?.serviceDate.slice(0, 10);
    if (iso === current) return "current";
    // Session order feedback also applies to dates blocked for another reason.
    const lower = context.sessions.filter((row) => row.sessionIndex < day).sort((a, b) => b.sessionIndex - a.sessionIndex)[0];
    const upper = context.sessions.filter((row) => row.sessionIndex > day).sort((a, b) => a.sessionIndex - b.sessionIndex)[0];
    if (lower && iso <= lower.serviceDate.slice(0, 10)) return "before";
    if (upper && iso >= upper.serviceDate.slice(0, 10)) return "after";
    if (context.sessions.some((row) => row.sessionIndex !== day && row.serviceDate.slice(0, 10) === iso)) return "used";
    const first = offsetServiceDate(context.startDate, -7);
    const last = offsetServiceDate(context.endDate, 7);
    if ((first && iso < first) || (last && iso > last) || !calendarReady) return "blocked";
    try {
        if (!calendar.isBusinessDay(iso)) return "blocked";
        return hasServiceDaysForGap({ sessionIndex: day, serviceDate: iso, rows: context.sessions, calendar, first, last }) ? "available" : "gap";
    } catch {
        // Missing holiday data must never turn into an available day.
        return "blocked";
    }
}

export interface ServiceDateSheetProps extends DateRules {
    "data-component": string;
    value: string;
    editing: boolean;
    onClose: () => void;
    onSelect: (iso: string) => void;
    onOrderBlocked: (message: string) => void;
}

/** Mounted only while open, so cancelling discards the pending selection. */
export function ServiceDateSheet({ "data-component": root, context, day, calendar, calendarReady, value, editing, onClose, onSelect, onOrderBlocked }: ServiceDateSheetProps) {
    const first = offsetServiceDate(context.startDate, -7);
    const last = offsetServiceDate(context.endDate, 7);
    const current = context.sessions.find((row) => row.sessionIndex === day)?.serviceDate.slice(0, 10) ?? "";
    const pending = value !== current;
    const initial = value || isoDateInKorea();
    const boundedInitial = first && initial < first ? first : last && initial > last ? last : initial;
    const [month, setMonth] = useState(boundedInitial.slice(0, 7));
    const [selected, setSelected] = useState(pending ? value : "");
    const [year, monthNumber] = month.split("-").map(Number);
    const startWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
    const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const shiftMonth = (delta: number) => new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7);
    const previous = shiftMonth(-1);
    const next = shiftMonth(1);
    const prevMonthNumber = Number(previous.slice(5, 7));
    const nextMonthNumber = Number(next.slice(5, 7));
    const rules = { context, day, calendar, calendarReady };
    const selectedState = classifyServiceDate(selected, rules);
    const canSelect = selected !== "" && selected !== value && (selectedState === "available" || (pending && selectedState === "current"));
    const child = (suffix: string) => `${root}_${suffix}`;

    return (
        <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
            <SheetContent side="bottom" overlayClassName="z-[200]" data-component={root} data-source-component="ServiceDateSheet" className="z-[201] flex h-[80dvh] max-h-[94dvh] min-w-0 flex-col gap-0 overflow-hidden rounded-t-[28px] bg-white p-0">
                <div aria-hidden="true" data-slot="date-sheet-handle" className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-v3-border" />
                <SheetHeader data-component={child("header")} className="gap-0.5 px-[22px] pb-2 pt-3 pr-16">
                    <SheetTitle className="text-2xl font-bold text-v3-dark">{day}회차 서비스 제공일</SheetTitle>
                    <SheetDescription className="text-sm font-semibold text-v3-text-muted">{editing && current ? `지금 ${formatServiceDate(current)}` : "날짜를 골라 주세요."}</SheetDescription>
                    <Button data-component={child("header_close")} type="button" variant="ghost" size="icon" aria-label="닫기" className="text-base absolute right-2 top-3 h-11 w-11 text-v3-text-muted" onClick={onClose}><X size={20} /></Button>
                </SheetHeader>
                <div data-component={child("calendar")} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                    <div data-component={child("calendar_navigation")} className="mb-2 flex items-center justify-between gap-2">
                        <b className="text-base text-v3-dark">{year}년 {monthNumber}월</b>
                        <div className="flex gap-1">
                            <Button data-component={child("calendar_navigation_previous")} type="button" variant="v3-outline" className="text-base h-11 gap-1 rounded-xl px-3 font-bold" aria-label={`이전 달 ${prevMonthNumber}월`} disabled={Boolean(first && previous < first.slice(0, 7))} onClick={() => setMonth(previous)}><ChevronLeft size={16} aria-hidden="true" />{prevMonthNumber}월</Button>
                            <Button data-component={child("calendar_navigation_next")} type="button" variant="v3-outline" className="text-base h-11 gap-1 rounded-xl px-3 font-bold" aria-label={`다음 달 ${nextMonthNumber}월`} disabled={Boolean(last && next > last.slice(0, 7))} onClick={() => setMonth(next)}>{nextMonthNumber}월<ChevronRight size={16} aria-hidden="true" /></Button>
                        </div>
                    </div>
                    <div data-component={child("calendar_weekdays")} aria-hidden="true" className="mb-2 grid grid-cols-7 gap-1 text-center text-sm font-bold text-v3-text-muted">{WEEKDAYS.map((label) => <span key={label}>{label}</span>)}</div>
                    <div data-component={child("calendar_days")} className="grid grid-cols-7 gap-1">
                        {Array.from({ length: startWeekday }, (_, index) => <span key={`empty-${index}`} />)}
                        {Array.from({ length: count }, (_, index) => {
                            const iso = `${month}-${String(index + 1).padStart(2, "0")}`;
                            const state = classifyServiceDate(iso, rules);
                            const usedBy = context.sessions.find((row) => row.sessionIndex !== day && row.serviceDate.slice(0, 10) === iso);
                            const isSelected = iso === selected;
                            const isCurrent = iso === current;
                            const blocked = state !== "available" && state !== "current";
                            const isInPeriod = Boolean(context.startDate && context.endDate && context.startDate.slice(0, 10) <= iso && iso <= context.endDate.slice(0, 10));
                            return <button key={iso} type="button" data-component={child(`calendar_days_day-${index + 1}`)} data-day-state={state} data-in-period={isInPeriod ? "true" : undefined} aria-label={`${formatServiceDate(iso)}${usedBy ? ` ${usedBy.sessionIndex}회차` : isCurrent ? " 지금" : ""}`} aria-pressed={isSelected} aria-disabled={blocked || (isCurrent && !pending)} onClick={() => {
                                if (state === "before" || state === "after") onOrderBlocked(state === "before" ? ORDER_BEFORE : ORDER_AFTER);
                                else if (state === "gap") onOrderBlocked(GAP_ROOM);
                                else if (state === "available" || (pending && state === "current")) setSelected(iso);
                            }} className={cn(MONTH_CELL_BASE, "border-v3-border bg-white text-v3-dark", blocked && HATCHED, isInPeriod && (!blocked || usedBy ? "border-[1.5px] border-v3-primary!" : "border-[1.5px] border-v3-primary/40!"), isCurrent && "border-dashed border-v3-primary! text-v3-primary", isSelected && "border-v3-primary! bg-v3-primary text-white")}>
                                <span>{index + 1}</span>
                                {usedBy || isCurrent ? <small className="mt-0.5 text-xs font-extrabold leading-none">{usedBy ? `${usedBy.sessionIndex}회차` : "지금"}</small> : null}
                            </button>;
                        })}
                    </div>
                    <div data-component={child("calendar_legend")} className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-v3-text-muted">
                        {context.startDate && context.endDate && <span data-component={child("calendar_legend_period")}><i aria-hidden="true" className="mr-1 inline-block h-3 w-3 rounded align-middle border-[1.5px] border-v3-primary!" />서비스 기간 ({context.startDate.slice(5, 10).replace("-", ".")}~{context.endDate.slice(5, 10).replace("-", ".")})</span>}
                        <span><i aria-hidden="true" className="mr-1 inline-block h-3 w-3 rounded bg-v3-primary align-middle" />선택한 날</span>
                        <span><i aria-hidden="true" className="mr-1 inline-block h-3 w-3 rounded border border-v3-border align-middle" />선택 가능</span>
                        <span><i aria-hidden="true" className={cn("mr-1 inline-block h-3 w-3 rounded border align-middle", HATCHED)} />고를 수 없음 (주말·기간 밖·다른 회차·회차 순서)</span>
                    </div>
                </div>
                <div data-component={child("actions")} className="flex shrink-0 gap-2 border-t border-v3-border px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] [&>*]:flex-1">
                    <Button className="text-base" data-component={child("actions_cancel")} type="button" variant="v3-outline" size="md" onClick={onClose}>취소</Button>
                    <Button className="text-base" data-component={child("actions_select")} type="button" variant="v3" size="md" disabled={!canSelect} onClick={() => { if (canSelect) onSelect(selected); }}>선택</Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
