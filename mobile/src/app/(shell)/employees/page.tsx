"use client";

import { useMemo, useState } from "react";
import {
  type Employee,
  type EmployeeStatus,
  useDeleteEmployee,
} from "@/hooks/useEmployees";
import { useInfiniteEmployees } from "@/hooks/useInfiniteEmployees";
import { useListInfiniteScroll } from "@/hooks/useListInfiniteScroll";
import { EmployeeFormDialog } from "@/components/app/employees/EmployeeFormDialog";
import { EmployeeDetailContent, type EmployeeDetailTabId } from "@/components/app/employees/EmployeeDetailContent";
import { MobileTwoButtonModal } from "@/components/app/ui/MobileTwoButtonModal";
import { useLocale } from "@/providers/LocaleProvider";
import { useToast } from "@/hooks/use-toast";
import { t } from "@/lib/i18n/translations";
import {
  Badge,
  ListCard,
  ListCountSkeleton,
  ListItemRow,
  ListLoadMoreSentinel,
  ListRowsSkeleton,
} from "@/components/app/mobile-redesign/primitives";
import {
  MobileDetailSheet,
  MobileSearchBar,
} from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";
import { canManageBranchFromAuthQuery } from "@/lib/auth/branch-role-policy";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { getUserErrorMessage } from "@babyjamjam/shared";
import {
  buildAllEmployeeRowsForList,
  GROUPS,
  groupForEmployee,
  type EmployeeGroup,
} from "@/lib/employee/list-helpers";
const ALL_FILTER = "전체";
function employeeInitial(name: string) {
  return name.trim().charAt(0) || "?";
}

function employeeWorkAreas(e: Employee) {
  return (e.workArea ?? []).filter(Boolean);
}

function employeePrimaryArea(e: Employee) {
  return employeeWorkAreas(e)[0] ?? "근무 지역 미설정";
}

function employeeMeta(e: Employee) {
  if (e.status === "unavailable") return "복귀 일정 미정";
  return employeePrimaryArea(e);
}

