"use client";

import { useState, useEffect, useMemo } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Grid,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    FormControlLabel,
    Switch,
    CircularProgress,
    Alert,
    Typography,
    Divider,
    Box,
    Chip,
} from "@mui/material";
import { useCreateClient, useUpdateClient } from "../hooks/use-clients";
import { useVoucherPriceInfos } from "@/app/hooks/useVoucherData";
import { EmployeeAutocomplete } from "./EmployeeAutocomplete";
import { EmployeeFormDialog } from "@/features/employees";
import type { Employee } from "@/features/employees";
import {
    Client,
    CreateClientDto,
    UpdateClientDto,
    SERVICE_STATUS_OPTIONS
} from "../types";
import { useLocale } from "@/core/providers";
import { t } from "@/app/lib/i18n/translations";
import voucherOptions from "@/app/(components)/messages/templates/json/voucher.json";

interface ClientFormDialogProps {
    open: boolean;
    onClose: () => void;
    client: Client | null; // null for create mode, Client for edit mode
}

// Format number with commas (handles comma-formatted strings too)
const formatPrice = (price: number | string): string => {
    if (!price && price !== 0) return "";
    // Remove existing commas before parsing
    const cleaned = typeof price === "string" ? price.replace(/,/g, "") : String(price);
    const num = parseInt(cleaned, 10);
    if (isNaN(num)) return "";
    return num.toLocaleString("ko-KR");
};

// Parse price string to raw number string (removes commas)
const parsePrice = (value: string | null | undefined): string => {
    if (!value) return "";
    return value.replace(/,/g, "");
};

// Format phone number as XXX-XXXX-XXXX
const formatPhoneNumber = (value: string): string => {
    // Remove all non-digit characters
    const digits = value.replace(/\D/g, "");

    // Apply formatting based on length
    if (digits.length <= 3) {
        return digits;
    } else if (digits.length <= 7) {
        return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    } else {
        return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
    }
};

// Format ISO date string to yyyy-MM-dd for HTML date input
const formatDateForInput = (dateString: string | null | undefined): string => {
    if (!dateString) return "";
    // Handle ISO format (e.g., "2025-12-26T00:00:00.000Z")
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "";
    return date.toISOString().split("T")[0];
};

