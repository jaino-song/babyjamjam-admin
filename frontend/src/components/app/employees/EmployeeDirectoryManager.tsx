"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { canManageBranchFromAuthQuery } from "@/lib/auth/branch-role-policy";
import { EmployeeDetailPanel } from "@/components/app/employees/EmployeeDetailPanel";
type EmployeeFilter = "all" | "active" | "inactive";

type PendingCreateDiscardAction =
    | { type: "filter"; filter: EmployeeFilter }
    | { type: "select"; employee: Employee }
    | { type: "back" }
    | { type: "close" };

const filterItems: Array<{ label: string; value: EmployeeFilter }> = [
    { label: "전체", value: "all" },
    { label: EMPLOYEE_STATUS_LABELS.available, value: "active" },
    { label: EMPLOYEE_STATUS_LABELS.unavailable, value: "inactive" },
];

function employeeWorkAreasMatch(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((area, index) => area === right[index]);
}

type EmployeeFormField = "name" | "phone" | "grade" | "workArea" | "openToNextWork" | "birthday";

const EMPLOYEE_FORM_FIELDS: readonly EmployeeFormField[] = [
    "name",
    "phone",
    "grade",
    "workArea",
    "openToNextWork",
    "birthday",
];

function employeeFormFieldMatches(left: Employee, right: Employee, field: EmployeeFormField): boolean {
    if (field === "workArea") return employeeWorkAreasMatch(left.workArea, right.workArea);
    return left[field] === right[field];
}

function mergeConfirmedFormFields(
    liveEmployee: Employee,
    formEmployee: Employee,
    baselineEmployee: Employee,
    settledFields: readonly EmployeeFormField[],
): Employee {
    const mergedEmployee = { ...liveEmployee };
    const isSettled = (field: EmployeeFormField) => settledFields.includes(field);

    if (!isSettled("name")
        && formEmployee.name !== baselineEmployee.name
        && liveEmployee.name === baselineEmployee.name) {
        mergedEmployee.name = formEmployee.name;
    }
    if (!isSettled("phone")
        && formEmployee.phone !== baselineEmployee.phone
        && liveEmployee.phone === baselineEmployee.phone) {
        mergedEmployee.phone = formEmployee.phone;
    }
    if (!isSettled("grade")
        && formEmployee.grade !== baselineEmployee.grade
        && liveEmployee.grade === baselineEmployee.grade) {
        mergedEmployee.grade = formEmployee.grade;
    }
    if (!isSettled("workArea")
        && !employeeWorkAreasMatch(formEmployee.workArea, baselineEmployee.workArea)
        && employeeWorkAreasMatch(liveEmployee.workArea, baselineEmployee.workArea)) {
        mergedEmployee.workArea = [...formEmployee.workArea];
    }
    if (!isSettled("openToNextWork")
        && formEmployee.openToNextWork !== baselineEmployee.openToNextWork
        && liveEmployee.openToNextWork === baselineEmployee.openToNextWork) {
        mergedEmployee.openToNextWork = formEmployee.openToNextWork;
    }
    if (!isSettled("birthday")
        && formEmployee.birthday !== baselineEmployee.birthday
        && liveEmployee.birthday === baselineEmployee.birthday) {
        mergedEmployee.birthday = formEmployee.birthday;
    }

    return mergedEmployee;
}

function getOpenToNextWorkBadge(openToNextWork: boolean) {
    return (
        <StatusPill variant={openToNextWork ? "success" : "neutral"} size="sm" className="px-2.5 py-0.5 text-[0.6rem]">
            {OPEN_TO_NEXT_WORK_LABELS[openToNextWork ? "true" : "false"]}
        </StatusPill>
    );
}

function getEmployeeAvatarClassName(openToNextWork: boolean): string {
    return openToNextWork
        ? "border border-[hsl(137,34%,84%)] bg-[hsl(137,60%,94%)] text-green"
        : "border border-[hsl(220,20%,90%)] bg-[hsl(220,20%,97%)] text-text-muted";
}

