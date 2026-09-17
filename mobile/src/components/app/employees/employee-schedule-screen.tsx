"use client";

import { useMemo, useState } from "react";
import { CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, RefreshCcw } from "lucide-react";

import { useClientDetailController } from "@/components/app/clients/client-detail-controller";
import { ListEmptyState } from "@/components/app/v3";
import { StatusPill } from "@/components/app/ui/status-badge";
import {
  ListCard,
  ListItemRow,
  ListRowsSkeleton,
} from "@/components/app/mobile-redesign/primitives";
import { DetailTabPills, MobileSearchBar } from "@/components/app/mobile-redesign/detail-sheet";
import { SlidingCard } from "@/components/app/mobile-redesign/sliding-card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import type { Client } from "@/lib/client/types";
import {
  buildMonthCalendarDays,
  buildScheduleEntries,
  canNavigateToMonth,
  dateFromKey,
  dateKey,
  filterScheduleEntries,
  formatFullDate,
  formatMonthLabel,
  formatSelectedDate,
  getScheduleMonthRange,
  moveMonth,
  SCHEDULE_KIND_FILTERS,
  SCHEDULE_KIND_LABELS,
  startOfDay,
  startOfMonth,
  WEEKDAY_LABELS,
  type CalendarDay,
  type ScheduleEntry,
  type ScheduleKind,
  type ScheduleKindFilter,
} from "./employee-schedule-model";
import styles from "./employee-schedule-screen.module.css";
import "@/components/app/mobile-redesign/redesign.css";

const VIEW_TABS = [
  { id: "calendar", label: "달력" },
  { id: "list", label: "목록" },
] as const;

const KIND_TONE: Record<ScheduleKind, "primary" | "orange" | "burgundy"> = {
  start: "primary",
  end: "orange",
  replacement: "burgundy",
};

const KIND_ICON: Record<ScheduleKind, typeof CalendarPlus> = {
  start: CalendarPlus,
  end: CalendarClock,
  replacement: RefreshCcw,
};

interface EmployeeScheduleScreenProps {
  "data-component"?: string;
}

interface ScheduleCalendarProps {
  dataComponent: string;
  visibleMonth: Date;
  today: Date;
  calendarDays: CalendarDay[];
  entriesByDate: Map<string, ScheduleEntry[]>;
  selectedDateKey: string;
  onDateSelect: (day: CalendarDay) => void;
}

