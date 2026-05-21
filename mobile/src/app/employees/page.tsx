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
import { EmployeesRedesign } from "@/components/app/mobile-redesign/EmployeesRedesign";
import type { EmployeesRedesignFilter } from "@/components/app/mobile-redesign/EmployeesRedesign";
import type { ListRow, SectionRows } from "@/components/app/mobile-redesign/mockup-data";

const AVATAR_TONES: NonNullable<ListRow["avatarTone"]>[] = [
  "primary",
  "green",
  "burgundy",
  "orange",
  "purple",
];

function pickAvatarTone(name: string, fallback: number): NonNullable<ListRow["avatarTone"]> {
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
  badgeTone: ListRow["badgeTone"];
}

const GROUPS: EmployeeGroup[] = [
  { key: "available", title: "근무 가능", badge: "근무 가능", badgeTone: "orange" },
  { key: "working", title: "근무 중", badge: "근무 중", badgeTone: "green" },
  { key: "unavailable", title: "근무 불가", badge: "근무 불가", badgeTone: "muted" },
];

export default function EmployeesPage() {
  const locale = useLocale();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Employee | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
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
    setDetailOpen(true);
  };

  const handleEdit = (employee: Employee) => {
    setEditing(employee);
    setFormOpen(true);
    setDetailOpen(false);
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
        setDetailOpen(false);
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

  const { sections, filters, total } = useMemo(() => {
    const counts: Record<EmployeeStatus, number> = {
      available: 0,
      working: 0,
      unavailable: 0,
    };
    const groupedRows: Partial<Record<EmployeeStatus, ListRow[]>> = {};

    let i = 0;
    for (const employee of allEmployees) {
      const group = GROUPS.find((g) => g.key === employee.status);
      if (!group) continue;
      counts[group.key] = (counts[group.key] ?? 0) + 1;
      const row: ListRow = {
        id: employee.id,
        name: employee.name,
        meta: employeeMeta(employee),
        initial: employeeInitial(employee.name),
        badge: group.badge,
        badgeTone: group.badgeTone,
        avatarTone: pickAvatarTone(employee.name, i++),
        onClick: () => handleSelect(employee),
      };
      groupedRows[group.key] = groupedRows[group.key] ?? [];
      groupedRows[group.key]!.push(row);
    }

    const builtSections: SectionRows[] = GROUPS.filter((g) => (groupedRows[g.key]?.length ?? 0) > 0).map((g) => ({
      title: `${g.title} · ${groupedRows[g.key]!.length}명`,
      rows: groupedRows[g.key]!,
    }));

    const builtFilters: EmployeesRedesignFilter[] = [
      { label: "전체", count: String(allEmployees.length), active: true },
      ...GROUPS.filter((g) => counts[g.key] > 0).map((g) => ({
        label: g.title,
        count: String(counts[g.key]),
      })),
    ];

    return { sections: builtSections, filters: builtFilters, total: allEmployees.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEmployees]);

  return (
    <>
      <EmployeesRedesign
        sections={sections}
        filters={filters}
        total={total}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <EmployeeDetailModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
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
