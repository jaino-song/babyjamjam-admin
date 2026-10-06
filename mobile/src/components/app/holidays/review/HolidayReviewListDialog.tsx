"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";

import { StatusBadge } from "@/components/app/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/app/ui/tabs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  holidayReviewApi,
  holidayReviewKeys,
  type HolidayReviewEvent,
  type HolidayReviewItemFilters,
  type HolidayReviewResolveAction,
} from "@/services/holiday-review";
import { getUserErrorMessage } from "@babyjamjam/shared";

import { HolidayReviewResultNotice } from "./HolidayReviewResultNotice";
import { describeReviewEvent, REVIEW_REASON_LABEL } from "./review-format";
import { useHolidayReviewResolve, type ReviewResolveSummary } from "./useHolidayReviewResolve";

const SOURCE_COMPONENT = "HolidayReviewListDialog";
const SEARCH_DEBOUNCE_MS = 300;
/** The backend caps `q` at 100 characters. */
const SEARCH_MAX_LENGTH = 100;

type FilterTab = "all" | "safe" | "risk";
const FILTER_TABS: readonly FilterTab[] = ["all", "safe", "risk"];

interface HolidayReviewListDialogProps {
  branchId: string;
  event: HolidayReviewEvent;
  onClose: () => void;
  dataComponent: string;
}

