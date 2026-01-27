"use client";

import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    CircularProgress,
    Alert,
} from "@mui/material";
import { AlertTriangle } from "lucide-react";
import { useLocale } from "@/core/providers";
import { t } from "@/app/lib/i18n/translations";

interface TerminateConfirmDialogProps {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
    clientName: string;
    isLoading: boolean;
}

export function TerminateConfirmDialog({
    open,
    onClose,
    onConfirm,
    clientName,
    isLoading,
}: TerminateConfirmDialogProps) {
    const locale = useLocale();

    return (
        <Dialog data-component="TerminateConfirmDialog" open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <AlertTriangle size={24} color="#d32f2f" />
                {t(locale, "clients.terminate.title")}
            </DialogTitle>
            <DialogContent>
                <Alert severity="warning" sx={{ mb: 2 }}>
                    {t(locale, "clients.terminate.warning")}
                </Alert>
                <Typography>
                    <strong>{clientName}</strong> {t(locale, "clients.terminate.confirm-message")}
                </Typography>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2 }}>
                <Button onClick={onClose} disabled={isLoading}>
                    {t(locale, "common.cancel")}
                </Button>
                <Button
                    variant="contained"
                    color="error"
                    onClick={onConfirm}
                    disabled={isLoading}
                >
                    {isLoading ? (
                        <CircularProgress size={24} color="inherit" />
                    ) : (
                        t(locale, "clients.terminate.confirm-button")
                    )}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
