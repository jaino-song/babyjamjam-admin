"use client";

import { useMemo, useState } from "react";

import {
  type Employee,
  type EmployeeStatus,
  useDeleteEmployee,
} from "@/hooks/useEmployees";
import { useInfiniteEmployees } from "@/hooks/useInfiniteEmployees";
import { EmployeeFormDialog } from "@/components/app/employees/EmployeeFormDialog";
import { EmployeeDetailModal } from "@/components/app/employees/EmployeeDetailModal";
import { ConfirmActionModal } from "@/components/app/ui/ConfirmActionModal";
import { useLocale } from "@/providers/LocaleProvider";
import { useToast } from "@/hooks/use-toast";
import { t } from "@/lib/i18n/translations";
import { Badge, ListCard } from "@/components/app/mobile-redesign/primitives";
import {
  DetailTabPills,
  DocRow,
  InfoCard,
  InfoRow,
  MobileDetailSheet,
  MobileSearchBar,
  type AvatarTone,
} from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

const ALL_FILTER = "전체";
const AVATAR_TONES: AvatarTone[] = ["primary", "green", "burgundy", "orange", "purple"];

function pickAvatarTone(name: string, fallback: number): AvatarTone {
  const code = name.charCodeAt(0) || fallback;
  return AVATAR_TONES[code % AVATAR_TONES.length];
}

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

const SECTION_AVATAR_TONES: Record<EmployeeStatus, AvatarTone[]> = {
  available: ["green", "primary"],
  working: ["primary", "green", "orange", "burgundy", "purple"],
  unavailable: ["orange"],
};

type DetailTabId = "basic" | "clients" | "history";

function employeeRowAvatarTone(status: EmployeeStatus, index: number): AvatarTone {
  const tones = SECTION_AVATAR_TONES[status];
  return tones[index % tones.length];
}

