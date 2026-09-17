"use client";

import { useMemo, useState } from "react";
import { Calendar, MoreVertical, UserCheck } from "lucide-react";

import { OPEN_TO_NEXT_WORK_LABELS } from "@babyjamjam/shared/constants/employee-status";
import { normalizeApiError } from "@babyjamjam/shared";
import { formatWorkAreaLabel } from "@/components/app/employees/employee-form.constants";
import {
    AnimatedSlotList,
    AnimatedSlotListItemContent,
    DetailPanel,
    InfoCard,
    InfoRow,
    ListEmptyState,
} from "@/components/app/v3";
import { DetailTabPanels } from "@/components/app/v3/DetailTabPanels";
import { DetailTabs } from "@/components/app/v3/DetailTabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { StatusPill } from "@/components/app/ui/status-badge";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import {
    type Employee,
    type EmployeeActiveClient,
    type EmployeeWorkHistoryEntry,
    useEmployeeActiveClients,
    useEmployeeWorkHistory,
} from "@/hooks/useEmployees";
import { getEmployeeGradeBadgeStyle, normalizeEmployeeGrade } from "@/features/employees/grade";

type DetailTabId = "basic" | "clients" | "history";

interface EmployeeDetailPanelProps {
    employee: Employee;
    onEdit: (employee: Employee) => void;
    onDelete: (id: number) => void;
    "data-component"?: string;
}

interface SelectedAssignment {
    kind: "active" | "history";
    assignment: EmployeeActiveClient | EmployeeWorkHistoryEntry;
}

const DETAIL_ROOT = "desktop_employees_split-layout_detail-panel";

function formatEmployeeDate(value: string | null | undefined, fallback = "-") {
    return formatDateForDisplay(value, fallback);
}

function employeeInitial(name: string) {
    return name.trim().charAt(0) || "?";
}

function getEmployeeAvatarClassName(openToNextWork: boolean) {
    return openToNextWork
        ? "border border-[hsl(137,34%,84%)] bg-[hsl(137,60%,94%)] text-v3-green"
        : "border border-[hsl(220,20%,90%)] bg-[hsl(220,20%,97%)] text-v3-text-muted";
}

function getGradeBadge(grade: string) {
    const { label, variant } = getEmployeeGradeBadgeStyle(grade);
    return (
        <StatusPill variant={variant} size="sm">
            {label}
        </StatusPill>
    );
}

function getOpenToNextWorkBadge(openToNextWork: boolean) {
    return (
        <StatusPill variant={openToNextWork ? "success" : "neutral"} size="sm">
            {OPEN_TO_NEXT_WORK_LABELS[openToNextWork ? "true" : "false"]}
        </StatusPill>
    );
}

function roleLabel(role: "primary" | "secondary") {
    return role === "primary" ? "주담당" : "부담당";
}

function AssignmentError({
    title,
    error,
    onRetry,
    retryLabel,
}: {
    title: string;
    error: unknown;
    onRetry: () => void;
    retryLabel: string;
}) {
    const locale = useLocale();
    const message = normalizeApiError(error, {
        locale: locale === "en" ? "en-US" : "ko-KR",
        operation: "read",
    });
    const description = message.verified ? message.message : "잠시 후 다시 시도해 주세요.";

    return (
        <Alert variant="destructive" data-component={`${DETAIL_ROOT}_assignment-error`}>
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription>
                <p>{description}</p>
                <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-3">
                    {retryLabel}
                </Button>
            </AlertDescription>
        </Alert>
    );
}

function ActiveClientsPanel({
    employeeId,
    onSelect,
}: {
    employeeId: number;
    onSelect: (assignment: EmployeeActiveClient) => void;
}) {
    const query = useEmployeeActiveClients(employeeId);
    const clients = query.data ?? [];

    return (
        <InfoCard data-component="desktop_employees_detail-panel_info-card-3" title="현재 담당">
            {query.isLoading ? (
                <AnimatedSlotList<EmployeeActiveClient>
                    data-component="desktop_employees_detail-panel_info-card-3_clients-loading"
                    isLoading
                    loadingCount={2}
                    render={() => null}
                />
            ) : query.isError ? (
                <AssignmentError
                    title="담당 고객을 불러오지 못했어요"
                    error={query.error}
                    onRetry={() => void query.refetch()}
                    retryLabel="다시 시도"
                />
            ) : clients.length > 0 ? (
                <AnimatedSlotList<EmployeeActiveClient>
                    data-component="desktop_employees_detail-panel_info-card-3_clients-list"
                    items={clients}
                    isLoading={false}
                    itemDataComponent="desktop_employees_detail-panel_info-card-3_clients-row"
                    onSlotClick={(assignment) => onSelect(assignment)}
                    getItemKey={(assignment) => `${assignment.clientId}:${assignment.role}`}
                    render={({ item }) => {
                        if (!item) return null;
                        return (
                            <AnimatedSlotListItemContent
                                dataComponent="desktop_employees_detail-panel_info-card-3_clients-item"
                                icon={employeeInitial(item.clientName)}
                                title={item.clientName}
                                subtitle={`${formatEmployeeDate(item.startDate)} ~ ${formatEmployeeDate(item.endDate)}`}
                                status={<StatusPill variant={item.role === "primary" ? "success" : "info"}>{roleLabel(item.role)}</StatusPill>}
                            />
                        );
                    }}
                />
            ) : (
                <p data-component="desktop_employees_detail-panel_info-card-3_empty" className="py-4 text-center text-sm text-v3-text-muted">
                    현재 담당 고객이 없습니다.
                </p>
            )}
        </InfoCard>
    );
}

