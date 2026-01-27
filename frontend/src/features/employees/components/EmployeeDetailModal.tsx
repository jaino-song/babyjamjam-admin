"use client";

import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    Chip,
    Divider,
    IconButton,
    Switch,
    FormControlLabel,
} from "@mui/material";
import { Pencil, Trash2, X } from "lucide-react";
import { useLocale } from "@/core/providers";
import { t } from "@/app/lib/i18n/translations";
import type { Employee } from "../types";
import { useToggleEmployeeOpenStatus } from "../hooks/use-employees";

interface EmployeeDetailModalProps {
    open: boolean;
    onClose: () => void;
    employee: Employee | null;
    onEdit: (employee: Employee) => void;
    onDelete: (id: number) => void;
}

const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("ko-KR");
};

const formatPhoneNumber = (phone: string | null | undefined): string => {
    if (!phone) return "-";
    const numbers = phone.replace(/[^\d]/g, "");
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
};

interface InfoRowProps {
    label: string;
    value: React.ReactNode;
}

const InfoRow = ({ label, value }: InfoRowProps) => (
    <Box sx={{ display: "flex", py: 1, alignItems: "center" }}>
        <Typography variant="body2" color="text.secondary" sx={{ width: 120, flexShrink: 0 }}>
            {label}
        </Typography>
        <Box sx={{ flex: 1, fontSize: "0.875rem" }}>
            {value || "-"}
        </Box>
    </Box>
);

export function EmployeeDetailModal({
    open,
    onClose,
    employee,
    onEdit,
    onDelete,
}: EmployeeDetailModalProps) {
    const locale = useLocale();
    const toggleStatus = useToggleEmployeeOpenStatus();

    if (!employee) return null;

    const handleEdit = () => {
        onEdit(employee);
        onClose();
    };

    const handleDelete = () => {
        onDelete(employee.id);
        onClose();
    };

    const handleToggle = () => {
        toggleStatus.mutate({
            id: employee.id,
            openToNextWork: !employee.openToNextWork,
        });
    };

    return (
        <Dialog data-component="EmployeeDetailModal" open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Box component="span" sx={{ fontWeight: 600, fontSize: "1.25rem" }}>
                    {employee.name}
                </Box>
                <IconButton size="small" onClick={onClose}>
                    <X size={20} />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                <Box>
                    {/* Basic Info */}
                    <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                        {t(locale, "employees.form.section-basic")}
                    </Typography>
                    <InfoRow label={t(locale, "employees.form.name")} value={employee.name} />
                    <InfoRow label={t(locale, "employees.form.phone")} value={formatPhoneNumber(employee.phone)} />

                    <Divider sx={{ my: 2 }} />

                    {/* Work Info */}
                    <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                        {t(locale, "employees.form.section-work")}
                    </Typography>
                    <InfoRow
                        label={t(locale, "employees.form.work-area")}
                        value={
                            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                                {employee.workArea.map((area) => (
                                    <Chip key={area} label={area} size="small" variant="outlined" />
                                ))}
                            </Box>
                        }
                    />
                    <InfoRow label={t(locale, "employees.form.grade")} value={employee.grade} />
                    <InfoRow
                        label={t(locale, "employees.form.open-to-next-work")}
                        value={
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={employee.openToNextWork}
                                        onChange={handleToggle}
                                        disabled={toggleStatus.isPending}
                                    />
                                }
                                label={
                                    toggleStatus.isPending
                                        ? "..."
                                        : employee.openToNextWork
                                            ? t(locale, "employees.status.available")
                                            : t(locale, "employees.status.unavailable")
                                }
                            />
                        }
                    />

                    <Divider sx={{ my: 2 }} />

                    {/* Registration Info */}
                    <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                        {t(locale, "employees.form.section-registration")}
                    </Typography>
                    <InfoRow label={t(locale, "employees.form.registered-date")} value={formatDate(employee.registeredDate)} />
                </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2 }}>
                <Button
                    variant="outlined"
                    color="error"
                    startIcon={<Trash2 size={16} />}
                    onClick={handleDelete}
                >
                    {t(locale, "common.delete")}
                </Button>
                <Button
                    variant="contained"
                    startIcon={<Pencil size={16} />}
                    onClick={handleEdit}
                >
                    {t(locale, "common.edit")}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
