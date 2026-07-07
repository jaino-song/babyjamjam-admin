"use client";

import { useState, useMemo, useRef } from "react";
import { Check, ChevronsUpDown, UserPlus, X, Loader2 } from "lucide-react";
import { useEmployees, Employee } from "@/hooks/useEmployees";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { useEmployeeDialogStore } from "@/stores/employee-dialog-store";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { V3_INPUT_CONTROL_CLASS_NAME } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";

interface EmployeeAutocompleteProps {
    "data-testid"?: string;
    value: number | null;
    onChange: (employeeId: number | null, employee: Employee | null) => void;
    label: string;
    required?: boolean;
    error?: boolean;
    helperText?: string;
    excludeIds?: number[];
    allowManualEntry?: boolean;
    onManualEntry?: (inputValue?: string) => void;
    allowManualInput?: boolean;
    manualValue?: string;
    onManualInputChange?: (value: string) => void;
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
    allowManualInput = false,
    manualValue = "",
    onManualInputChange,
    "data-testid": dataTestId,
}: EmployeeAutocompleteProps) {
    const locale = useLocale();
    const { data: employees, isLoading } = useEmployees();
    const setPrefillName = useEmployeeDialogStore((state) => state.setPrefillName);

    const [isOpen, setIsOpen] = useState(false);
    const [inputValue, setInputValue] = useState("");
    const triggerRef = useRef<HTMLButtonElement>(null);

    const availableEmployees = useMemo(() => {
        if (!employees) return [];
        return employees.filter((emp) => !excludeIds.includes(emp.id));
    }, [employees, excludeIds]);

    const selectedEmployee = useMemo(() => {
        if (value === null || value === undefined || !employees) return null;
        return employees.find((emp) => emp.id === value) || null;
    }, [value, employees]);

    const filteredEmployees = useMemo(() => {
        if (!inputValue.trim()) return availableEmployees;
        const searchTerm = inputValue.trim();
        return availableEmployees.filter(
            (emp) =>
                matchesKoreanSearch(emp.name, searchTerm) ||
                emp.workArea.some((area) =>
                    area.toLowerCase().includes(searchTerm.toLowerCase()),
                ) ||
                emp.phone.includes(searchTerm),
        );
    }, [availableEmployees, inputValue]);

    const manualDisplayValue = manualValue.trim();
    const hasDisplayValue = Boolean(selectedEmployee || manualDisplayValue);

    const handleOpenChange = (open: boolean) => {
        setIsOpen(open);
        if (open && !selectedEmployee) {
            setInputValue(manualValue);
        }
    };

    const handleInputValueChange = (value: string) => {
        setInputValue(value);
        if (allowManualInput && !selectedEmployee) {
            onManualInputChange?.(value);
        }
    };

    const handleSelect = (employee: Employee) => {
        onChange(employee.id, employee);
        setIsOpen(false);
        setInputValue("");
    };

    const clearSelection = () => {
        onChange(null, null);
        onManualInputChange?.("");
        setInputValue("");
    };

    const handleClear = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        clearSelection();
    };

    const handleManualEntry = () => {
        setPrefillName(inputValue);
        setIsOpen(false);
        setTimeout(() => {
            if (onManualEntry) {
                onManualEntry(inputValue);
            }
        }, 100);
    };

    return (
        <div
            data-component="employee-autocomplete"
            className="space-y-2"
            data-testid={dataTestId ?? "employee-autocomplete"}
        >
            {label && (
                <Label
                    className={cn(
                        "text-[calc(12px*var(--v3-ui-scale,1))] font-semibold leading-[1.3] text-v3-text-muted",
                        error && "text-destructive",
                    )}
                >
                    {label}
                    {required && <span className="text-destructive ml-1">*</span>}
                </Label>
            )}
            <Popover open={isOpen} onOpenChange={handleOpenChange}>
                <div className="relative">
                    <PopoverTrigger asChild>
                        <Button
                            ref={triggerRef}
                            variant="outline"
                            role="combobox"
                            aria-expanded={isOpen}
                            data-component="employee-autocomplete-input"
                            className={cn(
                                V3_INPUT_CONTROL_CLASS_NAME,
                                "w-full justify-between font-normal hover:bg-white",
                                hasDisplayValue
                                    ? "text-v3-dark hover:text-v3-dark"
                                    : "text-muted-foreground hover:text-muted-foreground",
                                error && "border-destructive focus:ring-destructive",
                            )}
                        >
                            <span className="min-w-0 flex-1 truncate text-left">
                                {selectedEmployee
                                    ? selectedEmployee.name
                                    : manualDisplayValue
                                      ? manualDisplayValue
                                    : t(locale, "clients.form.employee-search-placeholder")}
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                                {isLoading && (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                )}
                                {selectedEmployee && !isLoading && (
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        aria-label="제공인력 선택 해제"
                                        className="flex h-5 w-5 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                                        onPointerDown={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                        }}
                                        onClick={handleClear}
                                        onKeyDown={(event) => {
                                            if (event.key !== "Enter" && event.key !== " ") return;
                                            event.preventDefault();
                                            event.stopPropagation();
                                            clearSelection();
                                        }}
                                    >
                                        <X className="h-4 w-4" aria-hidden="true" />
                                    </span>
                                )}
                                <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                            </div>
                        </Button>
                    </PopoverTrigger>
                </div>
                <PopoverContent
                    data-component="employee-autocomplete-dropdown"
                    className="w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-[22px] border-none bg-white p-0 text-v3-dark shadow-[0_0_0_2px_hsla(214,30%,40%,0.12),0_0_12px_hsla(214,30%,40%,0.05)]"
                    align="start"
                >
                    <Command shouldFilter={false}>
                        <CommandInput
                            placeholder={t(locale, "clients.form.employee-search-placeholder")}
                            value={inputValue}
                            onValueChange={handleInputValueChange}
                        />
                        <CommandList>
                            {isLoading ? (
                                <div className="flex items-center justify-center py-6">
                                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                            ) : filteredEmployees.length === 0 ? (
                                <CommandEmpty>
                                    <span className="text-muted-foreground">
                                        {t(locale, "clients.form.no-employee-found")}
                                    </span>
                                </CommandEmpty>
                            ) : (
                                <CommandGroup className="p-0">
                                    {filteredEmployees.map((employee) => (
                                        <CommandItem
                                            key={employee.id}
                                            value={employee.id.toString()}
                                            onSelect={() => handleSelect(employee)}
                                            className="group flex flex-col items-start gap-1 rounded-[16px] px-3 py-2.5 data-[selected=true]:not-hover:bg-transparent data-[selected=true]:not-hover:text-current hover:text-white hover:rounded-none"
                                        >
                                            <div className="flex items-center gap-2 w-full">
                                                <Check
                                                    className={cn(
                                                        "h-4 w-4 shrink-0",
                                                        selectedEmployee?.id === employee.id
                                                            ? "opacity-100"
                                                            : "opacity-0",
                                                    )}
                                                />
                                                <span className="font-medium">{employee.name}</span>
                                            </div>
                                            <span className="text-xs text-muted-foreground ml-6 group-hover:text-white">
                                                {employee.workArea.join(", ")} · {employee.phone}
                                            </span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )}
                        </CommandList>

                        {allowManualEntry && (
                            <>
                                <CommandSeparator />
                                <button
                                    type="button"
                                    className="group flex w-full flex-col rounded-[16px] px-3 py-3 text-left transition-colors hover:bg-accent hover:text-white hover:rounded-t-none"
                                    onClick={handleManualEntry}
                                    data-testid="employee-autocomplete-add-button"
                                >
                                    <div className="flex items-center gap-2">
                                        <UserPlus className="h-4 w-4" />
                                        <span className="text-sm font-medium text-primary group-hover:text-white">
                                            {t(locale, "contract-msg.employee-manual-entry")}
                                        </span>
                                    </div>
                                    <span className="text-xs text-muted-foreground mt-1 group-hover:text-white">
                                        {t(locale, "contract-msg.employee-manual-entry-description")}
                                    </span>
                                </button>
                            </>
                        )}
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
