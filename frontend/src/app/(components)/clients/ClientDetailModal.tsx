"use client";

import { Pencil, Trash2, X } from "lucide-react";
import { Client, SERVICE_STATUS_OPTIONS, DocumentStatus } from "@/app/lib/client/types";
import { useLocale } from "../LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import { Locale } from "@/app/actions/locale";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/app/(components)/ui/status-badge";
import { InfoRow } from "@/app/(components)/ui/info-row";

interface ClientDetailModalProps {
    open: boolean;
    onClose: () => void;
    client: Client | null;
    onEdit: (client: Client) => void;
    onDelete: (id: number) => void;
}

// Map service status to StatusBadge variant
type ServiceStatusVariant = "waiting" | "in_progress" | "completed" | "cancelled" | "replacement_requested" | "default";

const getStatusBadge = (status: string | null) => {
    const option = SERVICE_STATUS_OPTIONS.find(o => o.value === status);
    if (!option) return <StatusBadge variant="default">-</StatusBadge>;

    const variantMap: Record<string, ServiceStatusVariant> = {
        pending: "waiting",
        waiting: "waiting",
        active: "in_progress",
        in_progress: "in_progress",
        completed: "completed",
        terminated: "cancelled",
        cancelled: "cancelled",
        replacement_requested: "replacement_requested",
    };

    return (
        <StatusBadge variant={variantMap[status || ""] || "default"}>
            {option.label}
        </StatusBadge>
    );
};

const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("ko-KR");
};

const formatPrice = (price: string | null): string => {
    if (!price) return "-";
    const cleaned = price.replace(/,/g, "");
    const num = parseInt(cleaned, 10);
    if (isNaN(num)) return "-";
    return `${num.toLocaleString("ko-KR")}원`;
};

// Map document status to StatusBadge variant
type DocStatusVariant = "doc_created" | "doc_requested" | "doc_opened" | "doc_completed" | "doc_rejected" | "doc_revoked" | "doc_deleted" | "default";
type NonNullDocumentStatus = Exclude<DocumentStatus, null>;

const getDocStatusBadge = (status: DocumentStatus, locale: Locale) => {
    // Handle null status
    if (status === null) {
        return <StatusBadge variant="default">{t(locale, "clients.form.doc-not-sent")}</StatusBadge>;
    }

    const variantMap: Record<NonNullDocumentStatus, DocStatusVariant> = {
        completed: "doc_completed",
        opened: "doc_opened",
        created: "doc_created",
        requested: "doc_requested",
        rejected: "doc_rejected",
        revoked: "doc_revoked",
        deleted: "doc_deleted",
    };

    const labelMap: Record<NonNullDocumentStatus, string> = {
        completed: t(locale, "clients.form.doc-completed"),
        opened: t(locale, "clients.form.doc-opened"),
        created: t(locale, "clients.form.doc-created"),
        requested: t(locale, "clients.form.doc-requested"),
        rejected: t(locale, "clients.form.doc-rejected"),
        revoked: t(locale, "clients.form.doc-revoked"),
        deleted: t(locale, "clients.form.doc-deleted"),
    };

    const variant = variantMap[status] || "default";
    const label = labelMap[status] || t(locale, "clients.form.doc-not-sent");

    return <StatusBadge variant={variant}>{label}</StatusBadge>;
};

