"use client";

import { useMemo, useState } from "react";
import {
    Users,
    CheckCircle,
    Clock,
    Briefcase,
    Plus,
    Phone,
    Calendar,
    MapPin,
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const filterItems = [
    { label: "전체", value: "all" },
    { label: "활성", value: "active" },
    { label: "비활성", value: "inactive" },
];

const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, string> = {
    available: "가용",
    working: "근무중",
    unavailable: "비가용",
};

function getGradeBadge(grade: string) {
    switch (grade) {
        case "1급":
            return (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700">
                    A등급
                </span>
            );
        case "2급":
            return (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-v3-green-light text-v3-green">
                    B등급
                </span>
            );
        case "3급":
        default:
            return (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-v3-primary-light text-v3-primary">
                    C등급
                </span>
            );
    }
}

function getOpenToNextWorkBadge(openToNextWork: boolean) {
    if (openToNextWork) {
        return (
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-v3-green-light text-v3-green">
                활성
            </span>
        );
    }

    return (
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-v3-text-muted">
            비활성
        </span>
    );
}

function getInitials(name: string): string {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2);
    return parts[0][0] + parts[1][0];
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
            active: allEmployees.filter((e: Employee) => e.openToNextWork).length,
            available: allEmployees.filter((e: Employee) => e.status === "available").length,
            working: allEmployees.filter((e: Employee) => e.status === "working").length,
        };
    }, [allEmployees]);

    const handleAddNew = () => {
        setEditingEmployee(null);
        setFormDialogOpen(true);
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
                    { icon: CheckCircle, value: stats.active, label: "활성", counter: "명", colorIndex: 2 },
                    { icon: Clock, value: stats.available, label: "가용", counter: "명", colorIndex: 1 },
                    { icon: Briefcase, value: stats.working, label: "배정됨", counter: "명", colorIndex: 3 },
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
                                            <div className="w-11 h-11 rounded-[14px] shrink-0 shadow-md bg-v3-dim-white flex items-center justify-center">
                                                <Skeleton className="w-5 h-5 rounded-md bg-white/70" />
                                            </div>
                                            <div className="flex-1 min-w-0">
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
                                        <div className="w-11 h-11 rounded-[14px] bg-gradient-to-br from-v3-primary to-purple-500 flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-md">
                                            {getInitials(employee.name)}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-0.5">
                                                <span className="font-bold text-[0.85rem] text-v3-dark truncate">
                                                    {employee.name}
                                                </span>
                                                {getGradeBadge(employee.grade)}
                                            </div>
                                            <div className="flex items-center gap-3 text-[0.7rem] text-v3-text-muted">
                                                <span className="flex items-center gap-1 truncate">
                                                    <Phone className="w-3 h-3" />
                                                    {formatPhoneNumber(employee.phone)}
                                                </span>
                                                <span className="flex items-center gap-1 shrink-0">
                                                    <MapPin className="w-3 h-3" />
                                                    {employee.workArea.length}개 지역
                                                </span>
                                            </div>
                                        </div>

                                        <div className="shrink-0">
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
                <div className="w-16 h-16 rounded-[20px] bg-gradient-to-br from-v3-primary to-purple-500 flex items-center justify-center text-xl font-bold text-white shadow-lg shrink-0">
                    {getInitials(employee.name)}
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
        >
            <div data-component="employees-detail" className="space-y-5">
                <InfoCard title="기본 정보">
                    <InfoRow label="이름" value={employee.name} />
                    <InfoRow label="연락처" value={formatPhoneNumber(employee.phone)} />
                    <InfoRow label="근무 상태" value={EMPLOYEE_STATUS_LABEL[employee.status]} />
                </InfoCard>

                <InfoCard title="업무 정보">
                    <InfoRow label="등급" value={employee.grade} />
                    <InfoRow
                        label="다음 업무 가능"
                        value={employee.openToNextWork ? "가능" : "불가"}
                    />
                    <InfoRow
                        label="근무 지역"
                        value={
                            <div className="flex flex-wrap gap-1.5">
                                {employee.workArea.map((area) => (
                                    <span
                                        key={area}
                                        className="inline-flex items-center rounded-full bg-v3-primary-light text-v3-primary px-2 py-0.5 text-[0.7rem] font-medium"
                                    >
                                        {area}
                                    </span>
                                ))}
                            </div>
                        }
                    />
                </InfoCard>

                <InfoCard title="등록 정보">
                    <InfoRow label="등록일" value={formatDate(employee.registeredDate)} />
                </InfoCard>

                <div data-component="employees-detail-actions" className="flex gap-3 pt-2">
                    <Button
                        variant="outline"
                        className="flex-1 rounded-full"
                        onClick={() => {
                            void onDelete(employee.id);
                        }}
                    >
                        삭제
                    </Button>
                    <Button
                        variant="v3"
                        className="flex-1 rounded-full"
                        onClick={() => onEdit(employee)}
                    >
                        수정
                    </Button>
                </div>
            </div>
        </DetailPanel>
    );
}
