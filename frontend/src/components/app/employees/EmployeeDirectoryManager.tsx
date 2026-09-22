"use client";

import { useMemo, useState } from "react";
import {
    EMPLOYEE_STATUS_LABELS,
    OPEN_TO_NEXT_WORK_LABELS,
} from "@babyjamjam/shared/constants/employee-status";
import { normalizeApiError } from "@babyjamjam/shared";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import {
    Users,
    UserCheck,
    Clock,
    Briefcase,
    CircleOff,
    Plus,
    Phone,
} from "lucide-react";
import {
    Employee,
    useDeleteEmployee,
} from "@/hooks/useEmployees";
import { useInfiniteEmployees } from "@/hooks/useInfiniteEmployees";
import {
    EmployeeFormDialog,
    EmployeeFormPanel,
} from "@/components/app/employees/EmployeeFormDialog";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { NotificationOneButtonModal } from "@/components/app/ui/NotificationOneButtonModal";
import {
    StatsBar,
    SplitLayout,
    ListPanel,
    DetailPanel,
    HeaderActionButton,
    AnimatedSlotList,
    AnimatedSlotListItemContent,
    EmptyState,
    ListEmptyState,
} from "@/components/app/v3";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/app/ui/status-badge";
import { useLocale } from "@/providers/LocaleProvider";
import { EmployeeDetailPanel } from "@/components/app/employees/EmployeeDetailPanel";
const filterItems = [
    { label: "전체", value: "all" },
    { label: EMPLOYEE_STATUS_LABELS.available, value: "active" },
    { label: EMPLOYEE_STATUS_LABELS.unavailable, value: "inactive" },
];

function getOpenToNextWorkBadge(openToNextWork: boolean) {
    return (
        <StatusPill variant={openToNextWork ? "success" : "neutral"} size="sm" className="px-2.5 py-0.5 text-[0.6rem]">
            {OPEN_TO_NEXT_WORK_LABELS[openToNextWork ? "true" : "false"]}
        </StatusPill>
    );
}

function getEmployeeAvatarClassName(openToNextWork: boolean): string {
    return openToNextWork
        ? "border border-[hsl(137,34%,84%)] bg-[hsl(137,60%,94%)] text-v3-green"
        : "border border-[hsl(220,20%,90%)] bg-[hsl(220,20%,97%)] text-v3-text-muted";
}

