"use client";

import { useState } from "react";
import { MoreVertical, SquarePen, Trash2 } from "lucide-react";

import { ErrorFallback } from "@/components/app/ui/error-fallback";
import { ListEmptyState } from "@/components/app/v3";
import { ListLoadMoreButton } from "@/components/app/mobile-redesign/primitives";
import {
  type Employee,
  useEmployeeActiveClients,
  useEmployeeWorkHistory,
  useToggleEmployeeOpenStatus,
} from "@/hooks/useEmployees";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import {
  DocRow,
  DocRowsSkeleton,
  DetailTabPills,
  InfoCard,
  InfoRow,
  MobileDetailHeader,
  MobileDetailPage,
  MobileDetailTabPanel,
} from "@/components/app/mobile-redesign/detail-sheet";
import { getOpenToNextWorkLabel } from "@babyjamjam/shared/constants/employee-status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { normalizeApiError } from "@babyjamjam/shared";
import { groupForEmployee } from "@/lib/employee/list-helpers";

export type EmployeeDetailTabId = "basic" | "clients" | "history";

function employeeInitial(name: string) {
  return name.trim().charAt(0) || "?";
}

function employeeWorkAreas(employee: Employee) {
  return (employee.workArea ?? []).filter(Boolean);
}

function employeeAreaSummary(employee: Employee) {
  const areas = employeeWorkAreas(employee);
  if (areas.length === 0) return "미설정";
  return areas.join(", ");
}

function formatRegisteredDate(value: string | null | undefined, fallback: string): string {
  return formatDateForDisplay(value, fallback);
}

export interface EmployeeDetailContentProps {
  employee: Employee;
  activeTab: EmployeeDetailTabId;
  onTabChange: (id: EmployeeDetailTabId) => void;
  onEdit: () => void;
  onDelete: () => void;
  canManage: boolean;
}