function WorkHistoryPanel({
    employeeId,
    onSelect,
}: {
    employeeId: number;
    onSelect: (assignment: EmployeeWorkHistoryEntry) => void;
}) {
    const query = useEmployeeWorkHistory(employeeId);
    const history = query.history;

    return (
        <InfoCard data-component="desktop_employees_detail-panel_info-card-4" title="이전 담당">
            {query.isLoading && history.length === 0 ? (
                <AnimatedSlotList<EmployeeWorkHistoryEntry>
                    data-component="desktop_employees_detail-panel_info-card-4_loading"
                    isLoading
                    loadingCount={2}
                    render={() => null}
                />
            ) : query.isError && history.length === 0 ? (
                <AssignmentError
                    title="근무 내역을 불러오지 못했어요"
                    error={query.error}
                    onRetry={() => void query.refetch()}
                    retryLabel="다시 시도"
                />
            ) : history.length > 0 ? (
                <>
                    {query.isError ? (
                        <Alert
                            variant="warning"
                            role="status"
                            data-component="desktop_employees_detail-panel_info-card-4_cached-data-error"
                            className="mb-3"
                        >
                            <AlertTitle>근무 내역을 새로 불러오지 못했어요</AlertTitle>
                            <AlertDescription>
                                현재 저장된 근무 내역을 표시하고 있습니다.
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    data-component="desktop_employees_detail-panel_info-card-4_cached-data-error_retry"
                                    className="mt-3"
                                    onClick={() => void query.refetch()}
                                >
                                    다시 시도
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : null}
                    <AnimatedSlotList<EmployeeWorkHistoryEntry>
                        data-component="desktop_employees_detail-panel_info-card-4_history-list"
                        items={history}
                        isLoading={false}
                        itemDataComponent="desktop_employees_detail-panel_info-card-4_history-row"
                        onSlotClick={(assignment) => onSelect(assignment)}
                        getItemKey={(assignment) => String(assignment.scheduleId)}
                        render={({ item }) => {
                            if (!item) return null;
                            return (
                                <AnimatedSlotListItemContent
                                    dataComponent="desktop_employees_detail-panel_info-card-4_history-item"
                                    icon={employeeInitial(item.clientName)}
                                    title={item.clientName}
                                    subtitle={`${formatEmployeeDate(item.startDate)} ~ ${formatEmployeeDate(item.endDate)} · ${roleLabel(item.role)}`}
                                    status={<StatusPill variant={item.status === "replaced" ? "warning" : "neutral"}>{item.status === "replaced" ? "교체됨" : "종료"}</StatusPill>}
                                />
                            );
                        }}
                    />
                    {query.hasNextPage ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-component="desktop_employees_detail-panel_info-card-4_load-more"
                            className="mt-3 w-full"
                            disabled={query.isFetchingNextPage}
                            onClick={() => void query.fetchNextPage()}
                        >
                            {query.isFetchingNextPage ? "불러오는 중..." : "더 보기"}
                        </Button>
                    ) : null}
                </>
            ) : (
                <ListEmptyState
                    className="min-h-0 py-8"
                    message="근무 내역이 없습니다."
                />
            )}
        </InfoCard>
    );
}