export function EmployeeDirectoryManager({ dataComponent }: { dataComponent: string }) {
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState("all");
    const [isCreatingEmployee, setIsCreatingEmployee] = useState(false);
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
    const [deleteTargetEmployeeId, setDeleteTargetEmployeeId] = useState<number | null>(null);
    const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

    const {
        employees,
        allEmployees,
        isLoading,
        isError,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        refetch,
    } = useInfiniteEmployees({ filter, search });
    const deleteEmployee = useDeleteEmployee();
    const locale = useLocale();

    const stats = useMemo(() => {
        return {
            total: allEmployees.length,
            working: allEmployees.filter((e: Employee) => e.status === "working").length,
            available: allEmployees.filter((e: Employee) => e.status === "available").length,
            unavailable: allEmployees.filter((e: Employee) => e.status === "unavailable").length,
        };
    }, [allEmployees]);

    const handleAddNew = () => {
        setEditingEmployee(null);
        setFormDialogOpen(false);
        setSelectedEmployee(null);
        setIsCreatingEmployee(true);
    };

    const handleSelectEmployee = (employee: Employee) => {
        setIsCreatingEmployee(false);
        setSelectedEmployee(employee);
    };

    const handleEdit = (employee: Employee) => {
        setIsCreatingEmployee(false);
        setEditingEmployee(employee);
        setFormDialogOpen(true);
    };

    const handleDeleteRequest = (id: number) => {
        setDeleteTargetEmployeeId(id);
    };

    const handleDeleteConfirm = async () => {
        if (deleteTargetEmployeeId === null) return;

        try {
            await deleteEmployee.mutateAsync(deleteTargetEmployeeId);

            if (selectedEmployee?.id === deleteTargetEmployeeId) {
                setSelectedEmployee(null);
            }

            setDeleteTargetEmployeeId(null);
        } catch (err) {
            console.error("Failed to delete employee:", err);
            setDeleteTargetEmployeeId(null);
            setDeleteErrorMessage(normalizeApiError(err, {
                locale: locale === "en" ? "en-US" : "ko-KR",
                operation: "mutation",
            }).message);
        }
    };

    const handleFormDialogClose = () => {
        setFormDialogOpen(false);
        setEditingEmployee(null);
    };

    const handleFormPanelClose = () => {
        setIsCreatingEmployee(false);
    };

    const handleFormPanelSuccess = (employee: Employee) => {
        setIsCreatingEmployee(false);
        setSelectedEmployee(employee);
    };

    return (
        <div data-component={dataComponent} className="flex min-h-0 flex-1 flex-col gap-4">
            <StatsBar
                name="employees"
                isLoading={isLoading}
                items={[
                    { icon: Users, value: stats.total, label: "전체 직원", counter: "명" },
                    { icon: Briefcase, value: stats.working, label: "근무 중", counter: "명", colorIndex: 2 },
                    { icon: Clock, value: stats.available, label: EMPLOYEE_STATUS_LABELS.available, counter: "명", colorIndex: 2 },
                    { icon: CircleOff, value: stats.unavailable, label: EMPLOYEE_STATUS_LABELS.unavailable, counter: "명", colorIndex: 0 },
                ]}
            />

            <SplitLayout data-component={`${dataComponent}_split-layout`}
                hasSelection={isCreatingEmployee || !!selectedEmployee}
                onBack={() => {
                    if (isCreatingEmployee) {
                        handleFormPanelClose();
                        return;
                    }

                    setSelectedEmployee(null);
                }}
            >
                <ListPanel data-component={`${dataComponent}_split-layout_list-panel`}
                    title="직원 목록"
                    tabs={filterItems}
                    activeTab={filter}
                    onTabChange={setFilter}
                    searchValue={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="이름, 연락처, 지역으로 검색..."
                    isLoading={isLoading} subHeader={!isLoading && isError && employees.length > 0 ? <Alert variant="warning" data-component={`${dataComponent}_split-layout_list-panel_cached-data-error`}><AlertTitle>직원 목록을 불러오지 못했습니다</AlertTitle><AlertDescription>현재 저장된 직원 목록을 표시하고 있습니다. 잠시 후 다시 시도해 주세요.<Button type="button" variant="outline" size="sm" data-component={`${dataComponent}_split-layout_list-panel_cached-data-error_retry`} className="mt-3" aria-label="직원 목록 다시 시도" onClick={() => void refetch()}>다시 시도</Button></AlertDescription></Alert> : undefined}
                    headerActions={
                        <HeaderActionButton
                            icon={Plus}
                            label="직원 추가"
                            onClick={handleAddNew}
                            data-component={`${dataComponent}_split-layout_list-panel_employees-header-add`}
                            className="text-[calc(12px*var(--glint-ui-scale,1))]"
                        />
                    }
                    emptyState={!isLoading && !isError && employees.length === 0 ? (
                        <ListEmptyState
                            message={search || filter !== "all" ? "검색 결과가 없습니다" : "등록된 직원이 없습니다"}
                        />
                    ) : undefined}
                >
                    {!isLoading && isError && employees.length === 0 ? (
                        <Alert
                            variant="destructive"
                            data-component={`${dataComponent}_split-layout_list-panel_error`}
                            className="m-6"
                        >
                            <AlertTitle>직원 목록을 불러오지 못했습니다</AlertTitle>
                            <AlertDescription>
                                잠시 후 다시 시도해 주세요.
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    data-component={`${dataComponent}_split-layout_list-panel_error_retry`}
                                    className="mt-3"
                                    aria-label="직원 목록 다시 시도"
                                    onClick={() => void refetch()}
                                >
                                    다시 시도
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <AnimatedSlotList<Employee>
                            items={employees}
                            isLoading={isLoading}
                            loadingCount={6}
                            className="space-y-2"
                            getSlotState={({ item, isLoading: slotLoading }) => {
                                const isActive = !slotLoading && item && selectedEmployee?.id === item.id;
                                return {
                                    isActive: Boolean(isActive),
                                    isInteractive: !slotLoading && Boolean(item),
                                };
                            }}
                            onSlotClick={(employee) => handleSelectEmployee(employee)}
                            hasMore={hasNextPage}
                            onLoadMore={() => fetchNextPage()}
                            isFetchingMore={isFetchingNextPage}
                            render={({ item: employee, isLoading: slotLoading }) => {
                                if (slotLoading) {
                                    return (
                                        <>
                                            <div data-component={`${dataComponent}_split-layout_list-panel_employees-list-item-avatar-skeleton`} className="w-11 h-11 rounded-[14px] shrink-0 shadow-md bg-v3-dim-white flex items-center justify-center">
                                                <Skeleton className="w-5 h-5 rounded-md bg-white/70" />
                                            </div>
                                            <div data-component={`${dataComponent}_split-layout_list-panel_employees-list-item-info-skeleton`} className="flex-1 min-w-0">
                                                <Skeleton className="h-4 w-24 mb-1.5 bg-v3-dim-white" />
                                                <Skeleton className="h-3 w-40 bg-v3-dim-white" />
                                            </div>
                                            <Skeleton className="h-6 w-14 rounded-full bg-v3-dim-white shrink-0" />
                                        </>
                                    );
                                }

                                if (!employee) return null;

                                return (
                                    <AnimatedSlotListItemContent
                                        dataComponent={`${dataComponent}_split-layout_list-panel_employees-list-item`}
                                        icon={UserCheck}
                                        iconContainerClassName={getEmployeeAvatarClassName(employee.openToNextWork)}
                                        title={employee.name}
                                        subtitle={
                                            <span className="flex items-center gap-1 truncate">
                                                <Phone className="h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(12px*var(--glint-ui-scale,1))]" />
                                                {formatKoreanPhoneNumber(employee.phone) || "-"}
                                            </span>
                                        }
                                        status={getOpenToNextWorkBadge(employee.openToNextWork)}
                                    />
                                );
                            }}
                        />
                    )}
                </ListPanel>

                {isCreatingEmployee ? (
                    <EmployeeFormPanel
                        onClose={handleFormPanelClose}
                        onSuccess={handleFormPanelSuccess}
                        renderLayout={({ content, footer }) => (
                            <DetailPanel data-component={`${dataComponent}_split-layout_detail-panel_create`}
                                compactBackLabel="직원 목록으로 돌아가기"
                                title="직원 추가"
                                subtitle="이름, 연락처, 등급과 근무 가능 지역을 입력합니다."
                                avatar={
                                    <div
                                        data-component={`${dataComponent}_split-layout_detail-panel_create_employees-create-avatar`}
                                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary"
                                    >
                                        <UserCheck className="h-5 w-5" />
                                    </div>
                                }
                                footer={footer}
                            >
                                {content}
                            </DetailPanel>
                        )}
                    />
                ) : selectedEmployee ? (
                    <EmployeeDetailPanel key={selectedEmployee.id}
                        employee={selectedEmployee}
                        onEdit={handleEdit}
                        onDelete={handleDeleteRequest}
                    />
                ) : (
                    <EmptyState icon={Users} message="직원을 선택하면 상세 정보가 표시됩니다" />
                )}
            </SplitLayout>

            <EmployeeFormDialog
                open={formDialogOpen}
                onClose={handleFormDialogClose}
                employee={editingEmployee}
                onSuccess={handleFormPanelSuccess}
            />

            <TwoButtonModal
                open={deleteTargetEmployeeId !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTargetEmployeeId(null);
                }}
                dataComponent={`${dataComponent}_delete-approval`}
                title="직원을 삭제하시겠습니까?"
                description="삭제한 직원 정보는 복구할 수 없어요."
                approvalLabel="삭제"
                pendingLabel="삭제 중..."
                approvalVariant="destructive"
                isPending={deleteEmployee.isPending}
                onApprove={() => void handleDeleteConfirm()}
            />
            <NotificationOneButtonModal
                open={deleteErrorMessage !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteErrorMessage(null);
                }}
                dataComponent={`${dataComponent}_delete-error-notification`}
                title="직원을 삭제하지 못했습니다."
                description={deleteErrorMessage ?? ""}
                isDescriptionVisuallyHidden={false}
                onAcknowledge={() => setDeleteErrorMessage(null)}
            />
        </div>
    );
}
