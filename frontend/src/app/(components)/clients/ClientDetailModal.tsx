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
    Grid,
    IconButton,
} from "@mui/material";
import { Pencil, Trash2, X } from "lucide-react";
import { Client, CONTRACT_STATUS_OPTIONS, DocumentStatus } from "@/app/lib/client/types";
import { useLocale } from "../LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import { Locale } from "@/app/actions/locale";

interface ClientDetailModalProps {
    open: boolean;
    onClose: () => void;
    client: Client | null;
    onEdit: (client: Client) => void;
    onDelete: (id: number) => void;
}

const getStatusChip = (status: string | null) => {
    const option = CONTRACT_STATUS_OPTIONS.find(o => o.value === status);
    if (!option) return <Chip label="-" size="small" />;
    
    const colorMap: Record<string, "default" | "warning" | "info" | "success" | "error"> = {
        pending: "warning",
        in_progress: "info",
        completed: "success",
        cancelled: "error",
    };
    
    return (
        <Chip 
            label={option.label} 
            color={colorMap[status || ""] || "default"} 
            size="small" 
        />
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

const getDocStatusChip = (status: DocumentStatus, locale: Locale) => {
    switch (status) {
        case 'completed':
            return <Chip label={t(locale, "clients.form.doc-completed")} color="success" size="small" />;
        case 'opened':
            return <Chip label={t(locale, "clients.form.doc-opened")} color="warning" size="small" />;
        case 'created':
            return <Chip label={t(locale, "clients.form.doc-created")} color="default" size="small" />;
        case 'requested':
            return <Chip label={t(locale, "clients.form.doc-requested")} color="info" size="small" />;
        case 'rejected':
            return <Chip label={t(locale, "clients.form.doc-rejected")} color="error" size="small" />;
        case 'revoked':
            return <Chip label={t(locale, "clients.form.doc-revoked")} color="error" size="small" variant="outlined" />;
        case 'deleted':
            return <Chip label={t(locale, "clients.form.doc-deleted")} color="default" size="small" variant="outlined" />;
        default:
            return <Chip label={t(locale, "clients.form.doc-not-sent")} color="default" size="small" variant="outlined" />;
    }
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
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Box component="span" sx={{ fontWeight: 600, fontSize: "1.25rem" }}>
                    {client.name}
                </Box>
                <IconButton size="small" onClick={onClose}>
                    <X size={20} />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                <Box>
                    {/* Basic Info */}
                    <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                        {t(locale, "clients.form.section-basic")}
                    </Typography>
                    <InfoRow label={t(locale, "clients.form.name")} value={client.name} />
                    <InfoRow label={t(locale, "clients.form.birthday")} value={client.birthday} />
                    <InfoRow label={t(locale, "clients.form.phone")} value={client.phone} />
                    <InfoRow label={t(locale, "clients.form.address")} value={client.address} />

                    <Divider sx={{ my: 2 }} />

                    {/* Employee Info */}
                    <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                        {t(locale, "clients.form.section-employee")}
                    </Typography>
                    <InfoRow label={t(locale, "clients.form.primary-employee")} value={client.primaryEmployee?.name ?? "-"} />
                    <InfoRow label={t(locale, "clients.form.secondary-employee")} value={client.secondaryEmployee?.name ?? "-"} />

                    <Divider sx={{ my: 2 }} />

                    {/* Service Info */}
                    <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                        {t(locale, "clients.form.section-service")}
                    </Typography>
                    <InfoRow label={t(locale, "clients.form.voucher-type")} value={client.type} />
                    <InfoRow 
                        label={t(locale, "clients.form.duration")} 
                        value={client.duration ? `${client.duration}일` : "-"} 
                    />

                    <Divider sx={{ my: 2 }} />

                    {/* Pricing Info */}
                    <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                        {t(locale, "clients.form.section-pricing")}
                    </Typography>
                    <InfoRow label={t(locale, "clients.form.full-price")} value={formatPrice(client.fullPrice)} />
                    <InfoRow label={t(locale, "clients.form.grant")} value={formatPrice(client.grant)} />
                    <InfoRow label={t(locale, "clients.form.actual-price")} value={formatPrice(client.actualPrice)} />

                    <Divider sx={{ my: 2 }} />

                    {/* Contract Info */}
                    <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                        {t(locale, "clients.form.section-contract")}
                    </Typography>
                    <InfoRow
                        label={t(locale, "clients.form.contract-status")}
                        value={getStatusChip(client.serviceStatus)}
                    />
                    <InfoRow label={t(locale, "clients.form.start-date")} value={formatDate(client.startDate)} />
                    <InfoRow label={t(locale, "clients.form.end-date")} value={formatDate(client.endDate)} />

                    <Divider sx={{ my: 2 }} />

                    {/* Flags */}
                    <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                        {t(locale, "clients.form.section-flags")}
                    </Typography>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1 }}>
                        {client.voucherClient && (
                            <Chip label={t(locale, "clients.form.voucher-client")} size="small" color="primary" variant="outlined" />
                        )}
                        {client.careCenter && (
                            <Chip label={t(locale, "clients.form.care-center")} size="small" color="primary" variant="outlined" />
                        )}
                        {client.breastPump && (
                            <Chip label={t(locale, "clients.form.breast-pump")} size="small" color="primary" variant="outlined" />
                        )}
                        {!client.voucherClient && !client.careCenter && !client.breastPump && (
                            <Typography variant="body2" color="text.secondary">-</Typography>
                        )}
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    {/* Document Signing Status */}
                    <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                        {t(locale, "clients.form.section-document")}
                    </Typography>
                    <InfoRow
                        label={t(locale, "clients.form.document-status")}
                        value={getDocStatusChip(client.documentStatus, locale)}
                    />
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