function AssignmentSheet({
    selected,
    onOpenChange,
}: {
    selected: SelectedAssignment | null;
    onOpenChange: (open: boolean) => void;
}) {
    const assignment = selected?.assignment;
    const isHistory = selected?.kind === "history";

    return (
        <Sheet open={Boolean(selected)} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="w-full overflow-y-auto sm:max-w-xl"
                data-component="desktop_employees_assignment-detail_sheet"
            >
                <SheetHeader>
                    <SheetTitle>{assignment?.clientName ?? "고객 상세"}</SheetTitle>
                    <SheetDescription>
                        {isHistory ? "직원의 이전 근무 내역" : "직원의 현재 담당 고객"}
                    </SheetDescription>
                </SheetHeader>
                {assignment ? (
                    <div className="space-y-4 px-4 pb-6">
                        <InfoCard data-component="desktop_employees_assignment-detail_info-card" title="배정 정보">
                            <InfoRow label="고객" value={assignment.clientName} />
                            <InfoRow label="담당 역할" value={roleLabel(assignment.role)} />
                            <InfoRow label="서비스 시작" value={formatEmployeeDate(assignment.startDate)} />
                            <InfoRow label="서비스 종료" value={formatEmployeeDate(assignment.endDate)} />
                            {"status" in assignment ? (
                                <InfoRow
                                    label="상태"
                                    value={assignment.status === "replaced" ? "교체됨" : "종료"}
                                />
                            ) : (
                                <InfoRow label="서비스 상태" value={assignment.serviceStatus || "-"} />
                            )}
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

export function EmployeeDetailPanel({
    employee,
    onEdit,
    onDelete,
    "data-component": dataComponent = DETAIL_ROOT,
}: EmployeeDetailPanelProps) {
    const locale = useLocale();
    const [activeTab, setActiveTab] = useState<DetailTabId>("basic");
    const [selectedAssignment, setSelectedAssignment] = useState<SelectedAssignment | null>(null);
    const unknownDateLabel = t(locale, "employees.form.registered-date-unknown");

    const tabs = useMemo(
        () => [
            { key: "basic", label: "제공인력 정보" },
            { key: "clients", label: "담당 고객" },
            { key: "history", label: "근무 내역" },
        ],
        [],
    );

    const gradeBadge = getGradeBadge(employee.grade);
    const availabilityBadge = getOpenToNextWorkBadge(employee.openToNextWork);

    return (
        <>
            <DetailPanel
                data-component={dataComponent}
                avatar={(
                    <div
                        data-component={`${dataComponent}_employees-detail-avatar`}
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] shadow-lg ${getEmployeeAvatarClassName(employee.openToNextWork)}`}
                    >
                        <UserCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
                    </div>
                )}
                title={employee.name}
                badges={(
                    <>
                        {gradeBadge}
                        {availabilityBadge}
                    </>
                )}
                subtitle={(
                    <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" aria-hidden="true" />
                        {t(locale, "employees.form.registered-date")} {formatEmployeeDate(employee.registeredDate, unknownDateLabel)}
                    </span>
                )}
                trailing={(
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" aria-label="직원 작업 메뉴 열기">
                                <MoreVertical className="h-5 w-5 text-v3-text-muted" aria-hidden="true" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[140px]">
                            <DropdownMenuItem onClick={() => onEdit(employee)} className="gap-2">
                                수정
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                data-component={`${dataComponent}_employees-detail-menu-delete`}
                                onClick={() => onDelete(employee.id)}
                                className="gap-2 text-destructive focus:text-destructive"
                            >
                                삭제
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
                tabs={(
                    <DetailTabs
                        tabs={tabs}
                        activeTab={activeTab}
                        onTabChange={(nextTab) => setActiveTab(nextTab as DetailTabId)}
                        ariaLabel="직원 상세 정보"
                        idPrefix="employee-detail"
                    />
                )}
            >
                <DetailTabPanels
                    data-component={`${dataComponent}_tab-panels`}
                    panels={[
                        {
                            key: "basic",
                            children: (
                                <div data-component={`${dataComponent}_employees-detail`} className="space-y-5">
                                    <span className="sr-only">기본 정보</span>
                                    <InfoCard data-component="desktop_employees_detail-panel_info-card" title="제공인력 정보">
                                        <InfoRow label="이름" value={employee.name} />
                                        <InfoRow label="연락처" value={formatKoreanPhoneNumber(employee.phone) || "-"} />
                                        <InfoRow label="다음 배정 가능 여부" value={OPEN_TO_NEXT_WORK_LABELS[employee.openToNextWork ? "true" : "false"]} />
                                        <InfoRow label="등급" value={normalizeEmployeeGrade(employee.grade)} />
                                        <InfoRow
                                            label="근무 지역"
                                            value={(
                                                <span className="flex flex-wrap justify-end gap-1.5">
                                                    {employee.workArea.length > 0
                                                        ? employee.workArea.map((area) => (
                                                            <StatusPill key={area} variant="info" size="sm">
                                                                {formatWorkAreaLabel(area)}
                                                            </StatusPill>
                                                        ))
                                                        : "미설정"}
                                                </span>
                                            )}
                                        />
                                    </InfoCard>
                                    <InfoCard data-component="desktop_employees_detail-panel_info-card-2" title="등록 정보">
                                        <InfoRow
                                            label={t(locale, "employees.form.registered-date")}
                                            value={formatEmployeeDate(employee.registeredDate, unknownDateLabel)}
                                        />
                                    </InfoCard>
                                </div>
                            ),
                        },
                        {
                            key: "clients",
                            children: activeTab === "clients" ? (
                                <ActiveClientsPanel
                                    employeeId={employee.id}
                                    onSelect={(assignment) => setSelectedAssignment({ kind: "active", assignment })}
                                />
                            ) : null,
                        },
                        {
                            key: "history",
                            children: activeTab === "history" ? (
                                <WorkHistoryPanel
                                    employeeId={employee.id}
                                    onSelect={(assignment) => setSelectedAssignment({ kind: "history", assignment })}
                                />
                            ) : null,
                        },
                    ]}
                    activeTab={activeTab}
                    panelClassName="space-y-5"
                    idPrefix="employee-detail"
                />
            </DetailPanel>
            <AssignmentSheet
                selected={selectedAssignment}
                onOpenChange={(open) => {
                    if (!open) setSelectedAssignment(null);
                }}
            />
        </>
    );
}
