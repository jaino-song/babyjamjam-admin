"use client";

import { useMemo, useState } from "react";
import {
    Calendar,
    CalendarClock,
    CalendarPlus,
    ChevronLeft,
    ChevronRight,
    RefreshCcw,
} from "lucide-react";

import type { Client } from "@/lib/client/types";
import { useAllClients } from "@/hooks/useClients";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import {
    AnimatedSlotList,
    AnimatedSlotListItemContent,
    DetailPanel,
    DetailTabs,
    DetailTabPanels,
    SlidingDetailPanel,
    ListEmptyState,
    ListPanel,
} from "@/components/app/v3";
import { StatusPill } from "@/components/app/ui/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ClientDetailPanel } from "@/components/app/clients/ClientDetailPanel";
import { cn } from "@/lib/utils";

export type ScheduleKind = "start" | "end" | "replacement";

export interface ScheduleEntry {
    id: string;
    clientId: number;
    clientName: string;
    employeeName: string | null;
    kind: ScheduleKind;
    dateISO: string;
    dateKey: string;
    dateLabel: string;
    title: string;
    meta: string;
}

export interface CalendarDay {
    date: Date;
    dateKey: string;
    isCurrentMonth: boolean;
    isInHorizon: boolean;
}

export interface ScheduleMonthRange {
    minMonthKey: string;
    maxMonthKey: string;
    horizonStart: Date;
    horizonEnd: Date;
}

const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
    start: "서비스 시작",
    end: "서비스 종료",
    replacement: "교체 요청",
};

const SCHEDULE_KIND_VARIANTS = {
    start: "info",
    end: "warning",
    replacement: "danger",
} as const;

const SCHEDULE_KIND_ICONS = {
    start: CalendarPlus,
    end: CalendarClock,
    replacement: RefreshCcw,
} as const;

const SCHEDULE_KIND_MARKER_CLASSES: Record<ScheduleKind, string> = {
    start: "border-l-v3-primary text-v3-primary",
    end: "border-l-v3-text-muted text-v3-dark",
    replacement: "border-l-v3-burgundy text-v3-burgundy",
};

const VIEW_TABS = [
    { key: "calendar", label: "달력" },
    { key: "list", label: "목록" },
] as const;

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function startOfDay(value: Date) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
}

function dateKey(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function monthKey(value: Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function startOfMonth(value: Date) {
    const date = startOfDay(value);
    date.setDate(1);
    return date;
}

function addDays(value: Date, amount: number) {
    const date = new Date(value);
    date.setDate(date.getDate() + amount);
    return startOfDay(date);
}

function parseScheduleDate(value: string | null | undefined) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return startOfDay(date);
}

function dateFromKey(value: string) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
}

function clientEmployeeMeta(client: Client) {
    return client.primaryEmployee?.name ? `${client.primaryEmployee.name} 담당` : "제공인력 미배정";
}

function employeeName(client: Client) {
    return client.primaryEmployee?.name ?? null;
}

function formatScheduleDate(date: Date) {
    return formatDateForDisplay(date, "-");
}

function formatMonthLabel(date: Date) {
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

function formatFullDate(date: Date) {
    return new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
    }).format(date);
}

function formatSelectedDate(date: Date) {
    return new Intl.DateTimeFormat("ko-KR", {
        month: "long",
        day: "numeric",
        weekday: "long",
    }).format(date);
}

function getScheduleHorizon(now: Date) {
    const horizonStart = startOfDay(now);
    const horizonEnd = new Date(horizonStart);
    // Clamp leap day to February's final day in the following year.
    const targetYear = horizonStart.getFullYear() + 1;
    const month = horizonStart.getMonth();
    const lastDay = new Date(targetYear, month + 1, 0).getDate();
    horizonEnd.setFullYear(targetYear, month, Math.min(horizonStart.getDate(), lastDay));
    horizonEnd.setHours(23, 59, 59, 999);
    return { horizonStart, horizonEnd };
}

export function getScheduleMonthRange(now: Date = new Date()): ScheduleMonthRange {
    const { horizonStart, horizonEnd } = getScheduleHorizon(now);
    return {
        minMonthKey: monthKey(horizonStart),
        maxMonthKey: monthKey(horizonEnd),
        horizonStart,
        horizonEnd,
    };
}

