"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
    Users,
    UserCheck,
    Clock,
    Briefcase,
    CircleOff,
    Plus,
    Phone,
    Calendar,
    MoreVertical,
    Pencil,
    Trash2,
} from "lucide-react";
import {
    Employee,
    EmployeeStatus,
    useDeleteEmployee,
} from "@/hooks/useEmployees";
import { useInfiniteEmployees } from "@/hooks/useInfiniteEmployees";
import { EmployeeFormDialog } from "@/components/app/employees/EmployeeFormDialog";
import {
    StatsBar,
    SplitLayout,
    ListPanel,
    DetailPanel,
    InfoCard,
    InfoRow,
    HeaderActionButton,
    AnimatedSlotList,
    EmptyState,
    PageSection,
    ListEmptyState,
} from "@/components/app/v3";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/app/ui/status-badge";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatWorkAreaLabel } from "@/components/app/employees/employee-form.constants";
import { getEmployeeGradeBadgeStyle, normalizeEmployeeGrade } from "@/features/employees/grade";

const filterItems = [
    { label: "전체", value: "all" },
    { label: "근무 가능", value: "active" },
    { label: "근무 불가", value: "inactive" },
];

const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, string> = {
    available: "근무 가능",
    working: "근무중",
    unavailable: "근무 불가",
};

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
            {openToNextWork ? "근무 가능" : "근무 불가"}
        </StatusPill>
    );
}

function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("ko-KR");
}

function formatPhoneNumber(phone: string | null | undefined): string {
    if (!phone) return "-";

    const numbers = phone.replace(/[^\d]/g, "");
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;

    return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
}