export function ClientDetailModal({
    open,
    onClose,
    client,
    onEdit,
    onDelete
}: ClientDetailModalProps) {
    const locale = useLocale();

    if (!client) return null;

    const handleEdit = () => {
        onEdit(client);
        onClose();
    };

    const handleDelete = () => {
        onDelete(client.id);
        onClose();
    };

    return (
        <Dialog data-component="ClientDetailModal" open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader className="flex flex-row items-center justify-between pr-8">
                    <DialogTitle className="text-xl font-semibold">
                        {client.name}
                    </DialogTitle>
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

                <div className="space-y-4 py-2">
                    {/* Basic Info */}
                    <div>
                        <h4 className="text-sm font-medium text-primary mb-2">
                            {t(locale, "clients.form.section-basic")}
                        </h4>
                        <InfoRow label={t(locale, "clients.form.name")} value={client.name} />
                        <InfoRow label={t(locale, "clients.form.birthday")} value={client.birthday} />
                        <InfoRow label={t(locale, "clients.form.due-date")} value={formatDate(client.dueDate)} />
                        <InfoRow label={t(locale, "clients.form.phone")} value={client.phone} />
                        <InfoRow label={t(locale, "clients.form.address")} value={client.address} />
                    </div>

                    <Separator />

                    {/* Employee Info */}
                    <div>
                        <h4 className="text-sm font-medium text-primary mb-2">
                            {t(locale, "clients.form.section-employee")}
                        </h4>
                        <InfoRow label={t(locale, "clients.form.primary-employee")} value={client.primaryEmployee?.name ?? "-"} />
                        <InfoRow label={t(locale, "clients.form.secondary-employee")} value={client.secondaryEmployee?.name ?? "-"} />
                    </div>

                    <Separator />

                    {/* Service Info */}
                    <div>
                        <h4 className="text-sm font-medium text-primary mb-2">
                            {t(locale, "clients.form.section-service")}
                        </h4>
                        <InfoRow label={t(locale, "clients.form.voucher-type")} value={client.type} />
                        <InfoRow
                            label={t(locale, "clients.form.duration")}
                            value={client.duration ? `${client.duration}일` : "-"}
                        />
                    </div>

                    <Separator />

                    {/* Pricing Info */}
                    <div>
                        <h4 className="text-sm font-medium text-primary mb-2">
                            {t(locale, "clients.form.section-pricing")}
                        </h4>
                        <InfoRow label={t(locale, "clients.form.full-price")} value={formatPrice(client.fullPrice)} />
                        <InfoRow label={t(locale, "clients.form.grant")} value={formatPrice(client.grant)} />
                        <InfoRow label={t(locale, "clients.form.actual-price")} value={formatPrice(client.actualPrice)} />
                    </div>

                    <Separator />

                    {/* Contract Info */}
                    <div>
                        <h4 className="text-sm font-medium text-primary mb-2">
                            {t(locale, "clients.form.section-contract")}
                        </h4>
                        <InfoRow
                            label={t(locale, "clients.form.contract-status")}
                            value={getStatusBadge(client.serviceStatus)}
                        />
                        <InfoRow label={t(locale, "clients.form.start-date")} value={formatDate(client.startDate)} />
                        <InfoRow label={t(locale, "clients.form.end-date")} value={formatDate(client.endDate)} />
                    </div>

                    <Separator />

                    {/* Flags */}
                    <div>
                        <h4 className="text-sm font-medium text-primary mb-2">
                            {t(locale, "clients.form.section-flags")}
                        </h4>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {client.voucherClient && (
                                <StatusBadge variant="outline">
                                    {t(locale, "clients.form.voucher-client")}
                                </StatusBadge>
                            )}
                            {client.careCenter && (
                                <StatusBadge variant="outline">
                                    {t(locale, "clients.form.care-center")}
                                </StatusBadge>
                            )}
                            {client.breastPump && (
                                <StatusBadge variant="outline">
                                    {t(locale, "clients.form.breast-pump")}
                                </StatusBadge>
                            )}
                            {!client.voucherClient && !client.careCenter && !client.breastPump && (
                                <span className="text-sm text-muted-foreground">-</span>
                            )}
                        </div>
                    </div>

                    <Separator />

                    {/* Document Signing Status */}
                    <div>
                        <h4 className="text-sm font-medium text-primary mb-2">
                            {t(locale, "clients.form.section-document")}
                        </h4>
                        <InfoRow
                            label={t(locale, "clients.form.document-status")}
                            value={getDocStatusBadge(client.documentStatus, locale)}
                        />
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                        variant="destructive"
                        onClick={handleDelete}
                        className="gap-2"
                    >
                        <Trash2 className="h-4 w-4" />
                        {t(locale, "common.delete")}
                    </Button>
                    <Button
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