export function buildMonthCalendarDays(
    month: Date,
    horizonStart: Date,
    horizonEnd: Date,
): CalendarDay[] {
    const monthStart = startOfMonth(month);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const gridStart = addDays(monthStart, -monthStart.getDay());
    const gridEnd = addDays(monthEnd, 6 - monthEnd.getDay());
    const normalizedHorizonStart = startOfDay(horizonStart);
    const normalizedHorizonEnd = startOfDay(horizonEnd);
    const days: CalendarDay[] = [];

    for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) {
        const currentDate = startOfDay(cursor);
        days.push({
            date: currentDate,
            dateKey: dateKey(currentDate),
            isCurrentMonth: currentDate.getMonth() === monthStart.getMonth() &&
                currentDate.getFullYear() === monthStart.getFullYear(),
            isInHorizon: currentDate >= normalizedHorizonStart && currentDate <= normalizedHorizonEnd,
        });
    }

    return days;
}

function canNavigateToMonth(month: Date, range: ScheduleMonthRange) {
    const key = monthKey(month);
    return key >= range.minMonthKey && key <= range.maxMonthKey;
}

function moveMonth(month: Date, amount: number) {
    return new Date(month.getFullYear(), month.getMonth() + amount, 1);
}

/**
 * Build schedule events for the next 12 calendar months from live client data.
 * Replacement requests are surfaced on today; service dates are included only
 * while they fall inside the upcoming horizon.
 */
