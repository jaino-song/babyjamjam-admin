"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";

import { ContentPaper } from "@/components/app/root/content-paper";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { isoDateInKorea } from "@/lib/date/business-days";
import { cn } from "@/lib/utils";
import {
  holidaySettingsApi,
  type HolidaySyncResponse,
  type HolidaySyncYearResult,
} from "@/services/holiday-settings";
import type { BranchHoliday, InactiveHolidayOverride } from "@/services/holidays";
import { getUserErrorMessage } from "@babyjamjam/shared";

import { HolidayAddForm } from "./HolidayAddForm";
import { HolidayInactiveOverrides } from "./HolidayInactiveOverrides";
import { HolidayList } from "./HolidayList";
import { HolidaySyncStrip } from "./HolidaySyncStrip";
import { formatHolidayDate } from "./holiday-format";

const SOURCE_COMPONENT = "HolidaySettingsSection";
const DATA_COMPONENT = "desktop_settings_sections_holidays";
const RATE_LIMITED_MESSAGE = "잠시 후 다시 시도해 주세요.";

interface HolidaySettingsSectionProps {
  branchId: string;
  branchName?: string | null;
}

/** This section's own cache entry. The calendar hook owns the `["holidays", ...]` prefix (a different data shape). */
function settingsQueryKey(branchId: string, year?: number) {
  return year === undefined
    ? (["holiday-settings", branchId] as const)
    : (["holiday-settings", branchId, year] as const);
}

function isRateLimited(error: unknown): boolean {
  return (error as { response?: { status?: number } } | null)?.response?.status === 429;
}

