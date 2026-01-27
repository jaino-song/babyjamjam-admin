"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
    Autocomplete,
    TextField,
    Box,
    Typography,
    CircularProgress,
    Paper,
    Chip,
    Divider,
    ButtonBase,
} from "@mui/material";
import { UserPlus, FileCheck } from "lucide-react";
import { useAllClients } from "@/app/hooks/useClients";
import { useLocale } from "../LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import type { Client } from "@/app/lib/client/types";
import { useClientDialogStore } from "@/app/store/client-dialog-store";
import { matchesKoreanSearch } from "@/app/lib/utils/korean-search";

interface ClientAutocompleteProps {
    value: number | null;
    onChange: (clientId: number | null, client: Client | null) => void;
    label: string;
    required?: boolean;
    error?: boolean;
    helperText?: string;
    excludeIds?: number[];
    allowManualEntry?: boolean;
    onManualEntry?: () => void;
}

export function ClientAutocomplete({
    value,
    onChange,
    label,
    required = false,
    error = false,
    helperText,
    excludeIds = [],
    allowManualEntry = false,
    onManualEntry,
}: ClientAutocompleteProps) {
    const locale = useLocale();
    const { data: clients, isLoading } = useAllClients();
    const setPrefillName = useClientDialogStore((state) => state.setPrefillName);

    // Track input value for display synchronization
    const [inputValue, setInputValue] = useState("");
    // Track open state for controlled dropdown behavior
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    // Ref for the input element - used to blur when closing dropdown
    const inputRef = useRef<HTMLInputElement>(null);

    // Filter out excluded clients
    const availableClients = useMemo(() => {
        if (!clients) return [];
        return clients.filter((client) => !excludeIds.includes(client.id));
    }, [clients, excludeIds]);

    // Find selected client
    const selectedClient = useMemo(() => {
        if (value === null || value === undefined || !clients) return null;
        return clients.find((client) => client.id === value) || null;
    }, [value, clients]);

    // Sync inputValue when selectedClient changes (e.g., after creating a new client)
    // This ensures the text field shows the client name when selection changes externally
    useEffect(() => {
        if (selectedClient) {
            setInputValue(selectedClient.name);
        } else if (value === null) {
            // Only clear input if value is explicitly null (not when waiting for clients to load)
            setInputValue("");
        }
    }, [selectedClient, value]);

    const handleChange = (
        _event: React.SyntheticEvent,
        newValue: Client | null
    ) => {
        // Update input value immediately to show selected name
        setInputValue(newValue?.name ?? "");
        onChange(newValue?.id ?? null, newValue);
    };

    const handleManualEntry = (e: React.MouseEvent) => {
        // Prevent the Autocomplete from closing before click completes
        e.preventDefault();
        e.stopPropagation();
        // Close the dropdown state
        setIsDropdownOpen(false);
        // Blur the input using ref to ensure dropdown closes completely
        // Note: We use ref because the Paper slot is rendered in a Portal,
        // so DOM traversal with closest() won't find the Autocomplete
        inputRef.current?.blur();
        // Save the typed name to the store so ClientFormDialog can prefill it
        setPrefillName(inputValue);
        // Use setTimeout to ensure dropdown is fully closed before opening dialog
        // This prevents the dropdown from appearing over the new dialog
        setTimeout(() => {
            if (onManualEntry) {
                onManualEntry();
            }
        }, 100);
    };

    // Handle input change to track what user types
    const handleInputChange = (
        _event: React.SyntheticEvent,
        newInputValue: string,
        reason: string
    ) => {
        // Update inputValue for user input and clear actions
        if (reason === "input" || reason === "clear") {
            setInputValue(newInputValue);
        }
    };

    return (
        <Autocomplete<Client, false, false, false>
            value={selectedClient}
            onChange={handleChange}
            inputValue={inputValue}
            onInputChange={handleInputChange}
            options={availableClients}
            loading={isLoading}
            clearOnBlur={false}
            blurOnSelect={true}
            // Control dropdown visibility - opens on focus or when typing
            open={isDropdownOpen}
            onOpen={() => setIsDropdownOpen(true)}
            onClose={() => setIsDropdownOpen(false)}
            openOnFocus
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, val) => option.id === val.id}
            filterOptions={(options, { inputValue: filterInput }) => {
                // Only show options when user has typed something
                if (!filterInput.trim()) return [];
                return options.filter(
                    (client) =>
                        // 초성 search only for name (e.g., ㄱ → 김현아)
                        matchesKoreanSearch(client.name, filterInput) ||
                        // Phone: simple substring match (no 초성)
                        (client.phone && client.phone.includes(filterInput)) ||
                        // Address: simple substring match (no 초성 to avoid false positives)
                        (client.address && client.address.toLowerCase().includes(filterInput.toLowerCase()))
                );
            }}
            renderOption={(props, option) => (
                <Box component="li" {...props} key={option.id}>
                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            width: "100%",
                        }}
                    >
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                            }}
                        >
                            <Typography variant="body1">{option.name}</Typography>
                            {option.hasSigned && (
                                <Chip
                                    icon={<FileCheck size={14} />}
                                    label={t(locale, "contract-msg.client-signed")}
                                    size="small"
                                    color="success"
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: "0.7rem" }}
                                />
                            )}
                        </Box>
                        <Typography variant="caption" color="text.secondary">
                            {option.phone || "-"}{" "}
                            {option.address && `· ${option.address}`}
                        </Typography>
                    </Box>
                </Box>
            )}
            renderInput={(params) => (
                <TextField
                    {...params}
                    inputRef={inputRef}
                    label={label}
                    required={required}
                    error={error}
                    helperText={helperText}
                    placeholder={t(locale, "contract-msg.client-search-placeholder")}
                    InputProps={{
                        ...params.InputProps,
                        endAdornment: (
                            <>
                                {isLoading ? (
                                    <CircularProgress color="inherit" size={20} />
                                ) : null}
                                {params.InputProps.endAdornment}
                            </>
                        ),
                    }}
                />
            )}
            noOptionsText={
                <Typography variant="body2" color="text.secondary" sx={{ py: 1, textAlign: "center" }}>
                    {t(locale, "contract-msg.no-client-found")}
                </Typography>
            }
            slots={{
                paper: (props) => (
                    <Paper {...props} data-component="client-autocomplete-paper" elevation={8}>
                        {props.children}
                        {allowManualEntry && (
                            <>
                                <Divider />
                                <ButtonBase
                                    onMouseDown={handleManualEntry}
                                    sx={{
                                        width: "100%",
                                        py: 1.5,
                                        px: 2,
                                        justifyContent: "flex-start",
                                        "&:hover": {
                                            bgcolor: "action.hover",
                                        },
                                    }}
                                >
                                    <Box
                                        sx={{
                                            display: "flex",
                                            flexDirection: "column",
                                            width: "100%",
                                        }}
                                    >
                                        <Box
                                            sx={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 1,
                                            }}
                                        >
                                            <UserPlus size={16} />
                                            <Typography variant="body1" color="primary">
                                                {t(locale, "contract-msg.manual-entry")}
                                            </Typography>
                                        </Box>
                                        <Typography variant="caption" color="text.secondary">
                                            {t(locale, "contract-msg.manual-entry-description")}
                                        </Typography>
                                    </Box>
                                </ButtonBase>
                            </>
                        )}
                    </Paper>
                ),
            }}
        />
    );
}