export function buildScheduleEntries(clients: Client[], now: Date = new Date()): ScheduleEntry[] {
    const { horizonStart: today, horizonEnd: horizon } = getScheduleHorizon(now);
    const entries: ScheduleEntry[] = [];

    for (const client of clients) {
        const caregiver = employeeName(client);
        const meta = clientEmployeeMeta(client);

        if (client.serviceStatus === "replacement_requested") {
            entries.push({
                id: `${client.id}-replacement`,
                clientId: client.id,
                clientName: client.name,
                employeeName: caregiver,
                kind: "replacement",
                dateISO: today.toISOString(),
                dateKey: dateKey(today),
                dateLabel: formatScheduleDate(today),
                title: `${client.name} 교체 요청`,
                meta,
            });
        }

        const startDate = parseScheduleDate(client.startDate);
        if (startDate && client.serviceStatus !== "terminated" && startDate >= today && startDate <= horizon) {
            entries.push({
                id: `${client.id}-start`,
                clientId: client.id,
                clientName: client.name,
                employeeName: caregiver,
                kind: "start",
                dateISO: startDate.toISOString(),
                dateKey: dateKey(startDate),
                dateLabel: formatScheduleDate(startDate),
                title: `${client.name} 서비스 시작`,
                meta,
            });
        }

        const endDate = parseScheduleDate(client.endDate);
        if (endDate && client.serviceStatus === "active" && endDate >= today && endDate <= horizon) {
            entries.push({
                id: `${client.id}-end`,
                clientId: client.id,
                clientName: client.name,
                employeeName: caregiver,
                kind: "end",
                dateISO: endDate.toISOString(),
                dateKey: dateKey(endDate),
                dateLabel: formatScheduleDate(endDate),
                title: `${client.name} 서비스 종료`,
                meta,
            });
        }
    }

    return entries.sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

interface MonthControlsProps {
    visibleMonth: Date;
    range: ScheduleMonthRange;
    onMonthChange: (amount: number) => void;
    onToday: () => void;
}

function MonthControls({ visibleMonth, range, onMonthChange, onToday }: MonthControlsProps) {
    const canGoPrevious = canNavigateToMonth(moveMonth(visibleMonth, -1), range);
    const canGoNext = canNavigateToMonth(moveMonth(visibleMonth, 1), range);

    return (
        <div data-slot="month-controls" className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[calc(11.2px*var(--glint-ui-scale,1))] text-v3-text-muted">
                범위: 오늘부터 12개월 후까지
            </span>
            <div className="flex items-center gap-1">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="이전 달"
                    disabled={!canGoPrevious}
                    onClick={() => onMonthChange(-1)}
                >
                    <ChevronLeft aria-hidden="true" />
                    <span className="sr-only">이전 달</span>
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={onToday}>
                    오늘
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="다음 달"
                    disabled={!canGoNext}
                    onClick={() => onMonthChange(1)}
                >
                    <ChevronRight aria-hidden="true" />
                    <span className="sr-only">다음 달</span>
                </Button>
            </div>
        </div>
    );
}

interface CalendarGridProps {
    dataComponent: string;
    visibleMonth: Date;
    today: Date;
    calendarDays: CalendarDay[];
    entriesByDate: Map<string, ScheduleEntry[]>;
    selectedDateKey: string;
    onDateSelect: (day: CalendarDay) => void;
}

function CalendarGrid({
    dataComponent,
    visibleMonth,
    today,
    calendarDays,
    entriesByDate,
    selectedDateKey,
    onDateSelect,
}: CalendarGridProps) {
    const todayKey = dateKey(today);

    return (
        <div
            data-component={`${dataComponent}_grid`}
            data-slot="calendar-grid"
            role="group"
            aria-label={`${formatMonthLabel(visibleMonth)} 일정 달력`}
            className="flex min-h-0 flex-col gap-2"
        >
            <div
                data-component={`${dataComponent}_weekdays`}
                data-slot="calendar-weekdays"
                className="grid grid-cols-7 gap-2"
            >
                {WEEKDAY_LABELS.map((label) => (
                    <span
                        key={label}
                        className="text-center text-[calc(11.2px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted"
                    >
                        {label}
                    </span>
                ))}
            </div>
            <div className="grid min-h-0 grid-cols-7 gap-2" data-slot="calendar-days">
                {calendarDays.map((day) => {
                    const entries = entriesByDate.get(day.dateKey) ?? [];
                    const isSelected = selectedDateKey === day.dateKey;
                    const isToday = todayKey === day.dateKey;
                    const state = !day.isInHorizon
                        ? "outside-horizon"
                        : isSelected
                            ? "selected"
                            : isToday
                                ? "today"
                                : "available";

                    return (
                        <Button
                            key={day.dateKey}
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={formatFullDate(day.date)}
                            aria-current={isToday ? "date" : undefined}
                            aria-pressed={isSelected}
                            disabled={!day.isInHorizon}
                            data-component={`${dataComponent}_day`}
                            data-slot="calendar-day"
                            data-date={day.dateKey}
                            data-state={state}
                            onClick={() => onDateSelect(day)}
                            className={cn(
                                "h-auto min-h-[calc(92px*var(--glint-ui-scale,1))] w-full flex-col items-stretch justify-start gap-2 rounded-[10px] border p-2 text-left shadow-none",
                                day.isCurrentMonth ? "bg-white" : "bg-v3-dim-white/45 text-v3-text-muted",
                                isSelected && "border-v3-primary bg-v3-primary-light text-v3-dark",
                                isToday && !isSelected && "ring-2 ring-v3-primary/25 ring-offset-1",
                                !day.isInHorizon && "cursor-not-allowed border-v3-border/50 bg-v3-dim-white/65 opacity-55",
                            )}
                        >
                            <span className="flex items-center justify-between gap-1 text-[calc(12px*var(--glint-ui-scale,1))] font-semibold">
                                <span>{day.date.getDate()}</span>
                                {isToday ? (
                                    <span className="text-[calc(10.4px*var(--glint-ui-scale,1))] font-semibold text-v3-primary">
                                        오늘
                                    </span>
                                ) : null}
                            </span>
                            <span data-slot="calendar-events" className="min-h-0 space-y-1 overflow-hidden">
                                {entries.slice(0, 2).map((entry) => (
                                    <span
                                        key={entry.id}
                                        title={`${SCHEDULE_KIND_LABELS[entry.kind]} · ${entry.clientName}`}
                                        className={cn(
                                            "block truncate border-l-2 pl-1 text-[calc(10.4px*var(--glint-ui-scale,1))] font-medium leading-4",
                                            SCHEDULE_KIND_MARKER_CLASSES[entry.kind],
                                        )}
                                    >
                                        {SCHEDULE_KIND_LABELS[entry.kind]} · {entry.clientName}
                                    </span>
                                ))}
                                {entries.length > 2 ? (
                                    <span className="block truncate text-[calc(10.4px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">
                                        +{entries.length - 2}건 더보기
                                    </span>
                                ) : null}
                            </span>
                        </Button>
                    );
                })}
            </div>
        </div>
    );
}

interface ScheduleEntryListProps {
    dataComponent: string;
    entries: ScheduleEntry[];
    selectedEntryId: string | null;
    onEntrySelect: (entry: ScheduleEntry) => void;
}

function ScheduleEntryList({ dataComponent, entries, selectedEntryId, onEntrySelect }: ScheduleEntryListProps) {
    return (
        <div data-component={`${dataComponent}_container`} data-slot="schedule-entry-list">
            <AnimatedSlotList<ScheduleEntry>
                data-component={`${dataComponent}_list`}
                items={entries}
                isLoading={false}
                itemDataComponent={`${dataComponent}_row`}
                onSlotClick={onEntrySelect}
                getItemKey={(entry) => entry.id}
                getSlotState={({ item, isLoading }) => ({
                    isActive: !isLoading && item?.id === selectedEntryId,
                    isInteractive: !isLoading && Boolean(item),
                })}
                render={({ item }) => {
                    if (!item) return null;
                    const Icon = SCHEDULE_KIND_ICONS[item.kind];
                    return (
                        <AnimatedSlotListItemContent
                            dataComponent={`${dataComponent}_item`}
                            icon={Icon}
                            title={item.clientName}
                            subtitle={`${item.dateLabel} · ${item.meta}`}
                            status={<StatusPill variant={SCHEDULE_KIND_VARIANTS[item.kind]}>{SCHEDULE_KIND_LABELS[item.kind]}</StatusPill>}
                        />
                    );
                }}
            />
        </div>
    );
}

export interface EmployeeScheduleManagerProps {
    "data-component"?: string;
}

export function EmployeeScheduleManager({
    "data-component": dataComponent = "desktop_employees-schedule_manager",
}: EmployeeScheduleManagerProps) {
    const component = (suffix: string) => `${dataComponent}_${suffix}`;
    const today = useMemo(() => startOfDay(new Date()), []);
    const range = useMemo(() => getScheduleMonthRange(today), [today]);
    const [viewMode, setViewMode] = useState<(typeof VIEW_TABS)[number]["key"]>("calendar");
    const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(today));
    const [selectedDateKey, setSelectedDateKey] = useState(() => dateKey(today));
    const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const { data, isLoading, isError, refetch } = useAllClients();
    const entries = useMemo(() => buildScheduleEntries(data ?? [], today), [data, today]);
    const entriesByDate = useMemo(() => {
        const grouped = new Map<string, ScheduleEntry[]>();
        for (const entry of entries) {
            const dateEntries = grouped.get(entry.dateKey) ?? [];
            dateEntries.push(entry);
            grouped.set(entry.dateKey, dateEntries);
        }
        return grouped;
    }, [entries]);
    const selectedDate = dateFromKey(selectedDateKey);
    const selectedDateEntries = entriesByDate.get(selectedDateKey) ?? [];
    const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? null;
    const selectedClient = data?.find((client) => client.id === selectedEntry?.clientId) ?? null;
    const calendarDays = useMemo(
        () => buildMonthCalendarDays(visibleMonth, range.horizonStart, range.horizonEnd),
        [range.horizonEnd, range.horizonStart, visibleMonth],
    );

    const handleDateSelect = (day: CalendarDay) => {
        if (!day.isInHorizon) return;
        setSelectedDateKey(day.dateKey);
        setSelectedEntryId(null);
        setIsDetailOpen(false);
    };

    const handleEntrySelect = (entry: ScheduleEntry) => {
        setSelectedDateKey(entry.dateKey);
        setSelectedEntryId(entry.id);
        setIsDetailOpen(true);
    };

    const handleToday = () => {
        setVisibleMonth(startOfMonth(today));
        setSelectedDateKey(dateKey(today));
        setSelectedEntryId(null);
        setIsDetailOpen(false);
    };

    const handleMonthChange = (amount: number) => {
        const nextMonth = moveMonth(visibleMonth, amount);
        if (canNavigateToMonth(nextMonth, range)) setVisibleMonth(nextMonth);
    };

    const monthControls = (
        <MonthControls
            visibleMonth={visibleMonth}
            range={range}
            onMonthChange={handleMonthChange}
            onToday={handleToday}
        />
    );

    return (
        <section
            data-component={dataComponent}
            data-slot="employee-schedule-manager"
            className="flex h-full min-h-0 flex-1 flex-col gap-[calc(16px*var(--glint-ui-scale,1))]"
        >
            <header
                data-component={component("header")}
                data-slot="schedule-header"
                className="shrink-0 px-[calc(4px*var(--glint-ui-scale,1))] pt-[calc(4px*var(--glint-ui-scale,1))]"
            >
                <h1 className="text-[calc(22px*var(--glint-ui-scale,1))] font-bold text-v3-dark">서비스 일정</h1>
                <p className="mt-1 text-[calc(13px*var(--glint-ui-scale,1))] text-v3-text-muted">
                    오늘부터 12개월간의 서비스 시작·종료·교체 요청을 확인합니다.
                </p>
            </header>

            <div data-component={component("view-tabs")} data-slot="view-tabs" className="shrink-0">
                <DetailTabs
                    tabs={[...VIEW_TABS]}
                    activeTab={viewMode}
                    onTabChange={(key) => setViewMode(key as (typeof VIEW_TABS)[number]["key"])}
                    ariaLabel="일정 보기 방식"
                    idPrefix={`${dataComponent}-view`}
                />
            </div>

            {isLoading ? (

                <div
                    data-component={component("loading")}
                    data-slot="schedule-loading"
                    className="flex min-h-0 flex-1 items-center justify-center rounded-[28px] bg-white text-sm text-v3-text-muted shadow-v3"
                    role="status"
                    aria-label="일정 로딩 중"
                >
                    일정 불러오는 중…
                </div>
            ) : isError ? (
                <Alert data-component={component("error")} data-slot="schedule-error" variant="destructive" className="shrink-0">
                    <AlertTitle>일정을 불러오지 못했습니다</AlertTitle>
                    <AlertDescription>
                        잠시 후 다시 시도해 주세요.
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            data-component={component("error_retry")}
                            onClick={() => void refetch()}
                        >
                            다시 시도
                        </Button>
                    </AlertDescription>
                </Alert>
            ) : (
                <div
                    data-component={component("workspace")}
                    data-slot="schedule-workspace"
                    className="grid min-h-0 flex-1 grid-cols-1 gap-[calc(16px*var(--glint-ui-scale,1))] overflow-hidden lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:grid-rows-1"
                >
                    <DetailTabPanels
                        data-component={component("view-panels")}
                        activeTab={viewMode}
                        idPrefix={`${dataComponent}-view`}
                        className="h-full min-h-0 min-w-0"
                        trackClassName="h-full"
                        panelClassName="h-full"
                        panels={[
                            { key: "calendar", children: (
                                <ListPanel
                                    data-component={component("calendar-panel")}
                                    title={formatMonthLabel(visibleMonth)}
                                    subtitle="날짜를 선택하면 오른쪽에서 일정을 확인합니다."
                                    headerPadding="compact"
                                    subHeader={monthControls}
                                >
                                    <div key={monthKey(visibleMonth)} data-slot="schedule-content-enter" className="schedule-content-enter">
                                        <CalendarGrid
                                            dataComponent={component("calendar")}
                                            visibleMonth={visibleMonth}
                                            today={today}
                                            calendarDays={calendarDays}
                                            entriesByDate={entriesByDate}
                                            selectedDateKey={selectedDateKey}
                                            onDateSelect={handleDateSelect}
                                        />
                                    </div>
                                </ListPanel>
                            ) },
                            { key: "list", children: (
                                <ListPanel
                                    data-component={component("list-panel")}
                                    title="전체 일정"
                                    subtitle={`${formatScheduleDate(range.horizonStart)} ~ ${formatScheduleDate(range.horizonEnd)} · ${entries.length}건`}
                                    headerPadding="compact"
                                >
                                    {entries.length > 0 ? (
                                        <ScheduleEntryList dataComponent={component("list")} entries={entries}
                                            selectedEntryId={selectedEntryId} onEntrySelect={handleEntrySelect} />
                                    ) : <ListEmptyState icon={Calendar} message="앞으로 12개월 일정이 없습니다." />}
                                </ListPanel>
                            ) },
                        ]}
                    />

                    <SlidingDetailPanel
                        data-component={component("agenda-panel_sliding-detail")}
                        open={isDetailOpen && Boolean(selectedClient)}
                        onBack={() => setIsDetailOpen(false)}
                        backLabel="서비스 일정으로 돌아가기"
                        detail={selectedClient ? (
                            <ClientDetailPanel
                                key={selectedClient.id}
                                client={selectedClient}
                                trailing={null}
                                layout="mobile"
                                dataComponentPrefix={component("agenda-panel_sliding-detail_detail-pane_body_client")}
                                messageHistoryDataComponentPrefix={component("agenda-panel_sliding-detail_detail-pane_body_client_message-history")}
                                idPrefix={`${dataComponent}-client-${selectedClient.id}`}
                                tabsAriaLabel="고객 상세 정보"
                    />
                ) : null}
                list={(
                    <DetailPanel
                        data-component={component("agenda-panel")}
                        title={formatSelectedDate(selectedDate)}
                        subtitle="선택한 날짜의 서비스 일정"
                        trailing={(
                            <span data-slot="agenda-count" className="shrink-0 text-[calc(12px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">
                                {selectedDateEntries.length}건
                            </span>
                        )}
                        mainAnimationKey={selectedDateKey}
                    >
                        {selectedDateEntries.length > 0 ? (

                            <ScheduleEntryList
                                dataComponent={component("agenda")}
                                entries={selectedDateEntries}
                                selectedEntryId={selectedEntryId}
                                onEntrySelect={handleEntrySelect}
                            />
                        ) : (
                            <ListEmptyState icon={CalendarClock} message="선택한 날짜의 일정이 없습니다." />
                        )}
                    </DetailPanel>
                )}
                    />
                </div>
            )}
        </section>
    );
}
