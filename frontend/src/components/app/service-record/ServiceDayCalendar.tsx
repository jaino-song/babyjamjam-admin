"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";

const SOURCE_COMPONENT = "ServiceDayCalendar";
const TEXT = "clients.service-record-schedule";

export type ServiceDayCellState =
    | "before-start"
    | "unavailable"
    | "selected"
    /** A selected day that cannot be removed (it sits at or before a written session). */
    | "fixed"
    /** A service day left out of the schedule. */
    | "skipped"
    | "available";

export interface ServiceDayCell {
    state: ServiceDayCellState;
    /** 1-based session number for a selected day. */
    order: number | null;
    /** Not a plain weekday: a weekend or a public holiday. */
    extra: boolean;
    /** A public holiday on a weekday. */
    holiday: boolean;
}

export interface ServiceDayCalendarProps {
    /** The month on show. */
    year: number;
    /** 1-12. */
    month: number;
    canGoPrevious: boolean;
    canGoNext: boolean;
    onPrevious: () => void;
    onNext: () => void;
    describeDay: (iso: string) => ServiceDayCell;
    onSelectDay: (iso: string) => void;
    "data-component": string;
}

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

function isoOf(year: number, month: number, day: number): string {
    return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}

const CELL_BASE = "relative flex aspect-[1/0.78] min-w-0 flex-col items-center justify-center rounded-[10px] border-[1.35px] p-0 text-xs font-bold leading-none";

const CELL_STYLE: Record<ServiceDayCellState, string> = {
    "before-start": "border-v3-border bg-v3-dim-white text-v3-text-muted/60",
    unavailable: "border-v3-border bg-[repeating-linear-gradient(135deg,#fff_0_5px,hsl(214_20%_96%)_5px_10px)] text-v3-text-muted/70",
    selected: "cursor-pointer border-v3-primary bg-v3-primary text-white hover:brightness-110",
    fixed: "cursor-default border-v3-primary bg-v3-primary text-white",
    skipped: "cursor-pointer border-dashed border-v3-orange bg-white text-v3-orange hover:bg-v3-orange-light",
    available: "cursor-pointer border-v3-border bg-white text-v3-dark hover:border-v3-primary hover:bg-v3-primary-light",
};

/**
 * One month of a service-day picker. Presentational only: the caller decides what
 * each day is and what a tap does. A selected weekend or holiday is drawn green,
 * a selected plain weekday blue, a service day left out dashed.
 */
