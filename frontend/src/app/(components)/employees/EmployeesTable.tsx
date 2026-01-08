"use client";

import { useState } from "react";
import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    IconButton,
    Chip,
    CircularProgress,
    Alert,
    Divider,
} from "@mui/material";
import { Search, Plus } from "lucide-react";
import { useLocale } from "../LocaleProvider";
import { t, Locale } from "@/app/lib/i18n/translations";
import { ComponentContainer } from "../root/ComponentContainer";
import {
    Employee,
    useEmployees,
    useDeleteEmployee,
} from "@/app/hooks/useEmployees";
import { EmployeeFormDialog } from "./EmployeeFormDialog";
import { EmployeeDetailModal } from "./EmployeeDetailModal";

const getStatusChip = (openToNextWork: boolean, locale: Locale) => {
    if (openToNextWork) {
        return <Chip label={t(locale, "employees.status.available")} color="success" size="small" />;
    }
    return <Chip label={t(locale, "employees.status.unavailable")} color="default" size="small" />;
};

export function EmployeesTable() {
    const locale = useLocale();
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

    const { data: employees, isLoading, error } = useEmployees();
    const deleteEmployee = useDeleteEmployee();

    // Use all employees (search not implemented in icon-button toolbar yet)
    const filteredEmployees = employees || [];

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

    const handleDelete = async (id: number) => {
        if (window.confirm(t(locale, "employees.delete-confirm.message"))) {
            try {
                await deleteEmployee.mutateAsync(id);
            } catch (err) {
                console.error("Failed to delete employee:", err);
            }
        }
    };

    const handleFormDialogClose = () => {
        setFormDialogOpen(false);
        setEditingEmployee(null);
    };

    const handleDetailModalClose = () => {
        setDetailModalOpen(false);
        setSelectedEmployee(null);
    };

    if (isLoading) {
        return (
            <ComponentContainer textJSON="employees">
                <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                    <CircularProgress />
                </Box>
            </ComponentContainer>
        );
    }

    if (error) {
        return (
            <ComponentContainer textJSON="employees">
                <Alert severity="error">{t(locale, "common.error")}</Alert>
            </ComponentContainer>
        );
    }

    return (
        <ComponentContainer textJSON="employees">
            <Box data-component="employees-table-container">
                {/* Toolbar */}
                <Box
                    data-component="employees-toolbar"
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-around",
                    }}
                >
                    <Box
                        data-component="employees-toolbar-buttons"
                        sx={{
                            display: "flex",
                            justifyContent: "space-around",
                            alignItems: "center",
                            gap: 1,
                            width: "100%"
                        }}
                    >
                        {/* Search Button */}
                        <IconButton size="medium" sx={{ color: "grey.600" }}>
                            <Search size={24} strokeWidth={2} />
                        </IconButton>

                        {/* Spacer */}
                        <Box sx={{ flex: 1 }} />

                        {/* Add Button */}
                        <IconButton
                            size="medium"
                            sx={{ color: "#1e88e5" }}
                            onClick={handleAddNew}
                        >
                            <Plus size={30} strokeWidth={2} />
                        </IconButton>
                    </Box>
                </Box>

                <Divider />

                {/* Table */}
                <Box sx={{ minHeight: 200, width: "100%" }}>
                <TableContainer>
                    <Table sx={{ tableLayout: "fixed", width: "100%" }}>
                        <TableHead>
                            <TableRow>
                                <TableCell
                                    align="center"
                                    sx={{
                                        fontWeight: 500,
                                        color: "rgba(0, 0, 0, 0.6)",
                                        fontSize: "0.875rem",
                                        width: "30%",
                                    }}
                                >
                                    {t(locale, "employees.table.name")}
                                </TableCell>
                                <TableCell
                                    align="center"
                                    sx={{
                                        fontWeight: 500,
                                        color: "rgba(0, 0, 0, 0.6)",
                                        fontSize: "0.875rem",
                                        width: "30%",
                                    }}
                                >
                                    {t(locale, "employees.table.open-status")}
                                </TableCell>
                                <TableCell
                                    align="center"
                                    sx={{
                                        fontWeight: 500,
                                        color: "rgba(0, 0, 0, 0.6)",
                                        fontSize: "0.875rem",
                                        width: "40%",
                                    }}
                                >
                                    {t(locale, "employees.table.assigned-client")}
                                </TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {filteredEmployees.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={3} align="center" sx={{ py: 4 }}>
                                        {t(locale, "employees.no-employees")}
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredEmployees.map((employee) => (
                                    <TableRow
                                        key={employee.id}
                                        hover
                                        onClick={() => handleRowClick(employee)}
                                        sx={{ cursor: "pointer", "&:hover": { bgcolor: "rgba(0, 0, 0, 0.04)" } }}
                                    >
                                        <TableCell
                                            align="center"
                                            sx={{ fontSize: "0.875rem", color: "rgba(0, 0, 0, 0.87)" }}
                                        >
                                            {employee.name}
                                        </TableCell>
                                        <TableCell align="center">
                                            {getStatusChip(employee.openToNextWork, locale)}
                                        </TableCell>
                                        <TableCell
                                            align="center"
                                            sx={{ fontSize: "0.875rem", color: "rgba(0, 0, 0, 0.6)" }}
                                        >
                                            {t(locale, "employees.schedule-not-implemented")}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>

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
            </Box>
        </ComponentContainer>
    );
}