export function EmployeeDirectoryManager({ dataComponent }: { dataComponent: string }) {
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<EmployeeFilter>("all");
    const [isCreatingEmployee, setIsCreatingEmployee] = useState(false);
    const [isCreateFormDirty, setIsCreateFormDirty] = useState(false);
    const [pendingCreateDiscard, setPendingCreateDiscard] = useState<PendingCreateDiscardAction | null>(null);
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [selectedEmployeeFromForm, setSelectedEmployeeFromForm] = useState<Employee | null>(null);
    const [selectedEmployeeFormBaseline, setSelectedEmployeeFormBaseline] = useState<Employee | null>(null);
    const [settledFormFields, setSettledFormFields] = useState<EmployeeFormField[]>([]);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
    const [deleteTargetEmployeeId, setDeleteTargetEmployeeId] = useState<number | null>(null);
    const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

    const {
        employees,
        allEmployees,
        searchMatchedEmployees,
        isLoading,
        isError,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        refetch,
    } = useInfiniteEmployees({ filter, search });
    const deleteEmployee = useDeleteEmployee();
    const locale = useLocale();
    const authUserQuery = useGetAuthUser();
    const canManageEmployees = canManageBranchFromAuthQuery(authUserQuery);

    const liveSelectedEmployee = selectedEmployee
        ? allEmployees.find((employee) => employee.id === selectedEmployee.id) ?? null
        : null;
    const selectedEmployeeFromList = liveSelectedEmployee ?? selectedEmployee;
    const formFieldsToSettle = useMemo<EmployeeFormField[]>(() => {
        if (!selectedEmployeeFromForm || !selectedEmployeeFromList || !liveSelectedEmployee) return [];
        if (!selectedEmployeeFormBaseline) return [...EMPLOYEE_FORM_FIELDS];

        return EMPLOYEE_FORM_FIELDS.filter((field) => (
            !employeeFormFieldMatches(selectedEmployeeFromForm, selectedEmployeeFormBaseline, field)
            && !employeeFormFieldMatches(selectedEmployeeFromList, selectedEmployeeFormBaseline, field)
        ));
    }, [liveSelectedEmployee, selectedEmployeeFormBaseline, selectedEmployeeFromForm, selectedEmployeeFromList]);
    useEffect(() => {
        if (formFieldsToSettle.length === 0) return;

        // Retire each form field after the live row acknowledges the saved value
        // or advances beyond both the saved and pre-save values.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSettledFormFields((current) => {
            const next = Array.from(new Set([...current, ...formFieldsToSettle]));
            return next.length === current.length ? current : next;
        });
    }, [formFieldsToSettle]);

    const selectedEmployeeForDetail = selectedEmployeeFromForm && selectedEmployeeFromList && selectedEmployeeFormBaseline
        ? mergeConfirmedFormFields(
            selectedEmployeeFromList,
            selectedEmployeeFromForm,
            selectedEmployeeFormBaseline,
            settledFormFields,
        )
        : selectedEmployeeFromForm && !liveSelectedEmployee
            ? selectedEmployeeFromForm
        : selectedEmployeeFromList ?? selectedEmployeeFromForm;

    const stats = useMemo(() => {
        const matchedEmployees = searchMatchedEmployees ?? allEmployees ?? [];

        return {
            total: matchedEmployees.length,
            working: matchedEmployees.filter((e: Employee) => e.status === "working").length,
            available: matchedEmployees.filter((e: Employee) => e.openToNextWork === true).length,
            unavailable: matchedEmployees.filter((e: Employee) => e.openToNextWork === false).length,
        };
    }, [allEmployees, searchMatchedEmployees]);

    const handleAddNew = () => {
        if (formDialogOpen || pendingCreateDiscard !== null || isCreatingEmployee) return;

        setEditingEmployee(null);
        setFormDialogOpen(false);
        setSelectedEmployee(null);
        setIsCreateFormDirty(false);
        setSelectedEmployeeFromForm(null);
        setSelectedEmployeeFormBaseline(null);
        setSettledFormFields([]);
        setIsCreatingEmployee(true);
    };

    const handleSelectEmployee = (employee: Employee) => {
        if (formDialogOpen || pendingCreateDiscard !== null) return;

        if (isCreatingEmployee) {
            if (isCreateFormDirty) {
                setPendingCreateDiscard({ type: "select", employee });
                return;
            }

            setIsCreatingEmployee(false);
            setIsCreateFormDirty(false);
        }

        setIsCreatingEmployee(false);
        setSelectedEmployeeFromForm(null);
        setSelectedEmployeeFormBaseline(null);
        setSettledFormFields([]);
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
                setSelectedEmployeeFromForm(null);
                setSelectedEmployeeFormBaseline(null);
                setSettledFormFields([]);
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
        setIsCreateFormDirty(false);
        setPendingCreateDiscard(null);
    };

    const handleFormPanelSuccess = (employee: Employee) => {
        setIsCreatingEmployee(false);
        setIsCreateFormDirty(false);
        setPendingCreateDiscard(null);
        setSettledFormFields([]);
        setSelectedEmployeeFormBaseline(
            allEmployees.find((liveEmployee) => liveEmployee.id === employee.id) ?? null,
        );
        setSelectedEmployeeFromForm(employee);
        setSelectedEmployee(employee);
    };

    const handleCreateFormDirtyChange = useCallback((dirty: boolean) => {
        setIsCreateFormDirty(dirty);
    }, []);

    const applyFilterChange = useCallback((nextFilter: EmployeeFilter) => {
        setFilter(nextFilter);
        setSelectedEmployee(null);
        setIsCreatingEmployee(false);
        setIsCreateFormDirty(false);
        setPendingCreateDiscard(null);
    }, []);

    const handleFilterChange = (nextFilter: string) => {
        if (formDialogOpen || pendingCreateDiscard !== null) return;

        const normalizedFilter = filterItems.find((item) => item.value === nextFilter)?.value;
        if (!normalizedFilter || normalizedFilter === filter) return;

        if (isCreatingEmployee && isCreateFormDirty) {
            setPendingCreateDiscard({ type: "filter", filter: normalizedFilter });
            return;
        }

        applyFilterChange(normalizedFilter);
    };

    const handleCompactBack = () => {
        if (formDialogOpen || pendingCreateDiscard !== null) return;

        if (isCreatingEmployee) {
            if (isCreateFormDirty) {
                setPendingCreateDiscard({ type: "back" });
                return;
            }

            handleFormPanelClose();
            return;
        }

        setSelectedEmployee(null);
    };

    const handleFormPanelBeforeClose = useCallback(() => {
        if (!isCreateFormDirty) return true;

        setPendingCreateDiscard({ type: "close" });
        return false;
    }, [isCreateFormDirty]);

    const handleDiscardCreateDraft = () => {
        if (pendingCreateDiscard === null) return;

        const action = pendingCreateDiscard;
        if (action.type === "filter") {
            applyFilterChange(action.filter);
            return;
        }

        setPendingCreateDiscard(null);
        setIsCreatingEmployee(false);
        setIsCreateFormDirty(false);
        setSelectedEmployee(action.type === "select" ? action.employee : null);
    };

    return (
        <div data-component={dataComponent} className="flex min-h-0 flex-1 flex-col gap-4">
            <StatsBar
                name="employees"
                isLoading={isLoading}
                items={[
                    { icon: Users, value: stats.total, label: filterItems[0].label, counter: "명" },
                    { icon: Briefcase, value: stats.available, label: filterItems[1].label, counter: "명", colorIndex: 2 },
                    { icon: CircleOff, value: stats.unavailable, label: filterItems[2].label, counter: "명", colorIndex: 0 },
                    { icon: Clock, value: stats.working, label: "근무 중 (검색 결과)", counter: "명", colorIndex: 1 },
                ]}
            />

            <SplitLayout data-component={`${dataComponent}_split-layout`}
                hasSelection={isCreatingEmployee || !!selectedEmployee}
                onBack={handleCompactBack}
            >
                <ListPanel data-component={`${dataComponent}_split-layout_list-panel`}
                    title="직원 목록"
                    tabs={filterItems}
                    activeTab={filter}
                    onTabChange={handleFilterChange}
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
                                            <div data-component={`${dataComponent}_split-layout_list-panel_employees-list-item-avatar-skeleton`} className="w-11 h-11 rounded-[14px] shrink-0 shadow-md bg-surface flex items-center justify-center">
                                                <Skeleton className="w-5 h-5 rounded-md bg-white/70" />
                                            </div>
                                            <div data-component={`${dataComponent}_split-layout_list-panel_employees-list-item-info-skeleton`} className="flex-1 min-w-0">
                                                <Skeleton className="h-4 w-24 mb-1.5 bg-surface" />
                                                <Skeleton className="h-3 w-40 bg-surface" />
                                            </div>
                                            <Skeleton className="h-6 w-14 rounded-full bg-surface shrink-0" />
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
                        onBeforeClose={handleFormPanelBeforeClose}
                        onSuccess={handleFormPanelSuccess}
                        onDirtyChange={handleCreateFormDirtyChange}
                        renderLayout={({ content, footer }) => (
                            <DetailPanel data-component={`${dataComponent}_split-layout_detail-panel_create`}
                                compactBackLabel="직원 목록으로 돌아가기"
                                title="직원 추가"
                                subtitle="이름, 연락처, 등급과 근무 가능 지역을 입력합니다."
                                avatar={
                                    <div
                                        data-component={`${dataComponent}_split-layout_detail-panel_create_employees-create-avatar`}
                                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-primary-light text-primary"
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
                        employee={selectedEmployeeForDetail ?? selectedEmployee}
                        canManage={canManageEmployees}
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
            <TwoButtonModal
                open={pendingCreateDiscard !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingCreateDiscard(null);
                }}
                dataComponent={`${dataComponent}_create-discard-approval`}
                title="작성 중인 직원 정보를 버리시겠습니까?"
                description="입력한 내용은 저장되지 않습니다."
                approvalLabel="버리기"
                onApprove={handleDiscardCreateDraft}
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
