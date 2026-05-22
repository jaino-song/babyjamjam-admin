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

function employeeMeta(e: Employee) {
  const area = (e.workArea ?? []).join(" · ") || "근무 지역 미설정";
  const grade = e.grade ? ` · ${e.grade}등급` : "";
  return `${area}${grade}`;
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

type DetailTabId = "basic" | "work" | "contact";

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
  const [actionStatus, setActionStatus] = useState("");
  const group = GROUPS.find((g) => g.key === employee.status) ?? GROUPS[0];

  return (
    <div className="detail-body detail-column" data-component="mobile-employees-detail">
      <div className="client-detail-header pop-up">
        <div className={`client-detail-avatar-lg av-${pickAvatarTone(employee.name, employee.id)}`}>
          {employeeInitial(employee.name)}
        </div>
        <div className="client-detail-title">
          <div className="client-detail-name">{employee.name}</div>
          <div className="client-detail-badges">
            <span className={`badge-mini ${group.badgeMini}`}>{group.badge}</span>
            {employee.grade && <span className="badge-mini primary">{employee.grade}등급</span>}
          </div>
        </div>
      </div>

      <div className="detail-actions">
        <button
          className="btn btn-secondary"
          type="button"
          onClick={onEdit}
          data-component="mobile-employees-edit"
        >
          편집
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => {
            onOpenFullDetail();
            setActionStatus("전체 상세 정보를 엽니다.");
          }}
          data-component="mobile-employees-detail-full"
        >
          전체 정보
        </button>
      </div>
      {actionStatus && (
        <div className="action-feedback" role="status">
          {actionStatus}
        </div>
      )}

      <DetailTabPills
        tabs={[
          { id: "basic", label: "기본 정보" },
          { id: "work", label: "근무 정보" },
          { id: "contact", label: "연락처" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTabId)}
      />

      <div className={`tab-content ${activeTab === "basic" ? "active" : ""}`} data-tab-content="basic">
        <InfoCard title="기본 정보">
          <InfoRow label="이름" value={employee.name} />
          <InfoRow label="등급" value={employee.grade || "-"} />
          <InfoRow
            label="현재 상태"
            value={group.badge}
            tone={group.badgeMini as never}
          />
        </InfoCard>
        <InfoCard title="등록 정보" delay={60}>
          <InfoRow label="등록일" value={employee.registeredDate || "-"} />
        </InfoCard>
      </div>

      <div className={`tab-content ${activeTab === "work" ? "active" : ""}`} data-tab-content="work">
        <InfoCard title="근무 정보">
          <InfoRow
            label="근무 지역"
            value={(employee.workArea ?? []).join(", ") || "미설정"}
          />
          <InfoRow
            label="다음 업무 가능"
            value={employee.openToNextWork ? "가능" : "불가"}
            tone={employee.openToNextWork ? "green" : "muted"}
          />
        </InfoCard>
      </div>

      <div className={`tab-content ${activeTab === "contact" ? "active" : ""}`} data-tab-content="contact">
        <InfoCard title="연락처">
          <InfoRow label="휴대전화" value={employee.phone || "-"} />
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
      if (grouped.counts[g.key] > 0) {
        items.push({ label: g.title, count: String(grouped.counts[g.key]) });
      }
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
                  placeholder="이름, 활동 지역 검색"
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
                  <div className="section-block" key={section.key}>
                    <div className="section-header">{section.title}</div>
                    {section.rows.map((e, idx) => (
                      <button
                        key={e.id}
                        type="button"
                        className="list-item"
                        data-component="mobile-employees-row"
                        onClick={() => handleSelect(e)}
                      >
                        <div className={`list-avatar av-${pickAvatarTone(e.name, e.id + idx)}`}>
                          {employeeInitial(e.name)}
                        </div>
                        <div className="list-info">
                          <div className="list-name">{e.name}</div>
                          <div className="list-meta">{employeeMeta(e)}</div>
                        </div>
                        <div className="list-right">
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
            <div className="detail-body" />
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
