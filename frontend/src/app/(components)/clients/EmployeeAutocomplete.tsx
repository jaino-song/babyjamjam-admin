"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
    Autocomplete,
    TextField,
    Box,
    Typography,
    CircularProgress,
    Paper,
    Divider,
    ButtonBase,
} from "@mui/material";
import { UserPlus } from "lucide-react";
import { useEmployees, Employee } from "@/app/hooks/useEmployees";
import { useLocale } from "../LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import { useEmployeeDialogStore } from "@/app/store/employee-dialog-store";
import { matchesKoreanSearch } from "@/app/lib/utils/korean-search";

interface EmployeeAutocompleteProps {
    "data-component"?: string;
    value: number | null;
    onChange: (employeeId: number | null, employee: Employee | null) => void;
    label: string;
    required?: boolean;
    error?: boolean;
    helperText?: string;
    excludeIds?: number[]; // IDs to exclude from options (e.g., if already selected as secondary)
    allowManualEntry?: boolean;
    onManualEntry?: (inputValue?: string) => void;
}

export function EmployeeAutocomplete({
    value,
    onChange,
    label,
    required = false,
    error = false,
    helperText,
    excludeIds = [],
    allowManualEntry = false,
    onManualEntry,
    "data-component": dataComponent,
}: EmployeeAutocompleteProps) {
    const locale = useLocale();
    const { data: employees, isLoading } = useEmployees();

    // Zustand store for prefilling employee name in EmployeeFormDialog
    const setPrefillName = useEmployeeDialogStore((state) => state.setPrefillName);

    // Track input value for display synchronization
    const [inputValue, setInputValue] = useState("");
    // Track open state - needed for Korean IME compatibility
    const [isOpen, setIsOpen] = useState(false);
    // Ref for the input element - used to blur when closing dropdown
    const inputRef = useRef<HTMLInputElement>(null);

    // Filter out excluded employees
    const availableEmployees = useMemo(() => {
        if (!employees) return [];
        return employees.filter(emp => !excludeIds.includes(emp.id));
    }, [employees, excludeIds]);

    // Find selected employee
    const selectedEmployee = useMemo(() => {
        // Use explicit null/undefined check instead of falsy check since 0 is a valid ID
        if (value === null || value === undefined || !employees) return null;
        return employees.find(emp => emp.id === value) || null;
    }, [value, employees]);

    // Sync inputValue when selectedEmployee changes (e.g., after creating a new employee)
    // This ensures the text field shows the employee name when selection changes externally
    useEffect(() => {
        if (selectedEmployee) {
            setInputValue(selectedEmployee.name);
        } else if (value === null) {
            // Only clear input if value is explicitly null (not when waiting for employees to load)
            setInputValue("");
        }
    }, [selectedEmployee, value]);

    const handleChange = (
        _event: React.SyntheticEvent,
        newValue: Employee | null
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
        setIsOpen(false);
        // Blur the input using ref to ensure dropdown closes completely
        // Note: We use ref because the Paper slot is rendered in a Portal,
        // so DOM traversal with closest() won't find the Autocomplete
        inputRef.current?.blur();
        // Save typed name to Zustand store for EmployeeFormDialog to prefill
        setPrefillName(inputValue);
        // Use setTimeout to ensure dropdown is fully closed before opening dialog
        // This prevents the dropdown from appearing over the new dialog
        setTimeout(() => {
            if (onManualEntry) {
                onManualEntry(inputValue);
            }
        }, 100);
    };

    // Handle input change to track what user types
    const handleInputChange = (
        _event: React.SyntheticEvent,
        newInputValue: string,
        reason: string
    ) => {
        if (reason === "input" || reason === "clear") {
            setInputValue(newInputValue);
        }
    };

    return (
        <Autocomplete<Employee, false, false, false>
            data-component={dataComponent ?? "EmployeeAutocomplete"}
            value={selectedEmployee}
            onChange={handleChange}
            inputValue={inputValue}
            onInputChange={handleInputChange}
            options={availableEmployees}
            loading={isLoading}
            clearOnBlur={false}
            blurOnSelect={true}
            // Open on focus for better UX with Korean IME
            open={isOpen}
            onOpen={() => setIsOpen(true)}
            onClose={() => setIsOpen(false)}
            openOnFocus
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, val) => option.id === val.id}
            filterOptions={(options, { inputValue: filterInput }) => {
                // Only show options when user has typed something
                if (!filterInput.trim()) return [];
                return options.filter(
                    emp =>
                        // 초성 search only for name (e.g., ㄱ → 김현아)
                        matchesKoreanSearch(emp.name, filterInput) ||
                        // Work area: simple substring match (no 초성 to avoid false positives)
                        emp.workArea.some(area => area.toLowerCase().includes(filterInput.toLowerCase())) ||
                        // Phone: simple substring match
                        emp.phone.includes(filterInput)
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
                        </Box>
                        <Typography variant="caption" color="text.secondary">
                            {option.workArea.join(", ")} · {option.phone}
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
                    placeholder={t(locale, "clients.form.employee-search-placeholder")}
                    InputProps={{
                        ...params.InputProps,
                        endAdornment: (
                            <>
                                {isLoading ? <CircularProgress color="inherit" size={20} /> : null}
                                {params.InputProps.endAdornment}
                            </>
                        ),
                    }}
                />
            )}
            noOptionsText={
                <Typography variant="body2" color="text.secondary" sx={{ py: 1, textAlign: "center" }}>
                    {t(locale, "clients.form.no-employee-found")}
                </Typography>
            }
            slots={{
                paper: (props) => (
                    <Paper {...props} elevation={8} data-component="EmployeeAutocomplete-Dropdown">
                        {props.children}
                        {allowManualEntry && (
                            <>
                                <Divider />
                                <ButtonBase
                                    data-component="EmployeeAutocomplete-AddNewButton"
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
                                                {t(locale, "contract-msg.employee-manual-entry")}
                                            </Typography>
                                        </Box>
                                        <Typography variant="caption" color="text.secondary">
                                            {t(locale, "contract-msg.employee-manual-entry-description")}
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
