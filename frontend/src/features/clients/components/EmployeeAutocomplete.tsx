"use client";

import { useState, useMemo } from "react";
import {
    Autocomplete,
    TextField,
    Box,
    Typography,
    CircularProgress,
    Button,
    Paper,
} from "@mui/material";
import { UserPlus } from "lucide-react";
import { useEmployees } from "@/features/employees";
import type { Employee } from "@/features/employees";
import { useLocale } from "@/core/providers";
import { t } from "@/app/lib/i18n/translations";

interface EmployeeAutocompleteProps {
    value: number | null;
    onChange: (employeeId: number | null) => void;
    label: string;
    required?: boolean;
    error?: boolean;
    helperText?: string;
    excludeIds?: number[]; // IDs to exclude from options (e.g., if already selected as secondary)
}

export function EmployeeAutocomplete({
    value,
    onChange,
    label,
    required = false,
    error = false,
    helperText,
    excludeIds = [],
}: EmployeeAutocompleteProps) {
    const locale = useLocale();
    const { data: employees, isLoading } = useEmployees();
    const [showAddNewAlert, setShowAddNewAlert] = useState(false);

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

    const handleChange = (
        _event: React.SyntheticEvent,
        newValue: Employee | null
    ) => {
        onChange(newValue?.id ?? null);
    };

    const handleAddNewEmployee = () => {
        alert(t(locale, "clients.form.add-employee-coming-soon"));
    };

    return (
        <Autocomplete<Employee, false, false, false>
            value={selectedEmployee}
            onChange={handleChange}
            options={availableEmployees}
            loading={isLoading}
            clearOnBlur={false}
            blurOnSelect={true}
            getOptionLabel={(option) => `${option.name} (${option.workArea.join(", ")})`}
            isOptionEqualToValue={(option, val) => option.id === val.id}
            filterOptions={(options, { inputValue }) => {
                if (!inputValue.trim()) return options;
                const searchLower = inputValue.toLowerCase();
                return options.filter(
                    emp =>
                        emp.name.toLowerCase().includes(searchLower) ||
                        emp.workArea.some(area => area.toLowerCase().includes(searchLower)) ||
                        emp.phone.includes(inputValue)
                );
            }}
            renderOption={(props, option) => (
                <Box component="li" {...props} key={option.id}>
                    <Box sx={{ display: "flex", flexDirection: "column" }}>
                        <Typography variant="body1">
                            {option.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {option.workArea.join(", ")} · {option.phone}
                        </Typography>
                    </Box>
                </Box>
            )}
            renderInput={(params) => (
                <TextField
                    {...params}
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
                <Box sx={{ textAlign: "center", py: 2 }}>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                        {t(locale, "clients.form.no-employee-found")}
                    </Typography>
                    <Button
                        startIcon={<UserPlus size={18} />}
                        variant="outlined"
                        size="small"
                        onClick={handleAddNewEmployee}
                    >
                        {t(locale, "clients.form.add-new-employee")}
                    </Button>
                </Box>
            }
            PaperComponent={(props) => (
                <Paper {...props} elevation={8} />
            )}
        />
    );
}
