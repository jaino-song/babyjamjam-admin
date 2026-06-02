"use client";

import { useMemo, useState } from "react";
import { MoreVertical, SquarePen, Trash2 } from "lucide-react";

import {
  type Employee,
  type EmployeeStatus,
  useDeleteEmployee,
} from "@/hooks/useEmployees";
import { useInfiniteEmployees } from "@/hooks/useInfiniteEmployees";
import { useListInfiniteScroll } from "@/hooks/useListInfiniteScroll";
import { EmployeeFormDialog } from "@/components/app/employees/EmployeeFormDialog";
import { ConfirmActionModal } from "@/components/app/ui/ConfirmActionModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/providers/LocaleProvider";
import { useToast } from "@/hooks/use-toast";
import { t } from "@/lib/i18n/translations";
import {
  Badge,
  ListCard,
  ListCountSkeleton,
  ListItemRow,
  ListLoadMoreButton,
  ListLoadMoreSentinel,
  ListRowsSkeleton,
} from "@/components/app/mobile-redesign/primitives";
import {
  DetailTabPills,
  DocRow,
  InfoCard,
  InfoRow,
  MobileDetailHeader,
  MobileDetailPage,
  MobileDetailSheet,
  MobileSearchBar,
  MobileDetailTabPanel,
} from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

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

function employeeAreaSummary(e: Employee) {
  const areas = employeeWorkAreas(e);
  if (areas.length === 0) return "미설정";
  return areas.join(", ");
}

function formatPhoneNumber(phone: string | null | undefined): string {
  if (!phone) return "-";
  const numbers = phone.replace(/[^\d]/g, "");
  if (numbers.length <= 3) return numbers || "-";
  if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
  return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
}

function employeeMeta(e: Employee) {
  if (e.status === "unavailable") return "복귀 일정 미정";
  return employeePrimaryArea(e);
}

interface EmployeeGroup {
  key: EmployeeStatus;
  title: string;
  badge: string;
  badgeTone: "orange" | "green" | "muted";
  badgeMini: "orange" | "green" | "muted";
}

const GROUPS: EmployeeGroup[] = [
  { key: "available", title: "근무 가능", badge: "근무 가능", badgeTone: "orange", badgeMini: "orange" },
  { key: "working", title: "근무 중", badge: "근무 중", badgeTone: "green", badgeMini: "green" },
  { key: "unavailable", title: "근무 불가", badge: "근무 불가", badgeTone: "muted", badgeMini: "muted" },
];