export function EmployeeDetailContent({
  employee,
  activeTab,
  onTabChange,
  onEdit,
  onDelete,
  canManage,
}: EmployeeDetailContentProps) {
  const locale = useLocale();
  const group = groupForEmployee(employee);
  const [openToNextWorkOverride, setOpenToNextWorkOverride] = useState<{ employeeId: number; value: boolean } | null>(null);
  const openStatusMutation = useToggleEmployeeOpenStatus();
  const openToNextWork = openToNextWorkOverride?.employeeId === employee.id
    ? openToNextWorkOverride.value
    : employee.openToNextWork;
  const availability = getOpenToNextWorkLabel(openToNextWork);
  const availabilityTone = openToNextWork ? "green" : "muted";
  const unknownDateLabel = t(locale, "employees.form.registered-date-unknown");

  const handleOpenStatusChange = (nextOpenToNextWork: boolean) => {
    const previousOpenToNextWork = openToNextWork;
    setOpenToNextWorkOverride({ employeeId: employee.id, value: nextOpenToNextWork });
    openStatusMutation.mutate(
      { id: employee.id, openToNextWork: nextOpenToNextWork },
      {
        onError: () => setOpenToNextWorkOverride(
          previousOpenToNextWork === employee.openToNextWork
            ? null
            : { employeeId: employee.id, value: previousOpenToNextWork },
        ),
        onSuccess: () => setOpenToNextWorkOverride(null),
      },
    );
  };

  const { data: activeClients = [], isLoading: isActiveClientsLoading } =
    useEmployeeActiveClients(employee.id);
  const {
    history: workHistory,
    isLoading: isWorkHistoryLoading,
    isError: isWorkHistoryError,
    error: workHistoryError,
    refetch: refetchWorkHistory,
    hasNextPage: hasMoreWorkHistory,
    fetchNextPage: fetchMoreWorkHistory,
    isFetchingNextPage: isFetchingMoreWorkHistory,
  } = useEmployeeWorkHistory(employee.id);
  const normalizedWorkHistoryError = workHistoryError
    ? normalizeApiError(workHistoryError, { locale: locale === "en" ? "en-US" : "ko-KR", operation: "read" })
    : null;
  const workHistoryErrorDescription = normalizedWorkHistoryError?.verified
    ? normalizedWorkHistoryError.message
    : "잠시 후 다시 시도해 주세요.";

  return (
    <MobileDetailPage data-component="mobile_employees_detail-sheet_stack_detail-page_body" name="employees">
      <MobileDetailHeader data-component="mobile_employees_detail-sheet_stack_detail-page_body_header"
        name="employees"
        avatar={employeeInitial(employee.name)}
        avatarTone={group.badgeTone}
        title={employee.name}
        badges={[
          { label: group.badge, tone: group.badgeMini },
          ...(employee.grade ? [{ label: employee.grade, tone: "primary" as const }] : []),
        ]}
        menu={canManage ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface"
                aria-label="제공인력 옵션"
                data-component="mobile_employees_detail-sheet_stack_detail-page_body_header_menu-trigger"
              >
                <MoreVertical size={20} strokeWidth={2} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={4}
              className="z-[200] w-max min-w-[5.5rem] rounded-md p-0"
              data-component="mobile_employees_detail-sheet_stack_detail-page_body_header_menu"
            >
              <DropdownMenuItem
                onClick={onEdit}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile_employees_detail-sheet_stack_detail-page_body_header_menu_edit"
              >
                <SquarePen className="size-[15px]" strokeWidth={2} />
                수정
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={onDelete}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile_employees_detail-sheet_stack_detail-page_body_header_menu_delete"
              >
                <Trash2 className="size-[15px]" strokeWidth={2} />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined}
      />

      <DetailTabPills
        data-component="mobile_employees_detail-sheet_stack_detail-page_body_tabs"
        tabs={[
          { id: "basic", label: "제공인력 정보" },
          { id: "clients", label: "담당 고객" },
          { id: "history", label: "근무 내역" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as EmployeeDetailTabId)}
      />

      <MobileDetailTabPanel
        name="employees"
        tabId="basic"
        activeTab={activeTab}
        data-component="mobile_employees_detail-sheet_stack_detail-page_body_tab-panel"
      >
        <InfoCard data-component="mobile_employees_detail-panel_info-card" title="제공인력 정보">
          <InfoRow label="이름" value={employee.name} />
          <InfoRow label="연락처" value={formatKoreanPhoneNumber(employee.phone) || "-"} />
          <InfoRow
            label="다음 배정 가능 여부"
            value={(
              <div
                data-component="mobile_employees_detail-panel_info-card_open-status-control"
                data-slot="open-status-control"
                className="flex items-center justify-end gap-3"
              >
                <span>{availability}</span>
                <Switch
                  data-component="mobile_employees_detail-panel_open-status-toggle"
                  aria-label="다음 배정 가능 여부"
                  checked={openToNextWork}
                  disabled={openStatusMutation.isPending}
                  onCheckedChange={handleOpenStatusChange}
                />
              </div>
            )}
            tone={availabilityTone}
          />
          <InfoRow label="등급" value={employee.grade || "-"} />
          <InfoRow label="근무 지역" value={employeeAreaSummary(employee)} />
        </InfoCard>
        <InfoCard data-component="mobile_employees_detail-panel_info-card-2" title="등록 정보" delay={60}>
          <InfoRow
            label={t(locale, "employees.form.registered-date")}
            value={formatRegisteredDate(employee.registeredDate, unknownDateLabel)}
          />
        </InfoCard>
      </MobileDetailTabPanel>

      <MobileDetailTabPanel
        name="employees"
        tabId="clients"
        activeTab={activeTab}
        data-component="mobile_employees_detail-sheet_stack_detail-page_body_tab-panel-2"
      >
        <InfoCard data-component="mobile_employees_detail-panel_info-card-3" title="현재 담당">
          {isActiveClientsLoading ? (
            <DocRowsSkeleton data-component="mobile_employees_detail-panel_info-card-3_clients-loading" rowCount={2} />
          ) : activeClients.length > 0 ? (
            activeClients.map((client) => (
              <DocRow
                key={`${client.clientId}:${client.role}`}
                initial={employeeInitial(client.clientName)}
                title={client.clientName}
                meta={`${formatDateForDisplay(client.startDate)} ~ ${formatDateForDisplay(client.endDate)}`}
                badge={client.role === "primary" ? "주담당" : "부담당"}
                tone={client.role === "primary" ? "green" : "primary"}
              />
            ))
          ) : (
            <div className="detail-empty-state" data-component="mobile_employees_detail-panel_info-card-3_empty">
              현재 담당 고객이 없습니다.
            </div>
          )}
        </InfoCard>
      </MobileDetailTabPanel>

      <MobileDetailTabPanel
        name="employees"
        tabId="history"
        activeTab={activeTab}
        data-component="mobile_employees_detail-sheet_stack_detail-page_body_tab-panel-3"
      >
        <InfoCard data-component="mobile_employees_detail-panel_info-card-4" title="이전 담당">
          {isWorkHistoryLoading && workHistory.length === 0 ? (
            <DocRowsSkeleton data-component="mobile_employees_detail-panel_info-card-4_loading" rowCount={2} wrapped />
          ) : isWorkHistoryError && workHistory.length === 0 ? (
            <ErrorFallback
              title="근무 내역을 불러오지 못했어요"
              description={workHistoryErrorDescription}
              onReset={() => void refetchWorkHistory()}
              resetLabel="다시 시도"
              className="min-h-0 px-0 py-4"
            />
          ) : workHistory.length > 0 ? (
            <>
              {isWorkHistoryError ? (
                <Alert
                  variant="warning"
                  role="status"
                  aria-live="polite"
                  data-component="mobile_employees_detail-panel_info-card-4_cached-data-error"
                  className="mb-3"
                >
                  <AlertTitle>근무 내역을 새로 불러오지 못했어요</AlertTitle>
                  <AlertDescription>
                    <p>현재 저장된 근무 내역을 표시하고 있습니다. {workHistoryErrorDescription}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-component="mobile_employees_detail-panel_info-card-4_cached-data-error_retry"
                      aria-label="근무 내역 다시 시도"
                      className="mt-3"
                      onClick={() => void refetchWorkHistory()}
                    >
                      다시 시도
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}
              {workHistory.map((assignment) => (
                <div key={assignment.scheduleId} data-component="mobile_employees_detail-panel_info-card-4_history-row">
                  <DocRow
                    initial={employeeInitial(assignment.clientName)}
                    title={assignment.clientName}
                    meta={`${formatDateForDisplay(assignment.startDate)} ~ ${formatDateForDisplay(assignment.endDate)} · ${assignment.role === "primary" ? "주담당" : "부담당"}`}
                    badge={assignment.status === "replaced" ? "교체됨" : "종료"}
                    tone={assignment.status === "replaced" ? "orange" : "muted"}
                  />
                </div>
              ))}
              {hasMoreWorkHistory ? (
                <ListLoadMoreButton
                  data-component="mobile_employees_detail-panel_info-card-4_load-more"
                  onLoadMore={() => void fetchMoreWorkHistory()}
                  isLoading={isFetchingMoreWorkHistory}
                />
              ) : null}
            </>
          ) : (
            <ListEmptyState name="mobile_employees_detail-panel_info-card-4_empty" message="근무 내역이 없습니다." />
          )}
        </InfoCard>
      </MobileDetailTabPanel>
    </MobileDetailPage>
  );
}