export function HolidaySettingsSection({ branchId, branchName }: HolidaySettingsSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const today = isoDateInKorea();
  const currentYear = Number(today.slice(0, 4));
  const years = [currentYear, currentYear + 1];

  const [year, setYear] = useState(currentYear);
  const [syncResults, setSyncResults] = useState<HolidaySyncYearResult[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const yearQuery = useQuery({
    queryKey: settingsQueryKey(branchId, year),
    queryFn: () => holidaySettingsApi.getYear(branchId, year),
  });

  async function refreshHolidays() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: settingsQueryKey(branchId) }),
      // The business-day calendar hook (`["holidays", branchId, year]`) must see the change too.
      queryClient.invalidateQueries({ queryKey: ["holidays", branchId] }),
    ]);
  }

  function reportError(error: unknown) {
    toast({ variant: "destructive", description: getUserErrorMessage(error) });
  }

  const addMutation = useMutation({
    mutationFn: (input: { date: string; name: string }) =>
      holidaySettingsApi.createOverride(branchId, { date: input.date, kind: "add", name: input.name }),
    onSuccess: async (_data, input) => {
      setYear(Number(input.date.slice(0, 4)));
      await refreshHolidays();
      toast({
        variant: "success",
        description: `${formatHolidayDate(input.date)} ${input.name}을 추가했어요.${branchName ? ` ${branchName}의 영업일 계산에 반영돼요.` : ""}`,
      });
    },
    onError: reportError,
  });

  const excludeMutation = useMutation({
    mutationFn: (holiday: BranchHoliday) =>
      holidaySettingsApi.createOverride(branchId, { date: holiday.date, kind: "exclude" }),
    onSuccess: async (_data, holiday) => {
      await refreshHolidays();
      toast({
        variant: "success",
        description: `${formatHolidayDate(holiday.date)} ${holiday.name}을 이 지점에서 제외했어요.`,
      });
    },
    onError: reportError,
  });

  const deleteMutation = useMutation({
    mutationFn: (input: { overrideId: string; message: string }) =>
      holidaySettingsApi.deleteOverride(branchId, input.overrideId),
    onSuccess: async (_data, input) => {
      await refreshHolidays();
      toast({ variant: "success", description: input.message });
    },
    onError: reportError,
  });

  const syncMutation = useMutation<HolidaySyncResponse, unknown>({
    mutationFn: () => holidaySettingsApi.syncNow(branchId),
    onMutate: () => {
      setSyncResults(null);
      setSyncError(null);
    },
    onSuccess: async (data) => {
      setSyncResults(data.results);
      await refreshHolidays();
    },
    onError: (error) => {
      setSyncError(isRateLimited(error) ? RATE_LIMITED_MESSAGE : getUserErrorMessage(error));
    },
  });

  const busy =
    addMutation.isPending || excludeMutation.isPending || deleteMutation.isPending || syncMutation.isPending;

  const data = yearQuery.data;
  const holidays = data?.holidays ?? [];
  // A past inactive override can no longer be deleted (HOLIDAY_DATE_IN_PAST), so it is not offered at all.
  const inactiveOverrides: InactiveHolidayOverride[] = (data?.inactiveOverrides ?? []).filter(
    (override) => override.date >= today,
  );
  const activeCount = holidays.filter((holiday) => !holiday.excluded).length;
  const excludedCount = holidays.length - activeCount;

  return (
    <section data-component={DATA_COMPONENT} data-source-component={SOURCE_COMPONENT}>
      <ContentPaper variant="v3">
        <div data-component={`${DATA_COMPONENT}_header`} className="mb-4 flex items-center gap-3">
          <div
            data-component={`${DATA_COMPONENT}_header_icon`}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-v3-burgundy/10"
          >
            <CalendarDays size={20} className="text-v3-burgundy" />
          </div>
          <div data-component={`${DATA_COMPONENT}_header_title-group`} className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-foreground">
              공휴일
              {branchName ? (
                <span
                  data-slot="holiday-branch-pill"
                  className="ml-2 rounded-full bg-v3-primary-light px-2 py-0.5 align-middle text-[11px] font-semibold text-v3-primary"
                >
                  {branchName}
                </span>
              ) : null}
            </h2>
            <p className="text-sm text-muted-foreground">
              계약 종료일과 서비스 일정의 영업일 계산에 쓰는 공휴일이에요.
            </p>
          </div>
        </div>
        <Separator className="mb-6" />

        <div data-component={`${DATA_COMPONENT}_content`} className="grid gap-4">
          <HolidaySyncStrip
            synced={data?.synced ?? false}
            lastSyncedAt={data?.lastSyncedAt ?? null}
            pending={syncMutation.isPending}
            disabled={busy}
            results={syncResults}
            errorMessage={syncError}
            onSync={() => syncMutation.mutate()}
          />

          <div data-slot="holiday-review-cards" />

          <div data-component={`${DATA_COMPONENT}_toolbar`} className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="연도" data-component={`${DATA_COMPONENT}_toolbar_year-tabs`} className="flex gap-1.5">
              {years.map((tabYear) => (
                <button
                  key={tabYear}
                  type="button"
                  role="tab"
                  aria-selected={tabYear === year}
                  data-slot="holiday-year-tab"
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-[13px] font-semibold tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-v3-primary focus-visible:ring-offset-2",
                    tabYear === year
                      ? "bg-v3-dark text-white"
                      : "bg-v3-dim-white text-v3-text-muted hover:text-v3-dark",
                  )}
                  onClick={() => setYear(tabYear)}
                >
                  {tabYear}
                </button>
              ))}
            </div>
            {data ? (
              <span data-slot="holiday-count" className="text-xs text-v3-text-muted">
                {`${year}년 공휴일 ${activeCount}일${excludedCount > 0 ? ` · 제외 ${excludedCount}일` : ""}`}
              </span>
            ) : null}
          </div>

          <HolidayAddForm
            today={today}
            years={years}
            pending={addMutation.isPending}
            onAdd={(input) => addMutation.mutateAsync(input)}
          />
          <p data-slot="holiday-scope-note" className="text-xs text-v3-text-muted">
            공공데이터 공휴일은 모든 지점에 똑같이 적용돼요. 여기서 추가하거나 제외한 날짜는{" "}
            {branchName ? <b>{branchName}에만</b> : "이 지점에만"} 적용돼요.
          </p>

          {yearQuery.isLoading ? (
            <div data-component={`${DATA_COMPONENT}_content_skeleton`} className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : yearQuery.isError ? (
            <p
              role="alert"
              data-component={`${DATA_COMPONENT}_content_error`}
              className="text-sm font-medium text-red-700"
            >
              공휴일 목록을 불러오지 못했어요.
            </p>
          ) : holidays.length === 0 ? (
            <p data-component={`${DATA_COMPONENT}_content_empty`} className="py-8 text-center text-sm text-v3-text-muted">
              {data?.supported === false
                ? "이 연도의 공휴일 정보가 아직 없어요."
                : "표시할 공휴일이 없어요."}
            </p>
          ) : (
            <HolidayList
              holidays={holidays}
              today={today}
              disabled={busy}
              onExclude={(holiday) => excludeMutation.mutate(holiday)}
              onRestore={(holiday) =>
                holiday.overrideId &&
                deleteMutation.mutate({
                  overrideId: holiday.overrideId,
                  message: `${formatHolidayDate(holiday.date)} ${holiday.name}을 다시 공휴일로 포함했어요.`,
                })
              }
              onDelete={(holiday) =>
                holiday.overrideId &&
                deleteMutation.mutate({
                  overrideId: holiday.overrideId,
                  message: `${formatHolidayDate(holiday.date)} ${holiday.name}을 삭제했어요.`,
                })
              }
            />
          )}

          <HolidayInactiveOverrides
            overrides={inactiveOverrides}
            disabled={busy}
            onDelete={(override) =>
              deleteMutation.mutate({
                overrideId: override.id,
                message: `${formatHolidayDate(override.date)} 지점 설정을 삭제했어요.`,
              })
            }
          />
        </div>
      </ContentPaper>
    </section>
  );
}
