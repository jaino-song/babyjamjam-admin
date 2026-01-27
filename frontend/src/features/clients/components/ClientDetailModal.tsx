"use client";

import { useState } from "react";
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
} from "@mui/material";
import { Pencil, Trash2, X, CircleStop, UserRoundCog } from "lucide-react";
import { Client, SERVICE_STATUS_OPTIONS } from "../types";
import { useTerminateService, useRequestReplacement } from "../hooks/use-clients";
import { TerminateConfirmDialog } from "./TerminateConfirmDialog";
import { ReplacementModal } from "./ReplacementModal";
import { useLocale } from "@/core/providers";
import { t } from "@/app/lib/i18n/translations";

interface ClientDetailModalProps {
    open: boolean;
    onClose: () => void;
    client: Client | null;
    onEdit: (client: Client) => void;
    onDelete: (id: number) => void;
}

const getStatusChip = (status: string | null) => {
    const option = SERVICE_STATUS_OPTIONS.find(o => o.value === status);
    if (!option) return <Chip label="-" size="small" />;

    return (
        <Chip
            label={option.label}
            color={option.color}
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
    const [terminateDialogOpen, setTerminateDialogOpen] = useState(false);
    const [replacementModalOpen, setReplacementModalOpen] = useState(false);

    const terminateService = useTerminateService();
    const requestReplacement = useRequestReplacement();

    if (!client) return null;

    const handleEdit = () => {
        onEdit(client);
        onClose();
    };

    const handleDelete = () => {
        onDelete(client.id);
        onClose();
    };

    const handleTerminate = async () => {
        try {
            await terminateService.mutateAsync({ id: client.id });
            setTerminateDialogOpen(false);
            onClose();
        } catch (err) {
            console.error("Failed to terminate service:", err);
        }
    };

    const handleRequestReplacement = async (
        newPrimaryEmployeeId: number,
        newSecondaryEmployeeId: number | null
    ) => {
        try {
            await requestReplacement.mutateAsync({
                id: client.id,
                dto: {
                    newPrimaryEmployeeId,
                    newSecondaryEmployeeId,
                },
            });
            setReplacementModalOpen(false);
            onClose();
        } catch (err) {
            console.error("Failed to request replacement:", err);
        }
    };

    // Check if terminate/replace buttons should be shown
    // Only show for active or waiting status (not already terminated/completed)
    const canTerminate = client.serviceStatus !== "terminated" && client.serviceStatus !== "completed";
    const canReplace = client.serviceStatus === "active" || client.serviceStatus === "waiting";

    return (
        <Dialog data-component="ClientDetailModal" open={open} onClose={onClose} maxWidth="sm" fullWidth>
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
                        label={t(locale, "clients.form.service-status")}
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
                        value={
                            <Chip
                                label={client.hasSigned
                                    ? t(locale, "clients.form.document-signed")
                                    : t(locale, "clients.form.document-not-signed")}
                                color={client.hasSigned ? "success" : "default"}
                                size="small"
                            />
                        }
                    />
                </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, justifyContent: "space-between" }}>
                <Box sx={{ display: "flex", gap: 1 }}>
                    {canTerminate && (
                        <Button
                            variant="outlined"
                            sx={{ color: "grey.700", borderColor: "grey.400" }}
                            startIcon={<CircleStop size={16} />}
                            onClick={() => setTerminateDialogOpen(true)}
                        >
                            {t(locale, "clients.actions.terminate")}
                        </Button>
                    )}
                    {canReplace && (
                        <Button
                            variant="outlined"
                            color="warning"
                            startIcon={<UserRoundCog size={16} />}
                            onClick={() => setReplacementModalOpen(true)}
                        >
                            {t(locale, "clients.actions.replace")}
                        </Button>
                    )}
                </Box>
                <Box sx={{ display: "flex", gap: 1 }}>
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
                </Box>
            </DialogActions>

            {/* Terminate Confirmation Dialog */}
            <TerminateConfirmDialog
                open={terminateDialogOpen}
                onClose={() => setTerminateDialogOpen(false)}
                onConfirm={handleTerminate}
                clientName={client.name}
                isLoading={terminateService.isPending}
            />

            {/* Replacement Modal */}
            <ReplacementModal
                open={replacementModalOpen}
                onClose={() => setReplacementModalOpen(false)}
                onConfirm={handleRequestReplacement}
                currentPrimaryEmployeeId={client.primaryEmployee?.id ?? null}
                currentSecondaryEmployeeId={client.secondaryEmployee?.id ?? null}
                clientName={client.name}
                isLoading={requestReplacement.isPending}
            />
        </Dialog>
    );
}