export function ServiceDayCalendar({
    year,
    month,
    canGoPrevious,
    canGoNext,
    onPrevious,
    onNext,
    describeDay,
    onSelectDay,
    "data-component": dataComponent,
}: ServiceDayCalendarProps) {
    const locale = useLocale();
    const dateLocale = locale === "en" ? "en-US" : "ko-KR";
    const weekdayFormat = new Intl.DateTimeFormat(dateLocale, { weekday: "short", timeZone: "UTC" });
    const weekdayName = (weekday: number) => weekdayFormat.format(new Date(Date.UTC(2023, 0, 1 + weekday)));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const leadingBlanks = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const dayLabel = (iso: string) => {
        const date = new Date(`${iso}T00:00:00Z`);
        return `${date.getUTCMonth() + 1}/${date.getUTCDate()}(${weekdayName(date.getUTCDay())})`;
    };

    return (
        <div data-component={dataComponent} data-source-component={SOURCE_COMPONENT} className="flex flex-col gap-2">
            <div data-component={`${dataComponent}_header`} className="flex items-center justify-between">
                <div
                    data-component={`${dataComponent}_header_title`}
                    aria-live="polite"
                    className="text-sm font-extrabold text-v3-dark"
                >
                    {t(locale, `${TEXT}.month-title`).replace("{year}", String(year)).replace("{month}", String(month))}
                </div>
                <div data-component={`${dataComponent}_header_nav`} className="flex gap-1.5">
                    <Button
                        type="button"
                        variant="neutral"
                        size="icon"
                        className="h-8 w-8 rounded-[10px]"
                        data-component={`${dataComponent}_header_nav_previous`}
                        aria-label={t(locale, `${TEXT}.prev-month`)}
                        disabled={!canGoPrevious}
                        onClick={onPrevious}
                    >
                        <ChevronLeft aria-hidden="true" />
                    </Button>
                    <Button
                        type="button"
                        variant="neutral"
                        size="icon"
                        className="h-8 w-8 rounded-[10px]"
                        data-component={`${dataComponent}_header_nav_next`}
                        aria-label={t(locale, `${TEXT}.next-month`)}
                        disabled={!canGoNext}
                        onClick={onNext}
                    >
                        <ChevronRight aria-hidden="true" />
                    </Button>
                </div>
            </div>

            <div data-component={`${dataComponent}_grid`} role="group" className="grid grid-cols-7 gap-1">
                {Array.from({ length: 7 }, (_, weekday) => (
                    <div
                        key={weekday}
                        data-slot="weekday"
                        className={cn(
                            "py-1 text-center text-[10.5px] font-extrabold text-v3-text-muted",
                            weekday === 0 && "text-v3-burgundy",
                            weekday === 6 && "text-v3-primary",
                        )}
                    >
                        {weekdayName(weekday)}
                    </div>
                ))}
                {Array.from({ length: leadingBlanks }, (_, index) => (
                    <div key={`blank-${index}`} aria-hidden="true" />
                ))}
                {Array.from({ length: daysInMonth }, (_, index) => {
                    const day = index + 1;
                    const iso = isoOf(year, month, day);
                    const cell = describeDay(iso);
                    const interactive = cell.state !== "before-start" && cell.state !== "unavailable";
                    const isSession = cell.state === "selected" || cell.state === "fixed";
                    const label = dayLabel(iso);
                    const ariaLabel = isSession
                        ? t(locale, `${TEXT}.${cell.state === "fixed" ? "day-session-fixed" : "day-session-removable"}`)
                            .replace("{date}", label)
                            .replace("{order}", String(cell.order ?? ""))
                        : t(locale, `${TEXT}.day-open`).replace("{date}", label);
                    return (
                        <button
                            key={iso}
                            type="button"
                            data-slot="day"
                            data-date={iso}
                            data-state={cell.state}
                            disabled={!interactive}
                            aria-pressed={interactive ? isSession : undefined}
                            aria-label={interactive ? ariaLabel : label}
                            className={cn(
                                CELL_BASE,
                                CELL_STYLE[cell.state],
                                isSession && cell.extra && "border-v3-green bg-v3-green",
                            )}
                            onClick={() => onSelectDay(iso)}
                        >
                            {isSession && cell.order !== null ? (
                                <span aria-hidden="true" className="absolute left-1.5 top-1 text-[8.5px] font-extrabold opacity-75 max-sm:hidden">
                                    {cell.order}
                                </span>
                            ) : null}
                            <span>{day}</span>
                            {cell.holiday ? (
                                <small className="mt-0.5 text-[8.5px] font-extrabold leading-none">{t(locale, `${TEXT}.holiday-label`)}</small>
                            ) : null}
                        </button>
                    );
                })}
            </div>

            <div
                data-component={`${dataComponent}_legend`}
                className="mt-2 flex flex-wrap gap-3 text-[11px] font-bold text-v3-text-muted"
            >
                <span>
                    <i aria-hidden="true" className="mr-1.5 inline-block size-3 rounded bg-v3-primary align-[-2px]" />
                    {t(locale, `${TEXT}.legend-weekday`)}
                </span>
                <span>
                    <i aria-hidden="true" className="mr-1.5 inline-block size-3 rounded bg-v3-green align-[-2px]" />
                    {t(locale, `${TEXT}.legend-extra`)}
                </span>
                <span>
                    <i aria-hidden="true" className="mr-1.5 inline-block size-3 rounded border-[1.35px] border-dashed border-v3-orange align-[-2px]" />
                    {t(locale, `${TEXT}.legend-skipped`)}
                </span>
                <span>
                    <i aria-hidden="true" className="mr-1.5 inline-block size-3 rounded border-[1.35px] border-v3-border align-[-2px]" />
                    {t(locale, `${TEXT}.legend-open`)}
                </span>
                <span>
                    <i aria-hidden="true" className="mr-1.5 inline-block size-3 rounded bg-[repeating-linear-gradient(135deg,#fff_0_3px,hsl(214_20%_88%)_3px_6px)] align-[-2px]" />
                    {t(locale, `${TEXT}.legend-unavailable`)}
                </span>
            </div>
        </div>
    );
}