// "최근 활동순" 정렬 키 — employees는 활동 timestamp가 없어 등록일(registeredDate) 기준, 동률은 최신 id.
function employeeRecency(e: Employee): number {
  const t = e.registeredDate ? new Date(e.registeredDate).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

function formatRegisteredDate(value: string | null | undefined): string {
  if (!value) return "-";

  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    const [, year, month, day] = isoDate;
    return `${year}년 ${month}월 ${day}일`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}년 ${month}월 ${day}일`;
}

function groupForEmployee(e: Employee): EmployeeGroup {
  return GROUPS.find((g) => g.key === e.status) ?? GROUPS[0];
}

type DetailTabId = "basic" | "clients" | "history";

function EmployeeDetailContent({
  employee,
  activeTab,
  onTabChange,
  onEdit,
  onDelete,
}: {
  employee: Employee;
  activeTab: DetailTabId;
  onTabChange: (id: DetailTabId) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const group = GROUPS.find((g) => g.key === employee.status) ?? GROUPS[0];
  const availability = employee.openToNextWork ? "근무 가능" : "근무 불가";
  const availabilityTone = employee.openToNextWork ? "green" : "muted";
  const currentClientInitial = employee.status === "working" ? "박" : employeeInitial(employee.name);

  return (
    <MobileDetailPage name="employees">
      <MobileDetailHeader
        name="employees"
        avatar={employeeInitial(employee.name)}
        avatarTone={group.badgeTone}
        title={employee.name}
        badges={[
          { label: group.badge, tone: group.badgeMini },
          ...(employee.grade ? [{ label: employee.grade, tone: "primary" as const }] : []),
        ]}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-v3-text-muted transition-colors hover:bg-v3-dim-white"
                aria-label="제공인력 옵션"
                data-component="mobile-employees-detail-menu-trigger"
              >
                <MoreVertical size={20} strokeWidth={2} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={4}
              className="z-[200] w-max min-w-[5.5rem] rounded-md p-0"
              data-component="mobile-employees-detail-menu"
            >
              <DropdownMenuItem
                onClick={onEdit}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile-employees-detail-menu-edit"
              >
                <SquarePen className="size-[15px]" strokeWidth={2} />
                수정
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={onDelete}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile-employees-detail-menu-delete"
              >
                <Trash2 className="size-[15px]" strokeWidth={2} />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <DetailTabPills
        tabs={[
          { id: "basic", label: "제공인력 정보" },
          { id: "clients", label: "담당 고객" },
          { id: "history", label: "근무 내역" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTabId)}
      />

      <MobileDetailTabPanel
        name="employees"
        tabId="basic"
        activeTab={activeTab}
        dataComponent="mobile-employees-detail-basic"
      >
        <InfoCard title="제공인력 정보">
          <InfoRow label="이름" value={employee.name} />
          <InfoRow label="연락처" value={formatPhoneNumber(employee.phone)} />
          <InfoRow
            label="근무 가능 여부"
            value={availability}
            tone={availabilityTone}
          />
          <InfoRow label="등급" value={employee.grade || "-"} />
          <InfoRow
            label="근무 지역"
            value={employeeAreaSummary(employee)}
          />
        </InfoCard>
        <InfoCard title="등록 정보" delay={60}>
          <InfoRow label="등록일" value={formatRegisteredDate(employee.registeredDate)} />
        </InfoCard>
      </MobileDetailTabPanel>

      <MobileDetailTabPanel
        name="employees"
        tabId="clients"
        activeTab={activeTab}
        dataComponent="mobile-employees-detail-clients"
      >
        <InfoCard title="현재 담당">
          {employee.status === "working" ? (
            <DocRow
              initial={currentClientInitial}
              title={`${currentClientInitial}서연`}
              meta="최근 배정된 산모 서비스"
              badge="진행중"
              tone="green"
            />
          ) : (
            <div
              className="detail-empty-state"
              data-component="mobile-employees-clients-empty"
            >
              배정된 고객이 없습니다.
            </div>
          )}
        </InfoCard>

      </MobileDetailTabPanel>

      <MobileDetailTabPanel
        name="employees"
        tabId="history"
        activeTab={activeTab}
        dataComponent="mobile-employees-detail-history"
      >
        <InfoCard title="이전 담당">
          <div
            className="detail-empty-state"
            data-component="mobile-employees-history-empty"
          >
            근무 내역이 없습니다.
          </div>
        </InfoCard>
      </MobileDetailTabPanel>
    </MobileDetailPage>
  );
}

export default function EmployeesPage() {
  const locale = useLocale();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [detailSheetTab, setDetailSheetTab] = useState<DetailTabId>("basic");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const { allEmployees, isLoading } = useInfiniteEmployees({
    filter: "all",
    search: searchQuery,
  });
  const isEmployeesFetching = isLoading && allEmployees.length === 0;

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
        title: t(locale, "employees.delete-success"),
        description: t(locale, "employees.delete-success-description"),
      });
    } catch {
      toast({
        title: t(locale, "employees.delete-fail"),
        description: t(locale, "employees.delete-fail-description"),
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
    for (const employee of allEmployees) {
      const group = GROUPS.find((g) => g.key === employee.status);
      if (!group) continue;
      counts[group.key] = (counts[group.key] ?? 0) + 1;
      map[group.key] = map[group.key] ?? [];
      map[group.key]!.push(employee);
    }
    return { counts, map };
  }, [allEmployees]);

  const filterItems = useMemo(() => {
    if (isEmployeesFetching) {
      return [
        { label: ALL_FILTER, count: "", skeleton: true },
        ...GROUPS.map((g) => ({ label: g.title, count: "", skeleton: true })),
      ];
    }

    const items: Array<{ label: string; count: string }> = [
      { label: ALL_FILTER, count: String(allEmployees.length) },
    ];
    for (const g of GROUPS) {
      items.push({ label: g.title, count: String(grouped.counts[g.key]) });
    }
    return items;
  }, [allEmployees.length, grouped.counts, isEmployeesFetching]);

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
      const flat = allEmployees
        .filter((e) => GROUPS.some((g) => g.key === e.status))
        .sort((a, b) => employeeRecency(b) - employeeRecency(a) || b.id - a.id);
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
  }, [activeFilter, grouped.map, allEmployees]);

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
        name="employees"
        isOpen={Boolean(selected)}
        onClose={handleCloseDetailSheet}
        list={
          <div className="shell-content" data-component="mobile-employees-content">
            <ListCard
              title="제공인력"
              count={
                isEmployeesFetching
                  ? <ListCountSkeleton dataComponentPrefix="mobile-employees" />
                  : `${allEmployees.length}명`
              }
              actionLabel="+ 추가"
              actionHref="/employees/new"
              filters={filterItems}
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              scrollRef={scrollContainerRef}
              loadMoreFooter={
                isInitialLoad && hasMore ? (
                  <ListLoadMoreButton
                    onLoadMore={loadMore}
                    dataComponentPrefix="mobile-employees"
                  />
                ) : null
              }
              beforeFilters={
                <MobileSearchBar
                  placeholder="이름, 근무 지역 검색"
                  label="employees"
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
              }
            >
              {isEmployeesFetching ? (
                <ListRowsSkeleton dataComponentPrefix="mobile-employees" />
              ) : visibleSections.length === 0 ? (
                <div
                  style={{
                    padding: "32px 16px",
                    textAlign: "center",
                    fontSize: "0.82rem",
                    color: "hsl(var(--v3-text-muted))",
                  }}
                  data-component="mobile-employees-empty"
                >
                  {searchQuery.trim() || activeFilter !== ALL_FILTER
                    ? "조건에 맞는 제공인력이 없습니다."
                    : "등록된 제공인력이 없습니다."}
                </div>
              ) : (
                <>
                {visibleSections.map((section) => (
                  <div className="section-block" data-component="mobile-employees-section" key={section.key}>
                    {section.title && (
                      <div className="section-header" data-component="mobile-employees-section-header">
                        {section.title}
                      </div>
                    )}
                    {section.rows.map((e, idx) => {
                      const g = groupForEmployee(e);
                      return (
                        <ListItemRow
                          key={e.id}
                          dataComponent="mobile-employees-row"
                          style={{ animationDelay: `${Math.min(idx, 4) * 40}ms` }}
                          left={
                            <div
                              className={`list-avatar av-${g.badgeTone}`}
                              data-component="mobile-employees-row-avatar"
                            >
                              {employeeInitial(e.name)}
                            </div>
                          }
                          name={e.name}
                          meta={employeeMeta(e)}
                          right={
                            <span
                              className="list-row-badges mobile-employees-row-badges"
                              data-component="mobile-employees-row-badges"
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
                    sentinelRef={sentinelRef}
                    dataComponentPrefix="mobile-employees"
                  />
                )}
                </>
              )}
            </ListCard>
          </div>
        }
        detail={
          selected ? (
            <EmployeeDetailContent
              employee={selected}
              activeTab={detailSheetTab}
              onTabChange={setDetailSheetTab}
              onEdit={() => handleEdit(selected)}
              onDelete={() => handleDeleteRequest(selected.id)}
            />
          ) : (
            <div className="detail-body" data-component="mobile-employees-detail-empty" />
          )
        }
      />

      <ConfirmActionModal
        open={deleteTarget != null}
        title={t(locale, "common.delete")}
        description={t(locale, "employees.delete-confirm")}
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