export function ClientFormDialog({ open, onClose, client }: ClientFormDialogProps) {
    const locale = useLocale();
    const isEditMode = !!client;

    const createClient = useCreateClient();
    const updateClient = useUpdateClient();

    // Form state - use extended type to allow null for primaryEmployeeId during form editing
    const [formData, setFormData] = useState<Omit<CreateClientDto, 'primaryEmployeeId'> & { primaryEmployeeId: number | null }>({
        name: "",
        birthday: "",
        dueDate: "",
        address: "",
        phone: "",
        primaryEmployeeId: null, // null means "not selected yet"
        secondaryEmployeeId: null,
        type: "",
        duration: null,
        fullPrice: "",
        grant: "",
        actualPrice: "",
        startDate: "",
        endDate: "",
        careCenter: false,
        voucherClient: true,
        breastPump: false,
        serviceStatus: "waiting",
    });

    const [error, setError] = useState<string | null>(null);

    // Track if prices were manually edited
    const [pricesManuallyEdited, setPricesManuallyEdited] = useState(false);

    // State for employee creation dialog
    const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false);
    // Track which employee field (primary/secondary) triggered the dialog
    const [employeeDialogTarget, setEmployeeDialogTarget] = useState<"primary" | "secondary" | null>(null);

    // Fetch voucher price info based on selected type
    const { data: voucherPriceInfos, isLoading: isPriceLoading } = useVoucherPriceInfos(formData.type || "");

    // Get available durations for the selected voucher type
    const availableDurations = useMemo(() => {
        if (!voucherPriceInfos) return [];
        // Get unique durations sorted
        const durations = [...new Set(voucherPriceInfos.map(info => Number(info.duration)))];
        return durations.sort((a, b) => a - b);
    }, [voucherPriceInfos]);

    // Get price info for selected type and duration
    const selectedPriceInfo = useMemo(() => {
        if (!voucherPriceInfos || !formData.duration) return null;
        return voucherPriceInfos.find(
            info => Number(info.duration) === formData.duration
        );
    }, [voucherPriceInfos, formData.duration]);

    // Auto-fill prices when type and duration are selected (only if not manually edited)
    useEffect(() => {
        if (selectedPriceInfo && !pricesManuallyEdited) {
            setFormData(prev => ({
                ...prev,
                fullPrice: parsePrice(selectedPriceInfo.fullPrice),
                grant: parsePrice(selectedPriceInfo.grant),
                actualPrice: parsePrice(selectedPriceInfo.actualPrice),
            }));
        }
    }, [selectedPriceInfo, pricesManuallyEdited]);

    // Reset duration when type changes
    const handleTypeChange = (newType: string) => {
        setFormData(prev => ({
            ...prev,
            type: newType,
            duration: null, // Reset duration when type changes
            // Only reset prices if not manually edited
            ...(pricesManuallyEdited ? {} : {
                fullPrice: "",
                grant: "",
                actualPrice: "",
            }),
        }));
    };

    // Reset form when dialog opens/closes or client changes
    useEffect(() => {
        if (open) {
            setPricesManuallyEdited(false); // Reset manual edit flag
            if (client) {
                // Employee info now comes directly from client (via backend schedule lookup)
                setFormData({
                    name: client.name,
                    birthday: client.birthday || "",
                    dueDate: formatDateForInput(client.dueDate),
                    address: client.address || "",
                    phone: client.phone || "",
                    primaryEmployeeId: client.primaryEmployee?.id ?? null,
                    secondaryEmployeeId: client.secondaryEmployee?.id ?? null,
                    type: client.type || "",
                    duration: client.duration,
                    fullPrice: client.fullPrice || "",
                    grant: client.grant || "",
                    actualPrice: client.actualPrice || "",
                    startDate: formatDateForInput(client.startDate),
                    endDate: formatDateForInput(client.endDate),
                    careCenter: client.careCenter,
                    voucherClient: client.voucherClient,
                    breastPump: client.breastPump,
                    serviceStatus: client.serviceStatus || "waiting",
                });
                // In edit mode, consider prices as manually set
                if (client.fullPrice || client.grant || client.actualPrice) {
                    setPricesManuallyEdited(true);
                }
            } else {
                setFormData({
                    name: "",
                    birthday: "",
                    dueDate: "",
                    address: "",
                    phone: "",
                    primaryEmployeeId: null, // null means "not selected yet"
                    secondaryEmployeeId: null,
                    type: "",
                    duration: null,
                    fullPrice: "",
                    grant: "",
                    actualPrice: "",
                    startDate: "",
                    endDate: "",
                    careCenter: false,
                    voucherClient: true,
                    breastPump: false,
                    serviceStatus: "waiting",
                });
            }
            setError(null);
        }
    }, [open, client]);

    const handleChange = (field: keyof CreateClientDto, value: unknown) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    // Handle manual price changes
    const handlePriceChange = (field: "fullPrice" | "grant" | "actualPrice", value: string) => {
        setPricesManuallyEdited(true);
        handleChange(field, value);
    };

    const handleSubmit = async () => {
        setError(null);

        // Validation - All fields required except secondary employee
        if (!formData.name.trim()) {
            setError(t(locale, "clients.form.error-name-required"));
            return;
        }
        if (!formData.birthday?.trim()) {
            setError(t(locale, "clients.form.error-birthday-required"));
            return;
        }
        if (!formData.dueDate?.trim()) {
            setError(t(locale, "clients.form.error-due-date-required"));
            return;
        }
        if (!formData.address?.trim()) {
            setError(t(locale, "clients.form.error-address-required"));
            return;
        }
        if (!formData.phone?.trim()) {
            setError(t(locale, "clients.form.error-phone-required"));
            return;
        }
        // Check for null/undefined specifically, as 0 can be a valid ID
        // In edit mode, skip this validation if employee hasn't been selected
        // (the backend will preserve the existing schedule)
        if (!formData.type?.trim()) {
            setError(t(locale, "clients.form.error-type-required"));
            return;
        }
        if (!formData.duration) {
            setError(t(locale, "clients.form.error-duration-required"));
            return;
        }
        if (!formData.fullPrice?.trim()) {
            setError(t(locale, "clients.form.error-price-required"));
            return;
        }
        if (!formData.startDate?.trim()) {
            setError(t(locale, "clients.form.error-start-date-required"));
            return;
        }
        if (!formData.endDate?.trim()) {
            setError(t(locale, "clients.form.error-end-date-required"));
            return;
        }

        try {
            if (isEditMode && client) {
                // Build update DTO, excluding null employee IDs to avoid validation errors
                // (backend @IsOptional only skips undefined, not null)
                const updateDto: UpdateClientDto = {
                    name: formData.name,
                    birthday: formData.birthday,
                    dueDate: formData.dueDate || null,
                    address: formData.address,
                    phone: formData.phone,
                    // Only include employee IDs if explicitly selected (not null)
                    ...(formData.primaryEmployeeId !== null && { primaryEmployeeId: formData.primaryEmployeeId }),
                    ...(formData.secondaryEmployeeId !== null && { secondaryEmployeeId: formData.secondaryEmployeeId }),
                    type: formData.type,
                    duration: formData.duration || null,
                    fullPrice: formData.fullPrice,
                    grant: formData.grant,
                    actualPrice: formData.actualPrice,
                    startDate: formData.startDate || null,
                    endDate: formData.endDate || null,
                    careCenter: formData.careCenter,
                    voucherClient: formData.voucherClient,
                    breastPump: formData.breastPump,
                    serviceStatus: formData.serviceStatus,
                };
                await updateClient.mutateAsync({ id: client.id, dto: updateDto });
            } else {
                const createDto: CreateClientDto = {
                    ...formData,
                    duration: formData.duration || null,
                    startDate: formData.startDate || null,
                    endDate: formData.endDate || null,
                };
                await createClient.mutateAsync(createDto);
            }
            onClose();
        } catch (err) {
            setError(t(locale, "clients.form.error-save-failed"));
            console.error("Failed to save client:", err);
        }
    };

    const isSubmitting = createClient.isPending || updateClient.isPending;

    return (
        <>
            <Dialog data-component="ClientFormDialog" open={open} onClose={onClose} maxWidth="md" fullWidth>
                <DialogTitle>
                    {isEditMode
                        ? t(locale, "clients.form.edit-title")
                        : t(locale, "clients.form.add-title")
                    }
                </DialogTitle>
                <DialogContent dividers>
                    {error && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {error}
                        </Alert>
                    )}

                    <Grid container spacing={2}>
                        {/* Basic Info Section */}
                        <Grid size={12}>
                            <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                                {t(locale, "clients.form.section-basic")}
                            </Typography>
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                                fullWidth
                                required
                                label={t(locale, "clients.form.name")}
                                value={formData.name}
                                onChange={(e) => handleChange("name", e.target.value)}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                                fullWidth
                                label={t(locale, "clients.form.birthday")}
                                placeholder="YYMMDD"
                                value={formData.birthday}
                                onChange={(e) => handleChange("birthday", e.target.value)}
                                inputProps={{ maxLength: 6 }}
                                helperText={t(locale, "clients.form.birthday-helper")}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                                fullWidth
                                type="date"
                                label={t(locale, "clients.form.due-date")}
                                value={formData.dueDate || ""}
                                onChange={(e) => handleChange("dueDate", e.target.value)}
                                InputLabelProps={{ shrink: true }}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                                fullWidth
                                label={t(locale, "clients.form.phone")}
                                value={formData.phone}
                                onChange={(e) => handleChange("phone", formatPhoneNumber(e.target.value))}
                                placeholder="010-1234-5678"
                                inputProps={{ maxLength: 13 }}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                                fullWidth
                                label={t(locale, "clients.form.address")}
                                value={formData.address}
                                onChange={(e) => handleChange("address", e.target.value)}
                            />
                        </Grid>

                        <Grid size={12}><Divider sx={{ my: 1 }} /></Grid>

                        {/* Employee Section */}
                        <Grid size={12}>
                            <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                                {t(locale, "clients.form.section-employee")}
                            </Typography>
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                            <EmployeeAutocomplete
                                value={formData.primaryEmployeeId ?? null}
                                onChange={(id) => handleChange("primaryEmployeeId", id ?? 0)}
                                label={t(locale, "clients.form.primary-employee")}
                                excludeIds={formData.secondaryEmployeeId != null ? [formData.secondaryEmployeeId] : []}
                                onAddNew={() => {
                                    setEmployeeDialogTarget("primary");
                                    setIsEmployeeDialogOpen(true);
                                }}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <EmployeeAutocomplete
                                value={formData.secondaryEmployeeId ?? null}
                                onChange={(id) => handleChange("secondaryEmployeeId", id)}
                                label={t(locale, "clients.form.secondary-employee")}
                                excludeIds={formData.primaryEmployeeId != null ? [formData.primaryEmployeeId] : []}
                                onAddNew={() => {
                                    setEmployeeDialogTarget("secondary");
                                    setIsEmployeeDialogOpen(true);
                                }}
                            />
                        </Grid>

                        <Grid size={12}><Divider sx={{ my: 1 }} /></Grid>

                        {/* Service Info Section */}
                        <Grid size={12}>
                            <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                                {t(locale, "clients.form.section-service")}
                            </Typography>
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                            <FormControl fullWidth>
                                <InputLabel>{t(locale, "clients.form.voucher-type")}</InputLabel>
                                <Select
                                    value={formData.type || ""}
                                    label={t(locale, "clients.form.voucher-type")}
                                    onChange={(e) => handleTypeChange(e.target.value)}
                                >
                                    {Object.entries(voucherOptions.voucherOptions).map(([groupName, types]) => [
                                        <MenuItem key={groupName} disabled sx={{ fontWeight: 600 }}>
                                            {groupName}
                                        </MenuItem>,
                                        ...Object.entries(types).map(([typeValue, typeData]) => (
                                            <MenuItem key={typeValue} value={typeValue} sx={{ pl: 4 }}>
                                                {typeData.label}
                                            </MenuItem>
                                        ))
                                    ])}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <FormControl fullWidth disabled={!formData.type || isPriceLoading}>
                                <InputLabel>{t(locale, "clients.form.duration")}</InputLabel>
                                <Select
                                    value={formData.duration || ""}
                                    label={t(locale, "clients.form.duration")}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        handleChange("duration", value ? Number(value) : null);
                                        // Reset manual edit flag when duration changes to allow auto-fill
                                        setPricesManuallyEdited(false);
                                    }}
                                >
                                    {availableDurations.map((duration) => (
                                        <MenuItem key={duration} value={duration}>
                                            {duration}일
                                        </MenuItem>
                                    ))}
                                </Select>
                                {isPriceLoading && (
                                    <CircularProgress
                                        size={20}
                                        sx={{
                                            position: "absolute",
                                            right: 40,
                                            top: "50%",
                                            marginTop: "-10px"
                                        }}
                                    />
                                )}
                            </FormControl>
                        </Grid>

                        <Grid size={12}><Divider sx={{ my: 1 }} /></Grid>

                        {/* Pricing Section */}
                        <Grid size={12}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                                <Typography variant="subtitle2" color="primary">
                                    {t(locale, "clients.form.section-pricing")}
                                </Typography>
                                {selectedPriceInfo && !pricesManuallyEdited && (
                                    <Chip
                                        label={t(locale, "clients.form.auto-filled")}
                                        size="small"
                                        color="info"
                                        variant="outlined"
                                    />
                                )}
                            </Box>
                        </Grid>

                        <Grid size={{ xs: 12, sm: 4 }}>
                            <TextField
                                fullWidth
                                label={t(locale, "clients.form.full-price")}
                                value={formatPrice(formData.fullPrice || "")}
                                onChange={(e) => handlePriceChange("fullPrice", e.target.value.replace(/,/g, ""))}
                                placeholder="0"
                                InputProps={{
                                    endAdornment: <Typography variant="caption" color="text.secondary">원</Typography>,
                                }}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 4 }}>
                            <TextField
                                fullWidth
                                label={t(locale, "clients.form.grant")}
                                value={formatPrice(formData.grant || "")}
                                onChange={(e) => handlePriceChange("grant", e.target.value.replace(/,/g, ""))}
                                placeholder="0"
                                InputProps={{
                                    endAdornment: <Typography variant="caption" color="text.secondary">원</Typography>,
                                }}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 4 }}>
                            <TextField
                                fullWidth
                                label={t(locale, "clients.form.actual-price")}
                                value={formatPrice(formData.actualPrice || "")}
                                onChange={(e) => handlePriceChange("actualPrice", e.target.value.replace(/,/g, ""))}
                                placeholder="0"
                                InputProps={{
                                    endAdornment: <Typography variant="caption" color="text.secondary">원</Typography>,
                                }}
                            />
                        </Grid>

                        <Grid size={12}><Divider sx={{ my: 1 }} /></Grid>

                        {/* Contract Section */}
                        <Grid size={12}>
                            <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                                {t(locale, "clients.form.section-contract")}
                            </Typography>
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6 }}>
                            <FormControl fullWidth>
                                <InputLabel>{t(locale, "clients.form.service-status")}</InputLabel>
                                <Select
                                    value={formData.serviceStatus || ""}
                                    label={t(locale, "clients.form.service-status")}
                                    onChange={(e) => handleChange("serviceStatus", e.target.value)}
                                >
                                    {SERVICE_STATUS_OPTIONS.map((status) => (
                                        <MenuItem key={status.value} value={status.value}>
                                            {status.label}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid size={{ xs: 12, sm: 3 }}>
                            <TextField
                                fullWidth
                                type="date"
                                label={t(locale, "clients.form.start-date")}
                                value={formData.startDate || ""}
                                onChange={(e) => handleChange("startDate", e.target.value)}
                                InputLabelProps={{ shrink: true }}
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 3 }}>
                            <TextField
                                fullWidth
                                type="date"
                                label={t(locale, "clients.form.end-date")}
                                value={formData.endDate || ""}
                                onChange={(e) => handleChange("endDate", e.target.value)}
                                InputLabelProps={{ shrink: true }}
                            />
                        </Grid>

                        <Grid size={12}><Divider sx={{ my: 1 }} /></Grid>

                        {/* Flags Section */}
                        <Grid size={12}>
                            <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>
                                {t(locale, "clients.form.section-flags")}
                            </Typography>
                        </Grid>

                        <Grid size={12}>
                            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={formData.voucherClient}
                                            onChange={(e) => handleChange("voucherClient", e.target.checked)}
                                        />
                                    }
                                    label={t(locale, "clients.form.voucher-client")}
                                />
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={formData.careCenter}
                                            onChange={(e) => handleChange("careCenter", e.target.checked)}
                                        />
                                    }
                                    label={t(locale, "clients.form.care-center")}
                                />
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={formData.breastPump}
                                            onChange={(e) => handleChange("breastPump", e.target.checked)}
                                        />
                                    }
                                    label={t(locale, "clients.form.breast-pump")}
                                />
                            </Box>
                        </Grid>
                    </Grid>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} disabled={isSubmitting}>
                        {t(locale, "common.cancel")}
                    </Button>
                    <Button
                        variant="contained"
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? (
                            <CircularProgress size={24} />
                        ) : isEditMode ? (
                            t(locale, "common.save")
                        ) : (
                            t(locale, "common.create")
                        )}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Employee Creation Dialog */}
            <EmployeeFormDialog
                open={isEmployeeDialogOpen}
                onClose={() => {
                    setIsEmployeeDialogOpen(false);
                    setEmployeeDialogTarget(null);
                }}
                onSuccess={(newEmployee: Employee) => {
                    // Auto-select the newly created employee in the appropriate field
                    if (employeeDialogTarget === "primary") {
                        handleChange("primaryEmployeeId", newEmployee.id);
                    } else if (employeeDialogTarget === "secondary") {
                        handleChange("secondaryEmployeeId", newEmployee.id);
                    }
                }}
            />
        </>
    );
}
