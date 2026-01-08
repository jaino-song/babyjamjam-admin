"use client";

/**
 * EmployeeAutocomplete wrapper for backward compatibility.
 *
 * This component wraps the canonical EmployeeAutocomplete from app/(components)
 * and adapts its API for simpler usage in features/clients.
 *
 * Main differences from canonical:
 * - Simpler onChange: (employeeId: number | null) => void
 * - Uses onAddNew instead of allowManualEntry + onManualEntry
 *
 * For full features (Korean IME support, Zustand prefill), use the canonical
 * component directly from "@/app/(components)/clients/EmployeeAutocomplete"
 */

import {
    EmployeeAutocomplete as CanonicalEmployeeAutocomplete,
} from "@/app/(components)/clients/EmployeeAutocomplete";
import type { Employee } from "@/features/employees";

interface EmployeeAutocompleteProps {
    value: number | null;
    onChange: (employeeId: number | null) => void;
    label: string;
    required?: boolean;
    error?: boolean;
    helperText?: string;
    excludeIds?: number[];
    onAddNew?: () => void;
}

export function EmployeeAutocomplete({
    value,
    onChange,
    label,
    required = false,
    error = false,
    helperText,
    excludeIds = [],
    onAddNew,
}: EmployeeAutocompleteProps) {
    // Adapt onChange to simpler signature (ignoring employee object)
    const handleChange = (employeeId: number | null, _employee: Employee | null) => {
        onChange(employeeId);
    };

    return (
        <CanonicalEmployeeAutocomplete
            value={value}
            onChange={handleChange}
            label={label}
            required={required}
            error={error}
            helperText={helperText}
            excludeIds={excludeIds}
            allowManualEntry={!!onAddNew}
            onManualEntry={onAddNew}
            data-component="EmployeeAutocomplete-FeaturesWrapper"
        />
    );
}
