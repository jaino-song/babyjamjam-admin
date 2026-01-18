"use client";

import { useState, useMemo } from "react";
import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    InputAdornment,
    IconButton,
    Chip,
    CircularProgress,
    Alert,
} from "@mui/material";
import { Search, Plus } from "lucide-react";
import { useLocale } from "@/core/providers";
import { t, Locale } from "@/app/lib/i18n/translations";
import { ContentPaper } from "@/app/(components)/root/ContentPaper";
import { useEmployees, useDeleteEmployee } from "../hooks/use-employees";
import type { Employee } from "../types";
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
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

    const { data: employees, isLoading, error } = useEmployees();
    const deleteEmployee = useDeleteEmployee();

    // Filter employees based on search query
    const filteredEmployees = useMemo(() => {
        if (!employees) return [];
        if (!search.trim()) return employees;

        const query = search.toLowerCase();
        return employees.filter((emp) =>
            emp.name.toLowerCase().includes(query) ||
            emp.workArea?.some(area => area.toLowerCase().includes(query)) ||
            emp.phone?.includes(query)
        );
    }, [employees, search]);

    const handleSearch = () => {
        setSearch(searchInput);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleSearch();
        }
    };

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
            <ContentPaper 
                title={t(locale, "employees.title")} 
                subtitle={t(locale, "employees.subtitle")}
                sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
            >
                <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                    <CircularProgress />
                </Box>
            </ContentPaper>
        );
    }

    if (error) {
        return (
            <ContentPaper 
                title={t(locale, "employees.title")} 
                subtitle={t(locale, "employees.subtitle")}
                sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
            >
                <Alert severity="error">{t(locale, "common.error")}</Alert>
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
                {/* Toolbar */}
                <Box
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        mb: 2,
                        gap: 2,
                    }}
                >
                    {/* Search */}
                    <TextField
                        size="small"
                        placeholder={t(locale, "employees.search-placeholder")}
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton size="small" onClick={handleSearch}>
                                        <Search size={20} />
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }}
                        sx={{ minWidth: 250 }}
                    />

                    {/* Add Button */}
                    <IconButton
                        color="primary"
                        onClick={handleAddNew}
                        sx={{
                            bgcolor: "primary.main",
                            color: "white",
                            "&:hover": { bgcolor: "primary.dark" }
                        }}
                    >
                        <Plus size={24} />
                    </IconButton>
                </Box>

                {/* Table */}
                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ fontWeight: 600 }}>{t(locale, "employees.table.name")}</TableCell>
                                <TableCell sx={{ fontWeight: 600 }}>{t(locale, "employees.table.open-status")}</TableCell>
                                <TableCell sx={{ fontWeight: 600 }}>{t(locale, "employees.table.assigned-client")}</TableCell>
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
                                        sx={{ cursor: "pointer" }}
                                    >
                                        <TableCell>{employee.name}</TableCell>
                                        <TableCell>{getStatusChip(employee.openToNextWork, locale)}</TableCell>
                                        <TableCell sx={{ color: "text.secondary" }}>
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
        </ContentPaper>
    );
}
