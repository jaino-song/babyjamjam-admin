"use client";

import { useState } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    CircularProgress,
    Alert,
    Box,
    Divider,
} from "@mui/material";
import { UserRoundCog } from "lucide-react";
import { EmployeeAutocomplete } from "./EmployeeAutocomplete";
import { useLocale } from "@/core/providers";
import { t } from "@/app/lib/i18n/translations";

interface ReplacementModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: (newPrimaryEmployeeId: number, newSecondaryEmployeeId: number | null) => void;
    currentPrimaryEmployeeId: number | null;
    currentSecondaryEmployeeId: number | null;
    clientName: string;
    isLoading: boolean;
}

export function ReplacementModal({
    open,
    onClose,
    onConfirm,
    currentPrimaryEmployeeId,
    currentSecondaryEmployeeId,
    clientName,
    isLoading,
}: ReplacementModalProps) {
    const locale = useLocale();
    const [newPrimaryEmployeeId, setNewPrimaryEmployeeId] = useState<number | null>(null);
    const [newSecondaryEmployeeId, setNewSecondaryEmployeeId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleClose = () => {
        setNewPrimaryEmployeeId(null);
        setNewSecondaryEmployeeId(null);
        setError(null);
        onClose();
    };

    const handleConfirm = () => {
        if (newPrimaryEmployeeId === null) {
            setError(t(locale, "clients.replacement.error-select-employee"));
            return;
        }

        if (newPrimaryEmployeeId === currentPrimaryEmployeeId) {
            setError(t(locale, "clients.replacement.error-same-employee"));
            return;
        }

        setError(null);
        onConfirm(newPrimaryEmployeeId, newSecondaryEmployeeId);
    };

    // Reset form when dialog opens
    const handleEnter = () => {
        setNewPrimaryEmployeeId(null);
        setNewSecondaryEmployeeId(null);
        setError(null);
    };

    return (
        <Dialog
            data-component="ReplacementModal"
            open={open}
            onClose={handleClose}
            maxWidth="sm"
            fullWidth
            TransitionProps={{ onEnter: handleEnter }}
        >
            <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <UserRoundCog size={24} />
                {t(locale, "clients.replacement.title")}
            </DialogTitle>
            <DialogContent>
                <Alert severity="info" sx={{ mb: 3 }}>
                    <strong>{clientName}</strong> {t(locale, "clients.replacement.info")}
                </Alert>

                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {/* Primary Employee Selection */}
                    <Box>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            {t(locale, "clients.replacement.new-primary")} *
                        </Typography>
                        <EmployeeAutocomplete
                            value={newPrimaryEmployeeId}
                            onChange={setNewPrimaryEmployeeId}
                            label={t(locale, "clients.form.primary-employee")}
                            required
                            excludeIds={newSecondaryEmployeeId ? [newSecondaryEmployeeId] : []}
                        />
                    </Box>

                    <Divider />

                    {/* Secondary Employee Selection (Optional) */}
                    <Box>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            {t(locale, "clients.replacement.new-secondary")}
                        </Typography>
                        <EmployeeAutocomplete
                            value={newSecondaryEmployeeId}
                            onChange={setNewSecondaryEmployeeId}
                            label={t(locale, "clients.form.secondary-employee")}
                            excludeIds={newPrimaryEmployeeId ? [newPrimaryEmployeeId] : []}
                        />
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                            {t(locale, "clients.replacement.secondary-optional")}
                        </Typography>
                    </Box>
                </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2 }}>
                <Button onClick={handleClose} disabled={isLoading}>
                    {t(locale, "common.cancel")}
                </Button>
                <Button
                    variant="contained"
                    color="warning"
                    onClick={handleConfirm}
                    disabled={isLoading || newPrimaryEmployeeId === null}
                >
                    {isLoading ? (
                        <CircularProgress size={24} color="inherit" />
                    ) : (
                        t(locale, "clients.replacement.confirm-button")
                    )}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