/** The clients behind one holiday change, as a bottom sheet: pick some, then fix their end date or keep it. */
export function HolidayReviewListDialog({
  branchId,
  event,
  onClose,
  dataComponent,
}: HolidayReviewListDialogProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [lastResult, setLastResult] = useState<ReviewResolveSummary | null>(null);
  const resolve = useHolidayReviewResolve(branchId);

  const filters: HolidayReviewItemFilters = {
    category: tab === "all" ? undefined : tab,
    status: "open",
    q: debouncedSearch || undefined,
  };
  const itemsQuery = useQuery({
    queryKey: holidayReviewKeys.items(branchId, event.id, filters),
    queryFn: () => holidayReviewApi.listItems(branchId, event.id, filters),
  });

  const rows = itemsQuery.data ?? [];
  // Only what is on screen can be acted on: a selection hidden by a filter or search is ignored.
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const someSelected = selectedRows.length > 0 && !allSelected;
  const hasRiskSelected = selectedRows.some((row) => row.category === "risk");
  const busy = resolve.isPending;

  function toggleAll(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of rows) {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  }

  function toggleRow(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function submit(action: HolidayReviewResolveAction) {
    if (selectedRows.length === 0) return;
    setLastResult(null);
    resolve.mutate(
      {
        eventId: event.id,
        action,
        selection: selectedRows.map((row) => ({ id: row.id, clientName: row.clientName })),
      },
      {
        onSuccess: (summary) => {
          setSelected(new Set());
          setLastResult(summary);
          if (summary.fixed > 0 || summary.kept > 0) {
            toast({
              variant: "success",
              description:
                action === "fix" ? `${summary.fixed}명 수정했어요.` : `${summary.kept}명은 그대로 두었어요.`,
            });
          }
        },
        onError: (error) => toast({ variant: "destructive", description: getUserErrorMessage(error) }),
      },
    );
  }

  const totalOpen = event.safeOpen + event.riskOpen;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        data-component={dataComponent}
        data-source-component={SOURCE_COMPONENT}
        className="h-[calc(100dvh-24px)] gap-0 rounded-t-3xl p-0"
      >
        <SheetHeader data-component={`${dataComponent}_header`} className="pr-12">
          <SheetTitle className="text-base leading-snug">{`${describeReviewEvent(event)} · 남은 고객 ${totalOpen}명`}</SheetTitle>
          <SheetDescription className="text-xs leading-relaxed">
            저장된 종료일과 다시 계산한 종료일이 달라요. 선택한 고객만 수정하거나 그대로 둘 수 있어요.
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as FilterTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div data-component={`${dataComponent}_tools`} className="grid gap-2 px-4 pb-3">
            <TabsList aria-label="분류" className="w-full">
              <TabsTrigger value="all" className="flex-1 px-1 text-xs">{`전체 ${totalOpen}`}</TabsTrigger>
              <TabsTrigger value="safe" className="flex-1 px-1 text-xs">{`바로 수정 가능 ${event.safeOpen}`}</TabsTrigger>
              <TabsTrigger value="risk" className="flex-1 px-1 text-xs">{`직접 확인 필요 ${event.riskOpen}`}</TabsTrigger>
            </TabsList>
            <Input
              type="search"
              value={search}
              placeholder="고객 이름 검색"
              aria-label="고객 이름 검색"
              autoComplete="off"
              maxLength={SEARCH_MAX_LENGTH}
              data-component={`${dataComponent}_tools_search`}
              onChange={(changeEvent) => setSearch(changeEvent.target.value)}
            />
          </div>

          {/* One panel per tab (kept mounted, hidden when inactive) so every trigger's aria-controls resolves. */}
          {FILTER_TABS.map((value) => (
            <TabsContent key={value} value={value} forceMount className="mt-0 min-h-0 flex-1 data-[state=inactive]:hidden">
              {value === tab ? (
                <div data-component={`${dataComponent}_body`} className="h-full overflow-y-auto px-4 pb-2">
                  {itemsQuery.isLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-16 w-full" />
                    </div>
                  ) : itemsQuery.isError ? (
                    <div
                      role="alert"
                      data-component={`${dataComponent}_body_error`}
                      className="grid gap-2 py-6 text-sm text-v3-burgundy"
                    >
                      <p>고객 목록을 불러오지 못했어요.</p>
                      <Button type="button" variant="outline" size="sm" onClick={() => void itemsQuery.refetch()}>
                        다시 시도
                      </Button>
                    </div>
                  ) : rows.length === 0 ? (
                    <p data-component={`${dataComponent}_body_empty`} className="py-8 text-center text-sm text-v3-text-muted">
                      해당하는 고객이 없어요.
                    </p>
                  ) : (
                    <div data-component={`${dataComponent}_body_list`} className="grid gap-2">
                      <label
                        data-component={`${dataComponent}_body_list_select-all`}
                        className="flex items-center gap-3 px-1 py-1 text-xs font-semibold text-v3-text-muted"
                      >
                        <Checkbox
                          className="h-5 w-5"
                          checked={someSelected ? "indeterminate" : allSelected}
                          aria-label="보이는 고객 모두 선택"
                          disabled={busy}
                          onCheckedChange={(checked) => toggleAll(checked === true)}
                        />
                        <span aria-hidden="true">전체 선택</span>
                      </label>
                      <ul className="grid gap-2">
                        {rows.map((row) => (
                          <li
                            key={row.id}
                            data-component={`${dataComponent}_body_list_row`}
                            data-slot="holiday-review-item"
                            data-category={row.category}
                            className="flex items-start gap-3 rounded-2xl border border-v3-border px-3.5 py-3 text-sm"
                          >
                            <Checkbox
                              className="mt-0.5 h-5 w-5"
                              checked={selected.has(row.id)}
                              aria-label={`${row.clientName} 선택`}
                              disabled={busy}
                              onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
                            />
                            <div className="grid min-w-0 flex-1 gap-1.5">
                              <span className="break-words font-semibold text-v3-dark">{row.clientName}</span>
                              <span className="text-xs tabular-nums">
                                <span className="text-v3-text-muted line-through">{row.storedEnd}</span>
                                {" → "}
                                <b>{row.recalculatedEnd}</b>
                              </span>
                              <span className="flex flex-wrap items-center gap-1.5">
                                <StatusBadge
                                  data-component={`${dataComponent}_body_list_row_category`}
                                  variant={row.category === "risk" ? "warning" : "success"}
                                >
                                  {row.category === "risk" ? "직접 확인 필요" : "바로 수정 가능"}
                                </StatusBadge>
                                <span className="text-xs">{REVIEW_REASON_LABEL[row.reason] ?? ""}</span>
                              </span>
                              {row.category === "risk" ? (
                                <span
                                  data-slot="holiday-review-risk-hint"
                                  className="text-[11px] text-v3-text-muted"
                                >
                                  고객 정보에서 직접 수정해 주세요
                                </span>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : null}
            </TabsContent>
          ))}
        </Tabs>

        {lastResult ? (
          <div className="max-h-[30dvh] overflow-y-auto px-4 pb-2">
            <HolidayReviewResultNotice
              summary={lastResult}
              dataComponent={`${dataComponent}_result`}
              onDismiss={() => setLastResult(null)}
            />
          </div>
        ) : null}

        <div
          data-component={`${dataComponent}_footer`}
          className="grid gap-2 border-t border-v3-border px-4 pb-6 pt-3"
        >
          <div className="grid gap-0.5 text-left">
            <span data-slot="holiday-review-selected-count" className="text-xs text-v3-text-muted">
              {`${selectedRows.length}명 선택`}
            </span>
            {hasRiskSelected ? (
              <span data-slot="holiday-review-fix-hint" className="text-xs text-v3-burgundy">
                직접 확인이 필요한 고객이 있어 수정할 수 없어요. 그대로 두거나 고객 정보에서 직접 수정해 주세요.
              </span>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            data-component={`${dataComponent}_footer_keep-trigger`}
            disabled={busy || selectedRows.length === 0}
            onClick={() => submit("keep")}
          >
            선택 고객 그대로 두기
          </Button>
          <Button
            type="button"
            data-component={`${dataComponent}_footer_fix-trigger`}
            disabled={busy || selectedRows.length === 0 || hasRiskSelected}
            aria-busy={busy || undefined}
            onClick={() => submit("fix")}
          >
            선택 고객 종료일 수정
          </Button>
          <Button
            type="button"
            variant="ghost"
            data-component={`${dataComponent}_footer_close-trigger`}
            disabled={busy}
            onClick={onClose}
          >
            닫기
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
