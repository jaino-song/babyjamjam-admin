"use client";

import { Pencil, Trash2, X } from "lucide-react";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { Employee } from "@/hooks/useEmployees";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { InfoRow } from "@/components/app/ui/info-row";

interface EmployeeDetailModalProps {
    open: boolean;
    onClose: () => void;
    employee: Employee | null;
    onEdit: (employee: Employee) => void;
    onDelete: (id: number) => Promise<boolean>; // Returns true if deletion succeeded
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

export function EmployeeDetailModal({
    open,
    onClose,
    employee,
    onEdit,
    onDelete,
}: EmployeeDetailModalProps) {
    const locale = useLocale();

    if (!employee) return null;

    const handleEdit = () => {
        onEdit(employee);
        onClose();
    };

    const handleDelete = async () => {
        const success = await onDelete(employee.id);
        if (success) {
            onClose(); // Only close modal if deletion succeeded
        }
    };

    const getStatusBadge = (openToNextWork: boolean) => {
        if (openToNextWork) {
            return (
                <Badge variant="success">
                    {t(locale, "employees.status.available")}
                </Badge>
            );
        }
        return (
            <Badge variant="secondary">
                {t(locale, "employees.status.unavailable")}
            </Badge>
        );
    };

    return (
        <Dialog
            data-component="employees-detail-modal"
            open={open}
            onOpenChange={(isOpen) => !isOpen && onClose()}
        >
            <DialogContent data-component="employees-detail-modal-content" className="max-w-lg rounded-lg shadow-xl">
                <DialogHeader className="flex flex-row items-center justify-between pr-8">
                    <DialogTitle className="text-xl font-semibold">
                        {employee.name}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        {t(locale, "employees.detail.description")}
                    </DialogDescription>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-4 top-4 h-8 w-8"
                        onClick={onClose}
                    >
                        <X className="h-4 w-4" />
                        <span className="sr-only">Close</span>
                    </Button>
                </DialogHeader>

                <div data-component="employees-detail-modal-body" className="space-y-4 py-2">
                    {/* Basic Info */}
                    <div data-component="employees-detail-modal-basic">
                        <h4 className="text-sm font-medium text-primary mb-2">
                            {t(locale, "employees.form.section-basic")}
                        </h4>
                        <InfoRow label={t(locale, "employees.form.name")} value={employee.name} />
                        <InfoRow label={t(locale, "employees.form.phone")} value={formatPhoneNumber(employee.phone)} />
                    </div>

                    <Separator />

                    {/* Work Info */}
                    <div data-component="employees-detail-modal-work">
                        <h4 className="text-sm font-medium text-primary mb-2">
                            {t(locale, "employees.form.section-work")}
                        </h4>
                        <InfoRow
                            label={t(locale, "employees.form.work-area")}
                            value={
                                <div className="flex flex-wrap gap-1">
                                    {employee.workArea.map((area) => (
                                        <Badge key={area} variant="outline" className="text-xs">
                                            {area}
                                        </Badge>
                                    ))}
                                </div>
                            }
                        />
                        <InfoRow label={t(locale, "employees.form.grade")} value={employee.grade} />
                        <InfoRow
                            label={t(locale, "employees.form.open-to-next-work")}
                            value={getStatusBadge(employee.openToNextWork)}
                        />
                    </div>

                    <Separator />

                    {/* Registration Info */}
                    <div data-component="employees-detail-modal-reg">
                        <h4 className="text-sm font-medium text-primary mb-2">
                            {t(locale, "employees.form.section-registration")}
                        </h4>
                        <InfoRow label={t(locale, "employees.form.registered-date")} value={formatDate(employee.registeredDate)} />
                    </div>
                </div>

                <DialogFooter data-component="employees-detail-modal-actions" className="gap-2 sm:gap-0">
                    <Button
                        data-component="employees-detail-modal-delete"
                        variant="destructive"
                        onClick={handleDelete}
                        className="gap-2"
                    >
                        <Trash2 className="h-4 w-4" />
                        {t(locale, "common.delete")}
                    </Button>
                    <Button
                        data-component="employees-detail-modal-edit"
                        onClick={handleEdit}
                        className="gap-2"
                    >
                        <Pencil className="h-4 w-4" />
                        {t(locale, "common.edit")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
