"use client";

import { useMemo, useState } from "react";
import {
    Calendar,
    CalendarClock,
    CalendarPlus,
    RefreshCcw,
    Users,
} from "lucide-react";

import type { Client } from "@/lib/client/types";
import { useClients } from "@/hooks/useClients";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import {
    AnimatedSlotList,
    AnimatedSlotListItemContent,
    HeaderActionButton,
    InfoCard,
    InfoRow,
    ListEmptyState,
} from "@/components/app/v3";
import { ContentPaper } from "@/components/app/root/content-paper";
import { StatusPill } from "@/components/app/ui/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
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

function parseScheduleDate(value: string | null | undefined) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return startOfDay(date);
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

/**
 * Build the same 30-day schedule events used by mobile from live client data.
 * Replacement requests are surfaced on today; service dates are included only
 * while they fall inside the upcoming horizon.
 */
export function buildScheduleEntries(clients: Client[], now: Date = new Date()): ScheduleEntry[] {
    const today = startOfDay(now);
    const horizon = new Date(today);
    horizon.setDate(today.getDate() + 30);
    horizon.setHours(23, 59, 59, 999);

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

function buildCalendarDays(now: Date, count = 31) {
    const today = startOfDay(now);
    return Array.from({ length: count }, (_, index) => {
        const date = new Date(today);
        date.setDate(today.getDate() + index);
        return date;
    });
}

function ScheduleEntrySheet({
    entry,
    onOpenChange,
}: {
    entry: ScheduleEntry | null;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <Sheet open={Boolean(entry)} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="w-full overflow-y-auto sm:max-w-xl"
                data-component="desktop_employees-schedule_entry-detail_sheet"
            >
                <SheetHeader>
                    <SheetTitle>{entry?.clientName ?? "일정 상세"}</SheetTitle>
                    <SheetDescription>서비스 일정과 담당 제공인력을 확인합니다.</SheetDescription>
                </SheetHeader>
                {entry ? (
                    <div className="space-y-4 px-4 pb-6">
                        <InfoCard data-component="desktop_employees-schedule_entry-detail_info-card" title="일정 정보">
                            <InfoRow label="일정 유형" value={SCHEDULE_KIND_LABELS[entry.kind]} />
                            <InfoRow label="일정 날짜" value={entry.dateLabel} />
                            <InfoRow label="담당 제공인력" value={entry.employeeName ?? "제공인력 미배정"} />
                            <InfoRow label="고객" value={entry.clientName} />
                            <InfoRow
                                label="상태"
                                value={<StatusPill variant={SCHEDULE_KIND_VARIANTS[entry.kind]}>{SCHEDULE_KIND_LABELS[entry.kind]}</StatusPill>}
                            />
                        </InfoCard>
                        <SheetClose asChild>
                            <Button type="button" variant="outline" className="w-full">
                                닫기
                            </Button>
                        </SheetClose>
                    </div>
                ) : null}
            </SheetContent>
        </Sheet>
    );
}

export interface EmployeeScheduleManagerProps {
    "data-component"?: string;
}

export function EmployeeScheduleManager({
    "data-component": dataComponent = "desktop_employees-schedule_manager",
}: EmployeeScheduleManagerProps) {
    const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
    const today = useMemo(() => startOfDay(new Date()), []);
    const [selectedDateKey, setSelectedDateKey] = useState(() => dateKey(today));
    const [selectedEntry, setSelectedEntry] = useState<ScheduleEntry | null>(null);
    const { data, isLoading, isError, refetch } = useClients(1, 50);
    const entries = useMemo(() => buildScheduleEntries(data?.data ?? [], today), [data?.data, today]);
    const calendarDays = useMemo(() => buildCalendarDays(today), [today]);
    const entriesByDate = useMemo(() => {
        const grouped = new Map<string, ScheduleEntry[]>();
        for (const entry of entries) {
            const dateEntries = grouped.get(entry.dateKey) ?? [];
            dateEntries.push(entry);
            grouped.set(entry.dateKey, dateEntries);
        }
        return grouped;
    }, [entries]);

    const selectedDateEntries = entriesByDate.get(selectedDateKey) ?? [];

    const handleDateSelect = (nextDateKey: string) => {
        setSelectedDateKey(nextDateKey);
        const firstEntry = entriesByDate.get(nextDateKey)?.[0];
        if (firstEntry) setSelectedEntry(firstEntry);
    };

    return (
        <>
            <ContentPaper
                variant="v3"
                data-component={dataComponent}
                className="flex h-full min-h-0 flex-col overflow-hidden"
                contentClassName="flex min-h-0 flex-1 flex-col pt-0"
                header={(
                    <div
                        data-component={`${dataComponent}_header`}
                        className="flex flex-wrap items-center justify-between gap-3 border-b border-v3-border px-6 py-4"
                    >
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-v3-primary-light text-v3-primary">
                                <Calendar className="h-5 w-5" aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="text-lg font-bold text-v3-dark">제공인력 일정</h1>
                                <p className="text-sm text-v3-text-muted">앞으로 30일의 서비스 시작·종료와 교체 요청을 확인합니다.</p>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <HeaderActionButton
                                icon={Users}
                                label="직원 목록"
                                href="/employees"
                                variant="muted"
                                data-component={`${dataComponent}_header_employees-link`}
                            />
                            <StatusPill variant="primary">일정</StatusPill>
                        </div>
                    </div>
                )}
            >
                <div data-component={`${dataComponent}_content`} className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-5">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2" role="tablist" aria-label="일정 보기 방식">
                            <Button
                                type="button"
                                variant={viewMode === "calendar" ? "secondary" : "outline"}
                                size="sm"
                                role="tab"
                                aria-selected={viewMode === "calendar"}
                                data-component={`${dataComponent}_view-tabs_calendar`}
                                onClick={() => setViewMode("calendar")}
                            >
                                달력
                            </Button>
                            <Button
                                type="button"
                                variant={viewMode === "list" ? "secondary" : "outline"}
                                size="sm"
                                role="tab"
                                aria-selected={viewMode === "list"}
                                data-component={`${dataComponent}_view-tabs_list`}
                                onClick={() => setViewMode("list")}
                            >
                                목록
                            </Button>
                        </div>
                        <StatusPill variant="neutral">일정 {entries.length}건</StatusPill>
                    </div>

                    {isLoading ? (
                        <div className="flex min-h-0 flex-1 items-center justify-center" role="status" aria-label="일정 로딩 중">
                            불러오는 중...
                        </div>
                    ) : isError ? (
                        <Alert variant="destructive" data-component={`${dataComponent}_error`}>
                            <AlertTitle>일정을 불러오지 못했습니다</AlertTitle>
                            <AlertDescription>
                                잠시 후 다시 시도해 주세요.
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="mt-3"
                                    data-component={`${dataComponent}_error_retry`}
                                    onClick={() => void refetch()}
                                >
                                    다시 시도
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : viewMode === "calendar" ? (
                        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
                            <div className="grid grid-cols-7 gap-2" data-component={`${dataComponent}_calendar_weekdays`}>
                                {[
                                    "일",
                                    "월",
                                    "화",
                                    "수",
                                    "목",
                                    "금",
                                    "토",
                                ].map((label) => (
                                    <span key={label} className="text-center text-xs font-semibold text-v3-text-muted">{label}</span>
                                ))}
                            </div>
                            <div className="grid grid-cols-7 gap-2" data-component={`${dataComponent}_calendar_grid`}>
                                {calendarDays.map((day) => {
                                    const key = dateKey(day);
                                    const dateEntries = entriesByDate.get(key) ?? [];
                                    const isSelected = selectedDateKey === key;
                                    const isToday = key === dateKey(today);

                                    return (
                                        <Button
                                            key={key}
                                            type="button"
                                            variant={isSelected ? "secondary" : "outline"}
                                            size="sm"
                                            className={cn(
                                                "h-auto min-h-[calc(92px*var(--glint-ui-scale,1))] w-full flex-col items-stretch justify-start gap-2 p-2 text-left",
                                                isToday && "ring-1 ring-v3-primary/40",
                                            )}
                                            data-component={`${dataComponent}_calendar_day`}
                                            data-date={key}
                                            onClick={() => handleDateSelect(key)}
                                        >
                                            <span className="flex items-center justify-between gap-1 text-xs font-semibold">
                                                <span>{day.getDate()}</span>
                                                {isToday ? <StatusPill variant="primary" size="sm">오늘</StatusPill> : null}
                                            </span>
                                            <span className="flex min-w-0 flex-col items-stretch gap-1">
                                                {dateEntries.slice(0, 2).map((entry) => (
                                                    <StatusPill
                                                        key={entry.id}
                                                        variant={SCHEDULE_KIND_VARIANTS[entry.kind]}
                                                        size="sm"
                                                        className="max-w-full justify-start truncate"
                                                    >
                                                        {entry.title}
                                                    </StatusPill>
                                                ))}
                                                {dateEntries.length > 2 ? (
                                                    <StatusPill variant="neutral" size="sm">+{dateEntries.length - 2}</StatusPill>
                                                ) : null}
                                            </span>
                                        </Button>
                                    );
                                })}
                            </div>
                            <InfoCard data-component={`${dataComponent}_calendar_selected-date`} title={formatScheduleDate(new Date(`${selectedDateKey}T00:00:00`))}>
                                {selectedDateEntries.length > 0 ? (
                                    <AnimatedSlotList<ScheduleEntry>
                                        data-component={`${dataComponent}_calendar_selected-date_list`}
                                        items={selectedDateEntries}
                                        isLoading={false}
                                        itemDataComponent={`${dataComponent}_calendar_selected-date_row`}
                                        onSlotClick={(entry) => setSelectedEntry(entry)}
                                        getItemKey={(entry) => entry.id}
                                        render={({ item }) => {
                                            if (!item) return null;
                                            const Icon = SCHEDULE_KIND_ICONS[item.kind];
                                            return (
                                                <AnimatedSlotListItemContent
                                                    dataComponent={`${dataComponent}_calendar_selected-date_item`}
                                                    icon={Icon}
                                                    title={item.title}
                                                    subtitle={item.meta}
                                                    status={<StatusPill variant={SCHEDULE_KIND_VARIANTS[item.kind]}>{SCHEDULE_KIND_LABELS[item.kind]}</StatusPill>}
                                                />
                                            );
                                        }}
                                    />
                                ) : (
                                    <p className="py-4 text-center text-sm text-v3-text-muted">선택한 날짜의 일정이 없습니다.</p>
                                )}
                            </InfoCard>
                        </div>
                    ) : entries.length > 0 ? (
                        <div className="min-h-0 flex-1 overflow-y-auto">
                            <AnimatedSlotList<ScheduleEntry>
                                data-component={`${dataComponent}_list`}
                                items={entries}
                                isLoading={false}
                                itemDataComponent={`${dataComponent}_list_row`}
                                onSlotClick={(entry) => {
                                    setSelectedDateKey(entry.dateKey);
                                    setSelectedEntry(entry);
                                }}
                                getItemKey={(entry) => entry.id}
                                render={({ item }) => {
                                    if (!item) return null;
                                    const Icon = SCHEDULE_KIND_ICONS[item.kind];
                                    return (
                                        <AnimatedSlotListItemContent
                                            dataComponent={`${dataComponent}_list_item`}
                                            icon={Icon}
                                            title={item.title}
                                            subtitle={`${item.dateLabel} · ${item.meta}`}
                                            status={<StatusPill variant={SCHEDULE_KIND_VARIANTS[item.kind]}>{SCHEDULE_KIND_LABELS[item.kind]}</StatusPill>}
                                        />
                                    );
                                }}
                            />
                        </div>
                    ) : (
                        <ListEmptyState icon={Calendar} message="앞으로 30일 일정이 없습니다." />
                    )}
                </div>
            </ContentPaper>
            <ScheduleEntrySheet
                entry={selectedEntry}
                onOpenChange={(open) => {
                    if (!open) setSelectedEntry(null);
                }}
            />
        </>
    );
}
