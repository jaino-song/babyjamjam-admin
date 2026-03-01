"use client";

import { useState, useRef, useLayoutEffect } from "react";
import {
    Users,
    Plus,
    Phone,
    MapPin,
    CheckCircle,
    Clock,
    Briefcase,
    Calendar,
    MoreVertical,
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
    AnimatedSlotList,
    HeaderActionButton,
    EmptyState,
    ListEmptyState,
    DetailTabs,
} from "@/components/app/v3";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmActionModal } from "@/components/app/ui/ConfirmActionModal";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const filterItems = [
    { label: "전체", value: "all" },
    { label: "활성", value: "active" },
    { label: "비활성", value: "inactive" },
];

const DETAIL_SECTION_ORDER = ["basic", "work"] as const;
type DetailSectionKey = (typeof DETAIL_SECTION_ORDER)[number];

const getDetailSectionIndex = (section: DetailSectionKey) =>
    DETAIL_SECTION_ORDER.indexOf(section);

const isDetailSectionKey = (section: string): section is DetailSectionKey =>
    DETAIL_SECTION_ORDER.includes(section as DetailSectionKey);

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
    const [activeSection, setActiveSection] = useState<DetailSectionKey>("basic");
    const [sectionDirection, setSectionDirection] = useState<-1 | 0 | 1>(0);
    const [deleteTargetEmployeeId, setDeleteTargetEmployeeId] = useState<number | null>(null);
    const prefersReducedMotion = useReducedMotion();
    const detailContentMotionRef = useRef<HTMLDivElement | null>(null);
    const basicSectionRef = useRef<HTMLDivElement | null>(null);

    const {
        employees,
        allEmployees,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        isInitialLoad,
    } = useInfiniteEmployees({ filter, search });
    const deleteEmployee = useDeleteEmployee();

    const stats = {
        total: allEmployees.length,
        active: allEmployees.filter((e: Employee) => e.openToNextWork).length,
        available: allEmployees.filter((e: Employee) => e.status === "available").length,
        working: allEmployees.filter((e: Employee) => e.status === "working").length,
    };

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

    const handleDeleteRequest = (id: number) => {
        setDeleteTargetEmployeeId(id);
    };

    const handleDeleteConfirm = async () => {
        if (deleteTargetEmployeeId == null) {
            return;
        }

        try {
            await deleteEmployee.mutateAsync(deleteTargetEmployeeId);
            if (selectedEmployee?.id === deleteTargetEmployeeId) {
                setSelectedEmployee(null);
            }
            setDeleteTargetEmployeeId(null);
        } catch (err) {
            console.error("Failed to delete employee:", err);
        }
    };

    const handleFormDialogClose = () => {
        setFormDialogOpen(false);
        setEditingEmployee(null);
    };

    const handleSectionChange = (nextSection: string) => {
        if (!isDetailSectionKey(nextSection)) {
            return;
        }

        const currentIndex = getDetailSectionIndex(activeSection);
        const nextIndex = getDetailSectionIndex(nextSection);

        if (nextIndex === currentIndex) {
            setSectionDirection(0);
            setActiveSection(nextSection);
            return;
        }

        setSectionDirection(nextIndex > currentIndex ? 1 : -1);
        setActiveSection(nextSection);
    };

    const getDetailContentEnterX = (direction: -1 | 0 | 1) => {
        if (direction === 0) return 0;
        return direction > 0 ? "100%" : "-100%";
    };

    const getDetailContentExitX = (direction: -1 | 0 | 1) => {
        if (direction === 0) return 0;
        return direction > 0 ? "-100%" : "100%";
    };

    const detailContentVariants = {
        initial: (direction: -1 | 0 | 1) => ({
            x: prefersReducedMotion ? 0 : getDetailContentEnterX(direction),
        }),
        animate: { x: 0 },
        exit: (direction: -1 | 0 | 1) => ({
            x: prefersReducedMotion ? 0 : getDetailContentExitX(direction),
        }),
    };

    const detailContentTransition = prefersReducedMotion
        ? { duration: 0 }
        : {
              type: "tween" as const,
              duration: 0.32,
              ease: [0.22, 1, 0.36, 1] as const,
          };

    useLayoutEffect(() => {
        if (activeSection !== "basic") {
            return;
        }

        const motionContainer = detailContentMotionRef.current;
        const basicSectionElement = basicSectionRef.current;

        if (!motionContainer || !basicSectionElement) {
            return;
        }

        const updateMinHeight = () => {
            motionContainer.style.minHeight = `${Math.ceil(
                basicSectionElement.getBoundingClientRect().height
            )}px`;
        };

        updateMinHeight();

        const resizeObserver = new ResizeObserver(() => {
            updateMinHeight();
        });

        resizeObserver.observe(basicSectionElement);

        return () => {
            resizeObserver.disconnect();
        };
    }, [activeSection, selectedEmployee?.id]);

    return (
        <section data-component="employees" className="space-y-6">
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
                    <div className="space-y-2">
                        {!isLoading && employees.length === 0 ? (
                            <ListEmptyState
                                message={search || filter !== "all" ? "검색 결과가 없습니다" : "등록된 직원이 없습니다"}
                            />
                        ) : (
                            <AnimatedSlotList<Employee>
                                items={employees}
                                isLoading={isLoading}
                                loadingCount={6}
                                className="space-y-2"
                                hasMore={hasNextPage}
                                onLoadMore={fetchNextPage}
                                isFetchingMore={isFetchingNextPage}
                                isInitialLoad={isInitialLoad}
                                slotClassName={({ item, isLoading: slotLoading }) => {
                                    const isActive = !slotLoading && item && selectedEmployee?.id === item.id;
                                    return cn(
                                        "flex items-center gap-3 p-4 rounded-2xl transition-all duration-200 bg-white border-2 border-transparent",
                                        !slotLoading && "cursor-pointer",
                                        isActive
                                            ? "bg-v3-primary-light border-2 border-v3-primary"
                                            : !slotLoading && "bg-white border-2 border-transparent hover:bg-v3-primary-light/50 hover:border-v3-primary/30"
                                    );
                                }}
                                onSlotClick={(employee) => handleSelectEmployee(employee)}
                                render={({ item: employee, isLoading: slotLoading }) => {
                                    if (slotLoading) {
                                        return (
                                            <>
                                                <div className="w-11 h-11 rounded-2xl shrink-0 shadow-md bg-v3-dim-white flex items-center justify-center">
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
                                            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-v3-primary to-purple-500 flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-md">
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
                    </div>
                </ListPanel>

                {selectedEmployee ? (
                    <DetailPanel
                        mobileActions={
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        data-component="employees-detail-mobile-more-trigger"
                                        className="h-9 w-9 rounded-full text-v3-text-muted hover:bg-v3-dim-white hover:text-v3-primary"
                                        aria-label="상세 액션 더보기"
                                    >
                                        <MoreVertical className="h-5 w-5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    data-component="employees-detail-mobile-more-content"
                                    align="end"
                                    sideOffset={8}
                                    avoidCollisions
                                    className="min-w-[8.5rem]"
                                >
                                    <DropdownMenuItem
                                        data-component="employees-detail-mobile-more-edit"
                                        onClick={() => handleEdit(selectedEmployee)}
                                    >
                                        수정
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        data-component="employees-detail-mobile-more-delete"
                                        variant="destructive"
                                        onClick={() => handleDeleteRequest(selectedEmployee.id)}
                                    >
                                        삭제
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        }
                        header={
                            <div>
                                <div className="flex items-center gap-4">
                                    <div className="w-20 h-20 shrink-0 rounded-2xl bg-gradient-to-br from-v3-primary to-purple-500 flex items-center justify-center text-2xl font-bold text-white shadow-lg">
                                        {getInitials(selectedEmployee.name)}
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-v3-dark">
                                            {selectedEmployee.name}
                                        </h2>
                                        <p className="text-[0.8rem] text-v3-text-muted mt-1">
                                            {selectedEmployee.grade} · {EMPLOYEE_STATUS_LABEL[selectedEmployee.status]}
                                        </p>
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {getGradeBadge(selectedEmployee.grade)}
                                            {getOpenToNextWorkBadge(selectedEmployee.openToNextWork)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        }
                        tabs={
                            <DetailTabs
                                tabs={[
                                    { key: "basic", label: "기본 정보" },
                                    { key: "work", label: "업무 정보" },
                                ]}
                                activeTab={activeSection}
                                onTabChange={handleSectionChange}
                            />
                        }
                    >
                        <div
                            data-component="employees-detail-content-motion"
                            className="relative overflow-hidden"
                            ref={detailContentMotionRef}
                        >
                            <AnimatePresence mode="popLayout" initial={false} custom={sectionDirection}>
                                <motion.div
                                    key={activeSection}
                                    custom={sectionDirection}
                                    data-component="employees-detail-content"
                                    className="space-y-4 transform-gpu will-change-transform"
                                    ref={activeSection === "basic" ? basicSectionRef : undefined}
                                    variants={detailContentVariants}
                                    initial="initial"
                                    animate="animate"
                                    exit="exit"
                                    transition={detailContentTransition}
                                >
                                    {activeSection === "basic" && (
                                        <>
                                            <InfoCard title="기본 정보">
                                                <InfoRow label="이름" value={selectedEmployee.name} />
                                                <InfoRow label="연락처" value={formatPhoneNumber(selectedEmployee.phone)} />
                                                <InfoRow label="근무 상태" value={EMPLOYEE_STATUS_LABEL[selectedEmployee.status]} />
                                            </InfoCard>

                                            <InfoCard title="등록 정보">
                                                <InfoRow label="등록일" value={formatDate(selectedEmployee.registeredDate)} />
                                            </InfoCard>
                                        </>
                                    )}

                                    {activeSection === "work" && (
                                        <>
                                            <InfoCard title="업무 정보">
                                                <InfoRow label="등급" value={selectedEmployee.grade} />
                                                <InfoRow
                                                    label="다음 업무 가능"
                                                    value={selectedEmployee.openToNextWork ? "가능" : "불가"}
                                                />
                                                <InfoRow
                                                    label="근무 지역"
                                                    value={
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {selectedEmployee.workArea.map((area) => (
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
                                        </>
                                    )}

                                    <div
                                        data-component="employees-detail-actions"
                                        className="hidden lg:flex gap-3 pt-2"
                                    >
                                        <Button
                                            variant="outline"
                                            className="flex-1 rounded-full"
                                            onClick={() => handleDeleteRequest(selectedEmployee.id)}
                                        >
                                            삭제
                                        </Button>
                                        <Button
                                            variant="v3"
                                            className="flex-1 rounded-full"
                                            onClick={() => handleEdit(selectedEmployee)}
                                        >
                                            수정
                                        </Button>
                                    </div>
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </DetailPanel>
                ) : (
                    <EmptyState name="employees-empty-state" icon={Users} message="직원을 선택하면 상세 정보가 표시됩니다" className="min-h-[400px]" />
                )}
            </SplitLayout>

            <ConfirmActionModal
                open={deleteTargetEmployeeId != null}
                title="삭제"
                description="정말 삭제하시겠습니까?"
                cancelLabel="취소"
                confirmLabel="삭제"
                loading={deleteEmployee.isPending}
                onOpenChange={(open) => {
                    if (!open && !deleteEmployee.isPending) {
                        setDeleteTargetEmployeeId(null);
                    }
                }}
                onCancel={() => setDeleteTargetEmployeeId(null)}
                onConfirm={handleDeleteConfirm}
            />

            <EmployeeFormDialog
                open={formDialogOpen}
                onClose={handleFormDialogClose}
                employee={editingEmployee}
            />
        </section>
    );
}
