"use client";

import { useState, useMemo } from "react";
import { IconButton, Chip, Box, Alert } from "@mui/material";
import { Plus } from "lucide-react";
import { useLocale } from "../LocaleProvider";
import { t, Locale } from "@/app/lib/i18n/translations";
import { ContentPaper } from "../root/content-paper";
import {
    Employee,
    EmployeeStatus,
    useEmployees,
    useDeleteEmployee,
} from "@/app/hooks/useEmployees";
import { EmployeeFormDialog } from "./EmployeeFormDialog";
import { EmployeeDetailModal } from "./EmployeeDetailModal";
import { DataTable, type DataTableColumn, type FilterOption } from "@/app/(components)/ui/datatable";

const formatPhoneNumber = (phone: string | null | undefined): string => {
    if (!phone) return "-";
    const numbers = phone.replace(/[^\d]/g, "");
    if (numbers.length <= 3) return numbers || "-";
    if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
};

const STATUS_CHIP_WIDTH = 65;

const getStatusChip = (status: EmployeeStatus | undefined, locale: Locale) => {
    const chipSx = { minWidth: STATUS_CHIP_WIDTH, justifyContent: "center" };
    switch (status) {
        case "available":
            return <Chip label={t(locale, "employees.status.available")} color="success" size="small" sx={chipSx} />;
        case "working":
            return <Chip label={t(locale, "employees.status.working")} color="warning" size="small" sx={chipSx} />;
        case "unavailable":
        default:
            return <Chip label={t(locale, "employees.status.unavailable")} color="default" size="small" sx={chipSx} />;
    }
};

const statusFilterOptions: FilterOption[] = [
    { label: "전체", value: null, color: "default" },
    { label: "가능", value: "available", color: "success" },
    { label: "근무중", value: "working", color: "warning" },
    { label: "불가", value: "unavailable", color: "default" },
];

export function EmployeesTable() {
    const locale = useLocale();
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
    const [selectedFilter, setSelectedFilter] = useState<string | null>(null);

    const { data: employees, isLoading, error } = useEmployees();
    const deleteEmployee = useDeleteEmployee();

    const filteredEmployees = useMemo(() => {
        if (!selectedFilter) return employees || [];
        return (employees || []).filter(emp => emp.status === selectedFilter);
    }, [employees, selectedFilter]);

    const handleAddNew = () => {
        setEditingEmployee(null);
        setFormDialogOpen(true);
    };

    const handleRowClick = (employee: Employee) => {
        setSelectedEmployee(employee);
        setDetailModalOpen(true);
    };

    const handleEdit = (employee: Employee) => {
        setEditingEmployee(employee);
        setFormDialogOpen(true);
    };

    const handleDelete = async (id: number): Promise<boolean> => {
        if (window.confirm(t(locale, "employees.delete-confirm.message"))) {
            try {
                await deleteEmployee.mutateAsync(id);
                return true; // Deletion succeeded
            } catch (err) {
                console.error("Failed to delete employee:", err);
                // Show error to user
                alert(t(locale, "employees.delete-confirm.error"));
                return false; // Deletion failed
            }
        }
        return false; // User cancelled
    };

    const handleFormDialogClose = () => {
        setFormDialogOpen(false);
        setEditingEmployee(null);
    };

    const handleDetailModalClose = () => {
        setDetailModalOpen(false);
        setSelectedEmployee(null);
    };

    type EmployeeRow = Employee & Record<string, unknown>;
    const tableData = (filteredEmployees || []) as EmployeeRow[];

    const columns: DataTableColumn<EmployeeRow>[] = [
        {
            key: "name",
            header: t(locale, "employees.table.name"),
            width: "30%",
            align: "center",
        },
        {
            key: "status",
            header: t(locale, "employees.table.open-status"),
            width: "30%",
            align: "center",
            render: (employee) => getStatusChip(employee.status as EmployeeStatus | undefined, locale),
        },
        {
            key: "phone",
            header: t(locale, "employees.table.contact"),
            width: "40%",
            align: "center",
            render: (employee) => formatPhoneNumber(employee.phone as string | null | undefined),
        },
    ];

    const toolbarActions = (
        <IconButton size="medium" sx={{ color: "#1e88e5" }} onClick={handleAddNew}>
            <Plus size={30} strokeWidth={2} />
        </IconButton>
    );

    if (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return (
            <ContentPaper
                title={t(locale, "employees.title")}
                subtitle={t(locale, "employees.subtitle")}
                sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
            >
                <Box p={3}>
                    <Alert severity="error">직원 목록을 불러오는데 실패했습니다: {errorMessage}</Alert>
                </Box>
            </ContentPaper>
        );
    }

    return (
        <ContentPaper
            title={t(locale, "employees.title")}
            subtitle={t(locale, "employees.subtitle")}
            sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
        >
            <Box data-component="employees-table-container">
                <DataTable<EmployeeRow>
                    data={tableData}
                    columns={columns}
                    isLoading={isLoading}
                    getRowKey={(employee) => String(employee.id)}
                    searchEnabled={true}
                    searchPlaceholder="검색"
                    searchFields={["name", "phone"]}
                    filterOptions={statusFilterOptions}
                    filterValue={selectedFilter}
                    onFilterChange={(value) => setSelectedFilter(value)}
                    pageSize={8}
                    onRowClick={handleRowClick}
                    toolbarActions={toolbarActions}
                    emptyMessage={t(locale, "employees.no-employees")}
                />

                {/* Detail Modal */}
                <EmployeeDetailModal
                    open={detailModalOpen}
                    onClose={handleDetailModalClose}
                    employee={selectedEmployee}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                />

                {/* Form Dialog */}
                <EmployeeFormDialog
                    open={formDialogOpen}
                    onClose={handleFormDialogClose}
                    employee={editingEmployee}
                />
            </Box>
        </ContentPaper>
    );
}