function ScheduleCalendar({
  dataComponent,
  visibleMonth,
  today,
  calendarDays,
  entriesByDate,
  selectedDateKey,
  onDateSelect,
}: ScheduleCalendarProps) {
  const todayKey = dateKey(today);

  return (
    <div
      className={`${styles.calendar} flex min-h-0 flex-col gap-1`}
      data-component={dataComponent}
      data-slot="calendar-grid"
      role="group"
      aria-label={`${formatMonthLabel(visibleMonth)} 일정 달력`}
    >
      <div
        className="grid grid-cols-7 gap-1"
        data-component={`${dataComponent}_weekdays`}
        data-slot="calendar-weekdays"
      >
        {WEEKDAY_LABELS.map((label) => (
          <span
            key={label}
            className="py-1 text-center text-[0.68rem] font-semibold text-v3-text-muted"
          >
            {label}
          </span>
        ))}
      </div>
      <div className={`${styles.calendarDays} grid grid-cols-7`} data-slot="calendar-days">
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
              className={[
                `${styles.calendarDay} h-auto w-full flex-col items-stretch justify-start text-left shadow-none`,
                day.isCurrentMonth ? "bg-white" : "bg-v3-dim-white/45 text-v3-text-muted",
                isSelected ? "border-v3-primary bg-v3-primary-light text-v3-dark" : "",
                isToday && !isSelected ? "ring-2 ring-v3-primary/25 ring-offset-1" : "",
                !day.isInHorizon ? "cursor-not-allowed border-v3-border/50 bg-v3-dim-white/65 opacity-55" : "",
              ].filter(Boolean).join(" ")}
            >
              <span className="flex items-center justify-between gap-1 text-[0.72rem] font-semibold">
                <span>{day.date.getDate()}</span>
                {isToday ? <span className="text-[0.58rem] text-v3-primary">오늘</span> : null}
              </span>
              <span className={styles.eventDots} data-slot="calendar-events">
                {entries.slice(0, 3).map((entry) => (
                  <span
                    key={entry.id}
                    title={`${SCHEDULE_KIND_LABELS[entry.kind]} · ${entry.clientName}`}
                    className={`${styles.eventDot} ${entry.kind === "end" ? styles.eventDotEnd : ""} ${entry.kind === "replacement" ? styles.eventDotReplacement : ""}`}
                    data-kind={entry.kind}
                  />
                ))}
                {entries.length > 3 ? <span className={styles.eventCount}>+{entries.length - 3}</span> : null}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

interface ScheduleEntryRowsProps {
  dataComponent: string;
  entries: ScheduleEntry[];
  selectedEntryId: string | null;
  onEntrySelect: (entry: ScheduleEntry) => void;
  emptyMessage?: string;
}

function ScheduleEntryRows({
  dataComponent,
  entries,
  selectedEntryId,
  onEntrySelect,
  emptyMessage = "조회 기간의 일정이 없습니다.",
}: ScheduleEntryRowsProps) {
  if (entries.length === 0) {
    return <ListEmptyState name={`${dataComponent}_empty`} message={emptyMessage} />;
  }

  return (
    <div data-component={dataComponent} data-slot="schedule-entry-list">
      {entries.map((entry, index) => {
        const Icon = KIND_ICON[entry.kind];
        return (
          <ListItemRow
            key={entry.id}
            data-component={`${dataComponent}_row`}
            className={selectedEntryId === entry.id ? "bg-v3-primary-light" : undefined}
            style={{ animationDelay: `${Math.min(index, 4) * 40}ms` }}
            left={
              <span
                className={`list-avatar av-${KIND_TONE[entry.kind]}`}
                data-component={`${dataComponent}_row_icon`}
              >
                <Icon size={16} strokeWidth={2} />
              </span>
            }
            name={entry.clientName}
            meta={`${entry.dateLabel} · ${entry.meta}`}
            right={
              <StatusPill
                data-component={`${dataComponent}_row_status`}
                variant={entry.kind === "start" ? "primary" : entry.kind === "end" ? "warning" : "danger"}
              >
                {SCHEDULE_KIND_LABELS[entry.kind]}
              </StatusPill>
            }
            onClick={() => onEntrySelect(entry)}
          />
        );
      })}
    </div>
  );
}

function ScheduleMonthControls({
  dataComponent,
  visibleMonth,
  range,
  onMonthChange,
  onToday,
}: {
  dataComponent: string;
  visibleMonth: Date;
  range: ReturnType<typeof getScheduleMonthRange>;
  onMonthChange: (amount: number) => void;
  onToday: () => void;
}) {
  const canGoPrevious = canNavigateToMonth(moveMonth(visibleMonth, -1), range);
  const canGoNext = canNavigateToMonth(moveMonth(visibleMonth, 1), range);

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-1"
      data-component={dataComponent}
      data-slot="month-controls"
    >
      <span className={styles.range}>
        {formatDateForDisplay(range.horizonStart, ".")} ~ {formatDateForDisplay(range.horizonEnd, ".")}
      </span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="이전 달"
          disabled={!canGoPrevious}
          onClick={() => onMonthChange(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button type="button" variant="v3-outline" size="sm" onClick={onToday}>오늘</Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="다음 달"
          disabled={!canGoNext}
          onClick={() => onMonthChange(1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function EmployeeScheduleScreen({
  "data-component": dataComponent = "mobile_employees-schedule_screen_root",
}: EmployeeScheduleScreenProps) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const range = useMemo(() => getScheduleMonthRange(today), [today]);
  const initialDate = today < range.horizonStart ? range.horizonStart : today;
  const [viewMode, setViewMode] = useState<(typeof VIEW_TABS)[number]["id"]>("calendar");
  const [kindFilter, setKindFilter] = useState<ScheduleKindFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(initialDate));
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKey(initialDate));
  const [selectedEntry, setSelectedEntry] = useState<ScheduleEntry | null>(null);
  const [detailClientOverride, setDetailClientOverride] = useState<Client | null>(null);
  const { allClients, isLoading, isError, refetch } = useInfiniteClients();
  const entries = useMemo(() => buildScheduleEntries(allClients, today), [allClients, today]);
  const filteredEntries = useMemo(
    () => filterScheduleEntries(entries, kindFilter, searchQuery),
    [entries, kindFilter, searchQuery],
  );
  const entriesByDate = useMemo(() => {
    const grouped = new Map<string, ScheduleEntry[]>();
    for (const entry of filteredEntries) {
      const dateEntries = grouped.get(entry.dateKey) ?? [];
      dateEntries.push(entry);
      grouped.set(entry.dateKey, dateEntries);
    }
    return grouped;
  }, [filteredEntries]);
  const selectedDateEntries = entriesByDate.get(selectedDateKey) ?? [];
  const selectedClient = selectedEntry
    ? detailClientOverride?.id === selectedEntry.clientId
      ? detailClientOverride
      : allClients.find((client) => client.id === selectedEntry.clientId) ?? null
    : null;
  const detailController = useClientDetailController({
    client: selectedClient,
    clientId: selectedEntry?.clientId ?? null,
    dataComponent: `${dataComponent}_sliding-card_stage_detail-pane_body_client`,
    onClientUpdated: setDetailClientOverride,
  });
  const calendarDays = useMemo(
    () => buildMonthCalendarDays(visibleMonth, range.horizonStart, range.horizonEnd),
    [range.horizonEnd, range.horizonStart, visibleMonth],
  );

  const handleDateSelect = (day: CalendarDay) => {
    if (!day.isInHorizon) return;
    setSelectedDateKey(day.dateKey);
    setSelectedEntry(null);
    setDetailClientOverride(null);
  };

  const handleEntrySelect = (entry: ScheduleEntry) => {
    setSelectedDateKey(entry.dateKey);
    setSelectedEntry(entry);
    setDetailClientOverride(null);
  };

  const handleBack = () => {
    setSelectedEntry(null);
    setDetailClientOverride(null);
  };

  const handleToday = () => {
    setVisibleMonth(startOfMonth(initialDate));
    setSelectedDateKey(dateKey(initialDate));
    setSelectedEntry(null);
    setDetailClientOverride(null);
  };

  const handleMonthChange = (amount: number) => {
    const nextMonth = moveMonth(visibleMonth, amount);
    if (canNavigateToMonth(nextMonth, range)) setVisibleMonth(nextMonth);
  };

  const kindFilterItems = SCHEDULE_KIND_FILTERS.map((filter) => ({
    label: filter.label,
    count: filteredEntries.filter((entry) => filter.key === "all" || entry.kind === filter.key).length,
  }));
  const activeKindLabel = SCHEDULE_KIND_FILTERS.find((filter) => filter.key === kindFilter)?.label ?? "전체";

  const listBase = `${dataComponent}_sliding-card_stage_list-pane_content`;
  const cardBase = `${listBase}_${viewMode}-card`;

  const listPane = (
    <div
      className={`${styles.listPaneContent} relative`}
      data-component={listBase}
      data-slot="schedule-content"
    >
      <header className="shrink-0" data-component={`${listBase}_header`} data-slot="schedule-header">
        <h1 className="text-[1.25rem] font-bold text-v3-dark">서비스 일정</h1>
      </header>
      <DetailTabPills
        data-component={`${listBase}_view-tabs`}
        tabs={VIEW_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
        activeTab={viewMode}
        onTabChange={(tab) => setViewMode(tab as (typeof VIEW_TABS)[number]["id"])}
      />
      <ListCard
        key={viewMode}
        data-component={cardBase}
        className={styles.listCard}
        title={viewMode === "calendar" ? formatMonthLabel(visibleMonth) : "전체 일정"}
        count={viewMode === "calendar" ? undefined : `${filteredEntries.length}건`}
        filters={kindFilterItems}
        activeFilter={activeKindLabel}
        onFilterChange={(label) => {
          const next = SCHEDULE_KIND_FILTERS.find((filter) => filter.label === label);
          if (next) setKindFilter(next.key);
        }}
        beforeFilters={
          <div className={styles.toolbar} data-component={`${cardBase}_toolbar`}>
            <MobileSearchBar
              data-component={`${cardBase}_toolbar_search`}
              placeholder="고객 이름, 제공인력 검색"
              label="schedule"
              value={searchQuery}
              onChange={setSearchQuery}
            />
            {viewMode === "calendar" ? (
              <ScheduleMonthControls
                dataComponent={`${cardBase}_toolbar_month-controls`}
                visibleMonth={visibleMonth}
                range={range}
                onMonthChange={handleMonthChange}
                onToday={handleToday}
              />
            ) : null}
          </div>
        }
        loadMore={false}
      >
        {viewMode === "calendar" ? (
          <>
            <ScheduleCalendar
              dataComponent={`${cardBase}_body_calendar`}
              visibleMonth={visibleMonth}
              today={today}
              calendarDays={calendarDays}
              entriesByDate={entriesByDate}
              selectedDateKey={selectedDateKey}
              onDateSelect={handleDateSelect}
            />
            <section
              className={`${styles.agenda} section-block`}
              data-component={`${cardBase}_body_agenda`}
              data-slot="selected-day-agenda"
            >
              <div className="section-header flex items-center justify-between">
                <span>{formatSelectedDate(dateFromKey(selectedDateKey))}</span>
                <span className="text-v3-text-muted">{selectedDateEntries.length}건</span>
              </div>
              <ScheduleEntryRows
                dataComponent={`${cardBase}_body_agenda_rows`}
                entries={selectedDateEntries}
                selectedEntryId={selectedEntry?.id ?? null}
                onEntrySelect={handleEntrySelect}
                emptyMessage="선택한 날짜의 일정이 없습니다."
              />
            </section>
          </>
        ) : (
          <ScheduleEntryRows
            dataComponent={`${cardBase}_body_rows`}
            entries={filteredEntries}
            selectedEntryId={selectedEntry?.id ?? null}
            onEntrySelect={handleEntrySelect}
          />
        )}
      </ListCard>
    </div>
  );

  return (
    <section
      className="relative flex min-h-0 w-full flex-1 overflow-hidden"
      data-component={dataComponent}
      data-slot="employee-schedule-screen"
    >
      {isLoading ? (
        <div
          className="shell-content flex min-h-0 flex-1 flex-col"
          role="status"
          aria-label="일정 로딩 중"
          data-component={`${dataComponent}_loading`}
          data-slot="schedule-loading"
        >
          <ListCard
            data-component={`${dataComponent}_loading-card`}
            title="서비스 일정"
            filters={[]}
            loadMore={false}
          >
            <ListRowsSkeleton data-component={`${dataComponent}_loading-card_rows`} />
          </ListCard>
        </div>
      ) : isError ? (
        <div className="shell-content flex min-h-0 flex-1 flex-col" data-component={`${dataComponent}_error`}>
          <Alert variant="destructive" role="alert">
            <AlertTitle>일정을 불러오지 못했습니다</AlertTitle>
            <AlertDescription>
              잠시 후 다시 시도해 주세요.
              <Button
                type="button"
                variant="v3-outline"
                size="sm"
                className="mt-3"
                data-component={`${dataComponent}_error_retry`}
                onClick={() => void refetch()}
              >
                다시 시도
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <SlidingCard
          data-component={`${dataComponent}_sliding-card`}
          open={Boolean(selectedEntry && detailController.detailClient)}
          onBack={handleBack}
          backLabel="서비스 일정"
          detailKey={selectedEntry?.id ?? null}
          list={listPane}
          detail={detailController.detail}
        />
      )}
      {detailController.deleteModal}
    </section>
  );
}