function EmployeeDetailContent({
  employee,
  activeTab,
  onTabChange,
  onOpenFullDetail,
  onEdit,
}: {
  employee: Employee;
  activeTab: DetailTabId;
  onTabChange: (id: DetailTabId) => void;
  onOpenFullDetail: () => void;
  onEdit: () => void;
}) {
  const group = GROUPS.find((g) => g.key === employee.status) ?? GROUPS[0];
  const availability = employee.openToNextWork ? "근무 가능" : "근무 불가";
  const availabilityTone = employee.openToNextWork ? "green" : "muted";
  const currentClientInitial = employee.status === "working" ? "박" : employeeInitial(employee.name);

  return (
    <div className="detail-body detail-column" data-component="mobile-employees-detail">
      <div className="client-detail-header pop-up" data-component="mobile-employees-detail-header">
        <div
          className={`client-detail-avatar-lg av-${pickAvatarTone(employee.name, employee.id)}`}
          data-component="mobile-employees-detail-avatar"
        >
          {employeeInitial(employee.name)}
        </div>
        <div className="client-detail-title" data-component="mobile-employees-detail-title">
          <div className="client-detail-name" data-component="mobile-employees-detail-name">{employee.name}</div>
          <div className="client-detail-badges" data-component="mobile-employees-detail-badges">
            <span className={`badge-mini ${group.badgeMini}`}>{group.badge}</span>
            {employee.grade && <span className="badge-mini primary">{employee.grade}</span>}
          </div>
        </div>
      </div>

      <div className="detail-actions" data-component="mobile-employees-detail-actions">
        <button
          className="btn btn-secondary"
          type="button"
          onClick={onEdit}
          data-component="mobile-employees-edit"
        >
          메시지
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={onOpenFullDetail}
          data-component="mobile-employees-detail-full"
        >
          일정 배정
        </button>
      </div>

      <DetailTabPills
        tabs={[
          { id: "basic", label: "기본 정보" },
          { id: "clients", label: "담당 고객" },
          { id: "history", label: "활동 이력" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTabId)}
      />

      <div
        className={`tab-content ${activeTab === "basic" ? "active" : ""}`}
        data-component="mobile-employees-detail-basic"
        data-tab-content="basic"
      >
        <InfoCard title="기본 정보">
          <InfoRow label="이름" value={employee.name} />
          <InfoRow label="연락처" value={employee.phone || "-"} />
          <InfoRow
            label="근무 상태"
            value={group.badge}
            tone={group.badgeMini}
          />
        </InfoCard>
        <InfoCard title="업무 정보" delay={60}>
          <InfoRow label="등급" value={employee.grade || "-"} />
          <InfoRow label="근무 가능 여부" value={availability} tone={availabilityTone} />
          <InfoRow
            label="근무 지역"
            value={employeeAreaSummary(employee)}
          />
        </InfoCard>
        <InfoCard title="등록 정보" delay={120}>
          <InfoRow label="등록일" value={employee.registeredDate || "-"} />
        </InfoCard>
      </div>

      <div
        className={`tab-content ${activeTab === "clients" ? "active" : ""}`}
        data-component="mobile-employees-detail-clients"
        data-tab-content="clients"
      >
        <InfoCard title={employee.status === "working" ? "현재 담당 · 1명" : "현재 담당 · 0명"}>
          {employee.status === "working" ? (
            <DocRow
              initial={currentClientInitial}
              title={`${currentClientInitial}서연 · A라1형`}
              meta="최근 배정된 산모 서비스"
              badge="진행중"
              tone="green"
            />
          ) : (
            <DocRow
              initial={employeeInitial(employee.name)}
              title="배정된 고객이 없습니다"
              meta={employee.openToNextWork ? "새 일정 배정 가능" : "일정 배정 불가"}
              badge={employee.openToNextWork ? "대기" : "불가"}
              tone={employee.openToNextWork ? "primary" : "muted"}
            />
          )}
        </InfoCard>

        <InfoCard title="이전 담당 · 3명" delay={60}>
          <DocRow initial="윤" title="윤정아 · A가1형" meta="3/15 ~ 3/29 완료 · ★ 5.0" badge="완료" tone="muted" />
          <DocRow initial="최" title="최가은 · A라1형" meta="2/20 ~ 3/5 완료 · ★ 4.8" badge="완료" tone="muted" />
          <DocRow initial="한" title="한지수 · A라1형" meta="1/30 ~ 2/13 완료 · ★ 4.7" badge="완료" tone="muted" />
        </InfoCard>
      </div>

      <div
        className={`tab-content ${activeTab === "history" ? "active" : ""}`}
        data-component="mobile-employees-detail-history"
        data-tab-content="history"
      >
        <InfoCard title={`최근 방문 · ${employee.status === "working" ? "박서연" : employee.name}`}>
          <DocRow initial="완" title="5월 9일 (오전) 방문" meta="7시간 활동 · 보고서 제출됨" badge="완료" tone="green" />
          <DocRow initial="완" title="5월 8일 (오전) 방문" meta="8시간 활동 · 보고서 제출됨" badge="완료" tone="green" />
          <DocRow initial="예" title="5월 10일 (오전) 예정" meta={`8시간 · ${employeePrimaryArea(employee)}`} badge="예정" tone="orange" />
        </InfoCard>
      </div>
    </div>
  );
}

export default function EmployeesPage() {
  const locale = useLocale();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [detailSheetTab, setDetailSheetTab] = useState<DetailTabId>("basic");
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const { allEmployees } = useInfiniteEmployees({
    filter: "all",
    search: searchQuery,
  });

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
    setDetailModalOpen(false);
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
        setDetailModalOpen(false);
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
    const items: Array<{ label: string; count: string }> = [
      { label: ALL_FILTER, count: String(allEmployees.length) },
    ];
    for (const g of GROUPS) {
      items.push({ label: g.title, count: String(grouped.counts[g.key]) });
    }
    return items;
  }, [allEmployees.length, grouped.counts]);

  const visibleSections = useMemo(() => {
    const sections: Array<{ key: string; title: string; group: EmployeeGroup; rows: Employee[] }> = [];
    for (const g of GROUPS) {
      if (activeFilter !== ALL_FILTER && g.title !== activeFilter) continue;
      const rows = grouped.map[g.key];
      if (!rows || rows.length === 0) continue;
      sections.push({
        key: g.key,
        title: `${g.title} · ${rows.length}명`,
        group: g,
        rows,
      });
    }
    return sections;
  }, [activeFilter, grouped.map]);

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
              count={`${allEmployees.length}명`}
              actionLabel="+ 추가"
              actionHref="/employees/new"
              filters={filterItems}
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              beforeFilters={
                <MobileSearchBar
                  placeholder="이름, 근무 지역 검색"
                  label="employees"
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
              }
            >
              {visibleSections.length === 0 ? (
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
                visibleSections.map((section) => (
                  <div className="section-block" data-component="mobile-employees-section" key={section.key}>
                    <div className="section-header" data-component="mobile-employees-section-header">
                      {section.title}
                    </div>
                    {section.rows.map((e, idx) => (
                      <button
                        key={e.id}
                        type="button"
                        className="list-item"
                        data-component="mobile-employees-row"
                        onClick={() => handleSelect(e)}
                      >
                        <div
                          className={`list-avatar av-${employeeRowAvatarTone(section.group.key, idx)}`}
                          data-component="mobile-employees-row-avatar"
                        >
                          {employeeInitial(e.name)}
                        </div>
                        <div className="list-info" data-component="mobile-employees-row-info">
                          <div className="list-name" data-component="mobile-employees-row-name">{e.name}</div>
                          <div className="list-meta" data-component="mobile-employees-row-meta">{employeeMeta(e)}</div>
                        </div>
                        <div className="list-right" data-component="mobile-employees-row-status">
                          <Badge label={section.group.badge} tone={section.group.badgeTone} />
                        </div>
                      </button>
                    ))}
                  </div>
                ))
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
              onOpenFullDetail={() => setDetailModalOpen(true)}
              onEdit={() => handleEdit(selected)}
            />
          ) : (
            <div className="detail-body" data-component="mobile-employees-detail-empty" />
          )
        }
      />

      <EmployeeDetailModal
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        employee={selected}
        onEdit={handleEdit}
        onDelete={handleDeleteRequest}
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