export default function EmployeesPage() {
  const locale = useLocale();
  const { toast } = useToast();
  const authUserQuery = useGetAuthUser();
  const canManageEmployees = canManageBranchFromAuthQuery(authUserQuery);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [detailSheetTab, setDetailSheetTab] = useState<EmployeeDetailTabId>("basic");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const { allEmployees, filteredEmployees, isLoading } = useInfiniteEmployees({
    filter: "all",
    search: searchQuery,
  });
  const isEmployeesFetching = isLoading && filteredEmployees.length === 0;
  const selectedEmployee = selected
    ? allEmployees.find((employee) => employee.id === selected.id) ?? selected
    : null;

  const deleteEmployee = useDeleteEmployee();

  const handleSelect = (employee: Employee) => {
    setSelected(employee);
    setDetailSheetTab("basic");
  };

  const handleCloseDetailSheet = () => {
    setSelected(null);
  };

  const handleEdit = (employee: Employee) => {
    setEditing(employee);
    setFormOpen(true);
  };

  const handleDeleteRequest = async (id: number): Promise<boolean> => {
    setDeleteTarget(id);
    return false;
  };

  const handleDeleteConfirm = async () => {
    if (deleteTarget == null) return;
    try {
      await deleteEmployee.mutateAsync(deleteTarget);
      if (selected?.id === deleteTarget) {
        setSelected(null);
      }
      setDeleteTarget(null);
      toast({
        variant: "success",
        title: t(locale, "employees.delete-success"),
        description: t(locale, "employees.delete-success-description"),
      });
    } catch (error) {
      setDeleteTarget(null);
      toast({
        title: t(locale, "employees.delete-fail"),
        description: getUserErrorMessage(
          error,
          t(locale, "employees.delete-fail-description"),
        ),
        variant: "destructive",
      });
    }
  };

  const grouped = useMemo(() => {
    const counts: Record<EmployeeStatus, number> = {
      available: 0,
      working: 0,
      unavailable: 0,
    };
    const map: Partial<Record<EmployeeStatus, Employee[]>> = {};
    for (const employee of filteredEmployees) {
      const group = GROUPS.find((g) => g.key === employee.status);
      if (!group) continue;
      counts[group.key] = (counts[group.key] ?? 0) + 1;
      map[group.key] = map[group.key] ?? [];
      map[group.key]!.push(employee);
    }
    return { counts, map };
  }, [filteredEmployees]);

  const filterItems = useMemo(() => {
    if (isEmployeesFetching) {
      return [
        { label: ALL_FILTER, count: "", skeleton: true },
        ...GROUPS.map((g) => ({ label: g.title, count: "", skeleton: true })),
      ];
    }

    const items: Array<{ label: string; count: string }> = [
      { label: ALL_FILTER, count: String(filteredEmployees.length) },
    ];
    for (const g of GROUPS) {
      items.push({ label: g.title, count: String(grouped.counts[g.key]) });
    }
    return items;
  }, [filteredEmployees.length, grouped.counts, isEmployeesFetching]);

  const sectionsFull = useMemo(() => {
    type Section = {
      key: string;
      title: string;
      group: EmployeeGroup;
      fullRows: Employee[];
      fullCount: number;
    };

    // 전체: 상태 grouping 없이 최근 활동순 단일 리스트 (총 8개부터 teaser → 무한 스크롤).
    if (activeFilter === ALL_FILTER) {
      const flat = buildAllEmployeeRowsForList(filteredEmployees);
      return flat.length > 0
        ? [{ key: "all", title: "", group: GROUPS[0], fullRows: flat, fullCount: flat.length }]
        : [];
    }

    // 개별 필터: 해당 상태 그룹 단일 섹션.
    const sections: Section[] = [];
    for (const g of GROUPS) {
      if (g.title !== activeFilter) continue;
      const rows = grouped.map[g.key];
      if (!rows || rows.length === 0) continue;
      sections.push({
        key: g.key,
        title: `${g.title} · ${rows.length}명`,
        group: g,
        fullRows: rows,
        fullCount: rows.length,
      });
    }
    return sections;
  }, [activeFilter, grouped.map, filteredEmployees]);

  const maxFullCount = useMemo(
    () => sectionsFull.reduce((m, s) => Math.max(m, s.fullCount), 0),
    [sectionsFull],
  );

  const { visibleCount, isInitialLoad, hasMore, sentinelRef, scrollContainerRef, loadMore } =
    useListInfiniteScroll({
      resetKey: `${activeFilter}::${searchQuery}`,
      totalItems: maxFullCount,
    });

  const visibleSections = useMemo(
    () =>
      sectionsFull
        .map((s) => ({ ...s, rows: s.fullRows.slice(0, visibleCount) }))
        .filter((s) => s.rows.length > 0),
    [sectionsFull, visibleCount],
  );

  return (
    <>
      <MobileDetailSheet
        data-component="mobile_employees_detail-sheet"
        name="employees"
        isOpen={Boolean(selected)}
        onClose={handleCloseDetailSheet}
        list={
          <div className="shell-content"
            data-component="mobile_employees_detail-sheet_stack_list-page_content"
            data-slot="employees-content">
            <ListCard
              data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card"
              title="제공인력"
              count={
                isEmployeesFetching
                  ? <ListCountSkeleton
                      data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_header_count-skeleton"
                    />
                  : `${filteredEmployees.length}명`
              }
              actionLabel="+ 추가"
              actionHref="/employees/new"
              filters={filterItems}
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              scrollRef={scrollContainerRef}
              loadMore={isInitialLoad && hasMore}
              onLoadMore={loadMore}
              beforeFilters={
                <MobileSearchBar
                  data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_search"
                  placeholder="이름, 근무 지역 검색"
                  label="employees"
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
              }
            >
              {isEmployeesFetching ? (
                <ListRowsSkeleton
                  data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_rows-skeleton"
                />
              ) : visibleSections.length === 0 ? (
                <div
                  style={{
                    padding: "32px 16px",
                    textAlign: "center",
                    fontSize: "0.82rem",
                    color: "hsl(var(--v3-text-muted))",
                  }}
                  data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_empty"
                >
                  {searchQuery.trim() || activeFilter !== ALL_FILTER
                    ? "조건에 맞는 제공인력이 없습니다."
                    : "등록된 제공인력이 없습니다."}
                </div>
              ) : (
                <>
                {visibleSections.map((section) => (
                  <div className="section-block" data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_section" key={section.key}>
                    {section.title && (
                      <div className="section-header" data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_section_header">
                        {section.title}
                      </div>
                    )}
                    {section.rows.map((e, idx) => {
                      const g = groupForEmployee(e);
                      return (
                        <ListItemRow
                          key={e.id}
                          data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_section_row"
                          style={{ animationDelay: `${Math.min(idx, 4) * 40}ms` }}
                          left={
                            <div
                              className={`list-avatar av-${g.badgeTone}`}
                              data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_section_row_avatar"
                            >
                              {employeeInitial(e.name)}
                            </div>
                          }
                          name={e.name}
                          meta={employeeMeta(e)}
                          right={
                            <span
                              className="list-row-badges mobile-employees-row-badges"
                              data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_section_row_badges"
                            >
                              <Badge label={g.badge} tone={g.badgeTone} />
                            </span>
                          }
                          onClick={() => handleSelect(e)}
                        />
                      );
                    })}
                  </div>
                ))}
                {!isInitialLoad && hasMore && (
                  <ListLoadMoreSentinel
                    data-component="mobile_employees_detail-sheet_stack_list-page_content_list-card_body_load-sentinel"
                    sentinelRef={sentinelRef}
                  />
                )}
                </>
              )}
            </ListCard>
          </div>
        }
        detail={
          selectedEmployee ? (
            <EmployeeDetailContent
              employee={selectedEmployee}
              activeTab={detailSheetTab}
              onTabChange={setDetailSheetTab}
              onEdit={() => handleEdit(selectedEmployee)}
              onDelete={() => handleDeleteRequest(selectedEmployee.id)}
              canManage={canManageEmployees}
            />
          ) : (
            <div className="detail-body" data-component="mobile_employees_detail-sheet_stack_detail-page_empty" />
          )
        }
      />

      <MobileTwoButtonModal
        data-component="mobile_employees_detail-sheet_delete-modal"
        open={deleteTarget != null}
        title={t(locale, "employees.delete-confirm.title")}
        description={t(locale, "employees.delete-confirm.message")}
        cancelLabel={t(locale, "common.cancel")}
        confirmLabel={t(locale, "common.delete")}
        loading={deleteEmployee.isPending}
        onOpenChange={(open) => {
          if (!open && !deleteEmployee.isPending) setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />

      <EmployeeFormDialog
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        employee={editing}
      />
    </>
  );
}
