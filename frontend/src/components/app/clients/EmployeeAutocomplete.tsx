"use client";

import { useState, useMemo, useEffect } from "react";
import { Check, ChevronsUpDown, UserPlus } from "lucide-react";
import { useEmployees, Employee } from "@/hooks/useEmployees";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { useEmployeeDialogStore } from "@/stores/employee-dialog-store";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

interface EmployeeAutocompleteProps {
    "data-testid"?: string;
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
    "data-testid": dataTestId,
}: EmployeeAutocompleteProps) {
    const locale = useLocale();
    const { data: employees, isLoading } = useEmployees();

    // Zustand store for prefilling employee name in EmployeeFormDialog
    const setPrefillName = useEmployeeDialogStore((state) => state.setPrefillName);

    // Track input value for display and filtering
    const [inputValue, setInputValue] = useState("");
    // Track open state
    const [isOpen, setIsOpen] = useState(false);
    // Track Korean IME composition (used for onCompositionStart/End)
    const [, setIsComposing] = useState(false);

    // Filter out excluded employees
    const availableEmployees = useMemo(() => {
        if (!employees) return [];
        return employees.filter(emp => !excludeIds.includes(emp.id));
    }, [employees, excludeIds]);

    // Find selected employee
    const selectedEmployee = useMemo(() => {
        if (value === null || value === undefined || !employees) return null;
        return employees.find(emp => emp.id === value) || null;
    }, [value, employees]);

    // Filter employees based on input
    const filteredEmployees = useMemo(() => {
        if (!inputValue.trim()) return availableEmployees;

        const searchTerm = inputValue.trim();

        return availableEmployees.filter(emp =>
            // 초성 search for name (e.g., ㄱ → 김현아)
            matchesKoreanSearch(emp.name, searchTerm) ||
            // Work area: simple substring match
            emp.workArea.some(area => area.toLowerCase().includes(searchTerm.toLowerCase())) ||
            // Phone: simple substring match
            emp.phone.includes(searchTerm)
        );
    }, [availableEmployees, inputValue]);

    // Sync inputValue when selectedEmployee changes
    useEffect(() => {
        if (selectedEmployee) {
            setInputValue(selectedEmployee.name);
        } else if (value === null || value === undefined) {
            setInputValue("");
        }
    }, [selectedEmployee, value]);

    const handleSelect = (employee: Employee) => {
        setInputValue(employee.name);
        onChange(employee.id, employee);
        setIsOpen(false);
    };

    const handleManualEntry = () => {
        // Save typed name to Zustand store for EmployeeFormDialog to prefill
        setPrefillName(inputValue);
        setIsOpen(false);
        // Use setTimeout to ensure popover is fully closed before opening dialog
        setTimeout(() => {
            if (onManualEntry) {
                onManualEntry(inputValue);
            }
        }, 100);
    };

    // Handle input change during search
    const handleInputChange = (newValue: string) => {
        setInputValue(newValue);
        // Don't clear selection until user explicitly selects something else
    };

    return (
        <div data-component="employee-autocomplete" className="space-y-2" data-testid={dataTestId ?? "employee-autocomplete"}>
            <Label className={cn(error && "text-destructive")}>
                {label}
                {required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={isOpen}
                        data-component="employee-autocomplete-input"
                        className={cn(
                            "w-full justify-between font-normal",
                            !selectedEmployee && "text-muted-foreground",
                            error && "border-destructive"
                        )}
                    >
                        {selectedEmployee ? selectedEmployee.name : t(locale, "clients.form.employee-search-placeholder")}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent data-component="employee-autocomplete-dropdown" className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command shouldFilter={false}>
                        <CommandInput
                            placeholder={t(locale, "clients.form.employee-search-placeholder")}
                            value={inputValue}
                            onValueChange={handleInputChange}
                            onCompositionStart={() => setIsComposing(true)}
                            onCompositionEnd={() => setIsComposing(false)}
                        />
                        <CommandList data-testid="employee-autocomplete-dropdown">
                            {isLoading ? (
                                <div className="flex items-center justify-center py-6">
                                    <Spinner className="h-4 w-4" />
                                </div>
                            ) : filteredEmployees.length === 0 ? (
                                <CommandEmpty>
                                    {t(locale, "clients.form.no-employee-found")}
                                </CommandEmpty>
                            ) : (
                                <CommandGroup>
                                    {filteredEmployees.map((employee) => (
                                        <CommandItem
                                            key={employee.id}
                                            value={String(employee.id)}
                                            onSelect={() => handleSelect(employee)}
                                            className="flex flex-col items-start gap-1 py-2"
                                        >
                                            <div className="flex items-center gap-2 w-full">
                                                <Check
                                                    className={cn(
                                                        "h-4 w-4",
                                                        selectedEmployee?.id === employee.id
                                                            ? "opacity-100"
                                                            : "opacity-0"
                                                    )}
                                                />
                                                <span className="font-medium">{employee.name}</span>
                                            </div>
                                            <span className="text-xs text-muted-foreground ml-6">
                                                {employee.workArea.join(", ")} · {employee.phone}
                                            </span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )}

                            {allowManualEntry && (
                                <>
                                    <CommandSeparator />
                                    <CommandGroup>
                                        <CommandItem
                                            onSelect={handleManualEntry}
                                            className="cursor-pointer"
                                            data-testid="employee-autocomplete-add-button"
                                        >
                                            <div className="flex flex-col w-full">
                                                <div className="flex items-center gap-2">
                                                    <UserPlus className="h-4 w-4" />
                                                    <span className="text-primary font-medium">
                                                        {t(locale, "contract-msg.employee-manual-entry")}
                                                    </span>
                                                </div>
                                                <span className="text-xs text-muted-foreground ml-6">
                                                    {t(locale, "contract-msg.employee-manual-entry-description")}
                                                </span>
                                            </div>
                                        </CommandItem>
                                    </CommandGroup>
                                </>
                            )}
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
            {helperText && (
                <p className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
                    {helperText}
                </p>
            )}
        </div>
    );
}
