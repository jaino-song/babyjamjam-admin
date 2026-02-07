"use client";

import { useState, useMemo } from "react";
import { UserCheck, Plus, Users, CheckCircle, Clock, Briefcase, Star, Calendar, Pencil, Eye } from "lucide-react";
import {
    Employee,
    EmployeeStatus,
    useEmployees,
    useDeleteEmployee,
} from "@/app/hooks/useEmployees";
import { EmployeeFormDialog } from "@/app/(components)/employees/EmployeeFormDialog";
import { EmployeeDetailModal } from "@/app/(components)/employees/EmployeeDetailModal";
import { PageHeader, StatMini, SearchFilterBar } from "@/app/(components)/v3";

const filterItems = [
    { label: "전체", value: "all" },
    { label: "활성", value: "active" },
    { label: "비활성", value: "inactive" },
];

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

function getInitials(name: string): string {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2);
    return parts[0][0] + parts[1][0];
}

export default function EmployeesPage() {
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState("all");
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

    const { data: employees, isLoading } = useEmployees();
    const deleteEmployee = useDeleteEmployee();

    const filteredEmployees = useMemo(() => {
        let list = employees || [];

        if (filter === "active") {
            list = list.filter((e) => e.openToNextWork);
        } else if (filter === "inactive") {
            list = list.filter((e) => !e.openToNextWork);
        }

        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(
                (e) =>
                    e.name.toLowerCase().includes(q) ||
                    e.phone.includes(q) ||
                    e.workArea.some((a) => a.toLowerCase().includes(q))
            );
        }

        return list;
    }, [employees, filter, search]);

    const stats = useMemo(() => {
        const all = employees || [];
        return {
            total: all.length,
            active: all.filter((e) => e.openToNextWork).length,
            available: all.filter((e) => e.status === "available").length,
            working: all.filter((e) => e.status === "working").length,
        };
    }, [employees]);

    const handleAddNew = () => {
        setEditingEmployee(null);
        setFormDialogOpen(true);
    };

    const handleCardClick = (employee: Employee) => {
        setSelectedEmployee(employee);
        setDetailModalOpen(true);
    };

    const handleEdit = (employee: Employee) => {
        setEditingEmployee(employee);
        setFormDialogOpen(true);
    };

    const handleDelete = async (id: number): Promise<boolean> => {
        if (window.confirm("정말 삭제하시겠습니까?")) {
            try {
                await deleteEmployee.mutateAsync(id);
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

    const handleDetailModalClose = () => {
        setDetailModalOpen(false);
        setSelectedEmployee(null);
    };

    return (
        <section data-component="employees" className="space-y-6 animate-v3-slide-up">
            <PageHeader
                title="직원 관리"
                subtitle="직원 정보를 관리하고 현황을 확인하세요"
                icon={UserCheck}
                actions={
                    <button
                        data-component="employees-header-add"
                        onClick={handleAddNew}
                        className="flex items-center gap-2 rounded-[14px] bg-v3-primary px-5 py-2.5 text-[0.85rem] font-semibold text-white shadow-v3 transition-all duration-200 hover:shadow-v3-hover hover:-translate-y-0.5 active:scale-95"
                    >
                        <Plus size={18} />
                        직원 추가
                    </button>
                }
            />

            <SearchFilterBar
                searchPlaceholder="이름, 연락처, 지역으로 검색..."
                searchValue={search}
                onSearchChange={setSearch}
                filterOptions={filterItems}
                filterValue={filter}
                onFilterChange={setFilter}
                filterLabel="상태"
            />

            <div data-component="employees-stats" className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatMini icon={Users} value={stats.total} label="전체 직원" colorIndex={0} />
                <StatMini icon={CheckCircle} value={stats.active} label="활성" colorIndex={2} />
                <StatMini icon={Clock} value={stats.available} label="가용" colorIndex={1} />
                <StatMini icon={Briefcase} value={stats.working} label="배정됨" colorIndex={3} />
            </div>

            {isLoading ? (
                <div data-component="employees-list" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div
                            key={i}
                            className="bg-white rounded-[20px] shadow-v3 p-5 animate-pulse"
                        >
                            <div className="flex items-center gap-4 mb-4">
                                <div className="w-14 h-14 rounded-full bg-gray-200" />
                                <div className="flex-1 space-y-2">
                                    <div className="h-4 bg-gray-200 rounded w-24" />
                                    <div className="h-3 bg-gray-100 rounded w-16" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <div className="h-3 bg-gray-100 rounded w-full" />
                                <div className="h-3 bg-gray-100 rounded w-3/4" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : filteredEmployees.length === 0 ? (
                <div data-component="employees-empty" className="bg-white rounded-[20px] shadow-v3 p-12 text-center">
                    <Users className="w-12 h-12 text-v3-text-muted mx-auto mb-3" />
                    <p className="text-v3-text-muted text-[0.9rem]">
                        {search || filter !== "all"
                            ? "검색 결과가 없습니다"
                            : "등록된 직원이 없습니다"}
                    </p>
                </div>
            ) : (
                <div data-component="employees-list" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredEmployees.map((employee) => (
                        <EmployeeCard
                            key={employee.id}
                            employee={employee}
                            onClick={() => handleCardClick(employee)}
                            onEdit={() => handleEdit(employee)}
                        />
                    ))}
                </div>
            )}

            <EmployeeDetailModal
                open={detailModalOpen}
                onClose={handleDetailModalClose}
                employee={selectedEmployee}
                onEdit={handleEdit}
                onDelete={handleDelete}
            />

            <EmployeeFormDialog
                open={formDialogOpen}
                onClose={handleFormDialogClose}
                employee={editingEmployee}
            />
        </section>
    );
}

interface EmployeeCardProps {
    employee: Employee;
    onClick: () => void;
    onEdit: () => void;
}

function EmployeeCard({ employee, onClick, onEdit }: EmployeeCardProps) {
    const statusColor: Record<EmployeeStatus, string> = {
        available: "bg-v3-green",
        working: "bg-amber-400",
        unavailable: "bg-gray-300",
    };

    return (
        <div
            data-component="employees-card"
            className="bg-white rounded-[20px] shadow-v3 hover:shadow-v3-hover hover:-translate-y-1 transition-all duration-300 p-5 cursor-pointer group"
            onClick={onClick}
        >
            <div className="flex items-center gap-4 mb-4">
                <div className="relative shrink-0">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-v3-primary to-purple-500 flex items-center justify-center">
                        <span className="text-white font-bold text-[0.95rem]">
                            {getInitials(employee.name)}
                        </span>
                    </div>
                    <span
                        className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white ${statusColor[employee.status]}`}
                    />
                </div>

                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-v3-dark text-[0.95rem] truncate">
                        {employee.name}
                    </h3>
                    <div className="mt-1">{getGradeBadge(employee.grade)}</div>
                </div>
            </div>

            <div className="flex items-center gap-4 text-[0.75rem] text-v3-text-muted mb-4">
                <div className="flex items-center gap-1">
                    <Star size={13} className="text-amber-400" />
                    <span>{employee.grade}</span>
                </div>
                <div className="flex items-center gap-1">
                    <Briefcase size={13} />
                    <span>{employee.workArea.length}개 지역</span>
                </div>
                <div className="flex items-center gap-1">
                    <Calendar size={13} />
                    <span>
                        {employee.registeredDate
                            ? new Date(employee.registeredDate).toLocaleDateString("ko-KR", {
                                  month: "short",
                                  day: "numeric",
                              })
                            : "-"}
                    </span>
                </div>
            </div>

            <div className="flex flex-wrap gap-1 mb-4">
                {employee.workArea.slice(0, 3).map((area) => (
                    <span
                        key={area}
                        className="inline-flex items-center rounded-full bg-v3-primary-light text-v3-primary px-2 py-0.5 text-[0.7rem] font-medium"
                    >
                        {area}
                    </span>
                ))}
                {employee.workArea.length > 3 && (
                    <span className="inline-flex items-center rounded-full bg-gray-100 text-v3-text-muted px-2 py-0.5 text-[0.7rem]">
                        +{employee.workArea.length - 3}
                    </span>
                )}
            </div>

            <div data-component="employees-card-actions" className="flex items-center gap-2 pt-3 border-t border-v3-border">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onClick();
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-[10px] bg-v3-primary-light text-v3-primary py-2 text-[0.78rem] font-medium transition-colors hover:bg-v3-primary hover:text-white"
                >
                    <Eye size={14} />
                    상세보기
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onEdit();
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-[10px] bg-gray-100 text-v3-text py-2 text-[0.78rem] font-medium transition-colors hover:bg-gray-200"
                >
                    <Pencil size={14} />
                    수정
                </button>
            </div>
        </div>
    );
}