export default function EmployeesPage() {
    const router = useRouter();
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState("all");
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

    const {
        employees,
        allEmployees,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
    } = useInfiniteEmployees({ filter, search });
    const deleteEmployee = useDeleteEmployee();

    const stats = useMemo(() => {
        return {
            total: allEmployees.length,
            working: allEmployees.filter((e: Employee) => e.status === "working").length,
            available: allEmployees.filter((e: Employee) => e.status === "available").length,
            unavailable: allEmployees.filter((e: Employee) => e.status === "unavailable").length,
        };
    }, [allEmployees]);

    const handleAddNew = () => {
        router.push("/employees/new");
    };

    const handleSelectEmployee = (employee: Employee) => {
        setSelectedEmployee(employee);
    };

    const handleEdit = (employee: Employee) => {
        setEditingEmployee(employee);
        setFormDialogOpen(true);
    };

    const handleDelete = async (id: number): Promise<boolean> => {
        if (window.confirm("정말 삭제하시겠습니까?")) {
            try {
                await deleteEmployee.mutateAsync(id);

                if (selectedEmployee?.id === id) {
                    setSelectedEmployee(null);
                }

                return true;
            } catch (err) {
                console.error("Failed to delete employee:", err);
                return false;
            }
        }
        return false;
    };

    const handleFormDialogClose = () => {
        setFormDialogOpen(false);
        setEditingEmployee(null);
    };

    return (
        <PageSection name="employees">
            <StatsBar
                name="employees"
                items={[
                    { icon: Users, value: stats.total, label: "전체 직원", counter: "명" },
                    { icon: Briefcase, value: stats.working, label: "근무 중", counter: "명", colorIndex: 2 },
                    { icon: Clock, value: stats.available, label: "근무 가능", counter: "명", colorIndex: 1 },
                    { icon: CircleOff, value: stats.unavailable, label: "근무 불가", counter: "명", colorIndex: 3 },
                ]}
            />

            <SplitLayout hasSelection={!!selectedEmployee} onBack={() => setSelectedEmployee(null)}>
                <ListPanel
                    title="직원 목록"
                    tabs={filterItems}
                    activeTab={filter}
                    onTabChange={setFilter}
                    searchValue={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="이름, 연락처, 지역으로 검색..."
                    isLoading={isLoading}
                    headerActions={
                        <HeaderActionButton
                            icon={Plus}
                            label="직원 추가"
                            onClick={handleAddNew}
                            data-component="employees-header-add"
                        />
                    }
                >
                    {!isLoading && employees.length === 0 ? (
                        <ListEmptyState
                            name="employees-empty"
                            message={search || filter !== "all" ? "검색 결과가 없습니다" : "등록된 직원이 없습니다"}
                        />
                    ) : (
                        <AnimatedSlotList<Employee>
                            items={employees}
                            isLoading={isLoading}
                            loadingCount={6}
                            className="space-y-2"
                            slotClassName={({ item, isLoading: slotLoading }) => {
                                const isActive = !slotLoading && item && selectedEmployee?.id === item.id;
                                return cn(
                                    "flex items-center gap-3 p-4 rounded-[18px] transition-all duration-200 border-2 border-transparent",
                                    !slotLoading && "cursor-pointer",
                                    isActive
                                        ? "bg-v3-primary-light border-v3-primary"
                                        : !slotLoading && "hover:bg-v3-primary-light/50 hover:border-v3-primary/30"
                                );
                            }}
                            onSlotClick={(employee) => handleSelectEmployee(employee)}
                            hasMore={hasNextPage}
                            onLoadMore={() => fetchNextPage()}
                            isFetchingMore={isFetchingNextPage}
                            render={({ item: employee, isLoading: slotLoading }) => {
                                if (slotLoading) {
                                    return (
                                        <>
                                            <div data-component="employees-list-item-avatar-skeleton" className="w-11 h-11 rounded-[14px] shrink-0 shadow-md bg-v3-dim-white flex items-center justify-center">
                                                <Skeleton className="w-5 h-5 rounded-md bg-white/70" />
                                            </div>
                                            <div data-component="employees-list-item-info-skeleton" className="flex-1 min-w-0">
                                                <Skeleton className="h-4 w-24 mb-1.5 bg-v3-dim-white" />
                                                <Skeleton className="h-3 w-40 bg-v3-dim-white" />
                                            </div>
                                            <Skeleton className="h-6 w-14 rounded-full bg-v3-dim-white shrink-0" />
                                        </>
                                    );
                                }

                                if (!employee) return null;

                                return (
                                    <>
                                        <div data-component="employees-list-item-avatar" className="w-11 h-11 rounded-[14px] bg-gradient-to-br from-v3-primary to-purple-500 flex items-center justify-center shrink-0 shadow-md">
                                            <UserCheck className="w-5 h-5 shrink-0 transition-colors text-white" aria-hidden="true" />
                                        </div>

                                        <div data-component="employees-list-item-info" className="flex-1 min-w-0">
                                            <div data-component="employees-list-item-name-row" className="flex items-center gap-2 mb-0.5">
                                                <span className="font-bold text-[0.85rem] text-v3-dark truncate">
                                                    {employee.name}
                                                </span>
                                            </div>
                                            <div data-component="employees-list-item-meta-row" className="flex items-center gap-3 text-[0.7rem] text-v3-text-muted">
                                                <span className="flex items-center gap-1 truncate">
                                                    <Phone className="w-3 h-3" />
                                                    {formatPhoneNumber(employee.phone)}
                                                </span>
                                            </div>
                                        </div>

                                        <div data-component="employees-list-item-status" className="shrink-0">
                                            {getOpenToNextWorkBadge(employee.openToNextWork)}
                                        </div>
                                    </>
                                );
                            }}
                        />
                    )}
                </ListPanel>

                {selectedEmployee ? (
                    <EmployeeDetail
                        employee={selectedEmployee}
                        onEdit={handleEdit}
                        onDelete={handleDelete}
                    />
                ) : (
                    <EmptyState name="employees-empty-detail" icon={Users} message="직원을 선택하면 상세 정보가 표시됩니다" />
                )}
            </SplitLayout>

            <EmployeeFormDialog
                open={formDialogOpen}
                onClose={handleFormDialogClose}
                employee={editingEmployee}
            />
        </PageSection>
    );
}

interface EmployeeDetailProps {
    employee: Employee;
    onEdit: (employee: Employee) => void;
    onDelete: (id: number) => Promise<boolean>;
}

function EmployeeDetail({ employee, onEdit, onDelete }: EmployeeDetailProps) {
    return (
        <DetailPanel
            avatar={
                <div data-component="employees-detail-avatar" className="w-16 h-16 rounded-[20px] bg-gradient-to-br from-v3-primary to-purple-500 flex items-center justify-center text-white shadow-lg shrink-0">
                    <UserCheck className="w-7 h-7 shrink-0 transition-colors text-white" aria-hidden="true" />
                </div>
            }
            title={employee.name}
            badges={
                <>
                    {getGradeBadge(employee.grade)}
                    {getOpenToNextWorkBadge(employee.openToNextWork)}
                </>
            }
            subtitle={
                <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    등록일 {formatDate(employee.registeredDate)}
                </span>
            }
            trailing={
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-v3-dim-white transition-colors"
                        >
                            <MoreVertical className="w-5 h-5 text-v3-text-muted" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[140px]">
                        <DropdownMenuItem onClick={() => onEdit(employee)} className="gap-2">
                            <Pencil className="w-4 h-4" />
                            수정
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => {
                                void onDelete(employee.id);
                            }}
                            className="gap-2 text-destructive focus:text-destructive"
                        >
                            <Trash2 className="w-4 h-4" />
                            삭제
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            }
        >
            <div data-component="employees-detail" className="space-y-5">
                <InfoCard title="기본 정보">
                    <InfoRow label="이름" value={employee.name} />
                    <InfoRow label="연락처" value={formatPhoneNumber(employee.phone)} />
                    <InfoRow label="근무 상태" value={EMPLOYEE_STATUS_LABEL[employee.status]} />
                </InfoCard>

                <InfoCard title="업무 정보">
                    <InfoRow label="등급" value={normalizeEmployeeGrade(employee.grade)} />
                    <InfoRow
                        label="다음 업무 가능"
                        value={employee.openToNextWork ? "가능" : "불가"}
                    />
                    <InfoRow
                        label="근무 지역"
                        value={
                            <div data-component="employees-detail-work-area-tags" className="flex flex-wrap gap-1.5">
                                {employee.workArea.map((area) => (
                                    <span
                                        key={area}
                                        className="inline-flex items-center rounded-full bg-v3-primary-light text-v3-primary px-2 py-0.5 text-[0.7rem] font-medium"
                                    >
                                        {formatWorkAreaLabel(area)}
                                    </span>
                                ))}
                            </div>
                        }
                    />
                </InfoCard>

                <InfoCard title="등록 정보">
                    <InfoRow label="등록일" value={formatDate(employee.registeredDate)} />
                </InfoCard>
            </div>
        </DetailPanel>
    );
}
