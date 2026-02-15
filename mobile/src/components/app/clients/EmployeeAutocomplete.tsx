"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Check, UserPlus, X, Loader2 } from "lucide-react";
import { useEmployees, Employee } from "@/hooks/useEmployees";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { useEmployeeDialogStore } from "@/stores/employee-dialog-store";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

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
    const setPrefillName = useEmployeeDialogStore((state) => state.setPrefillName);

    const [inputValue, setInputValue] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const availableEmployees = useMemo(() => {
        if (!employees) return [];
        return employees.filter(emp => !excludeIds.includes(emp.id));
    }, [employees, excludeIds]);

    const selectedEmployee = useMemo(() => {
        if (value === null || value === undefined || !employees) return null;
        return employees.find(emp => emp.id === value) || null;
    }, [value, employees]);

    const filteredEmployees = useMemo(() => {
        if (!inputValue.trim()) return [];
        const searchTerm = inputValue.trim();
        return availableEmployees.filter(emp =>
            matchesKoreanSearch(emp.name, searchTerm) ||
            emp.workArea.some(area => area.toLowerCase().includes(searchTerm.toLowerCase())) ||
            emp.phone.includes(searchTerm)
        );
    }, [availableEmployees, inputValue]);

    const showDropdown = isFocused && inputValue.trim().length > 0;

    useEffect(() => {
        if (selectedEmployee) {
            setInputValue(selectedEmployee.name);
        } else if (value === null || value === undefined) {
            setInputValue("");
        }
    }, [selectedEmployee, value]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsFocused(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        setHighlightedIndex(-1);
    }, [filteredEmployees]);

    const handleSelect = (employee: Employee) => {
        setInputValue(employee.name);
        onChange(employee.id, employee);
        setIsFocused(false);
        inputRef.current?.blur();
    };

    const handleClear = () => {
        setInputValue("");
        onChange(null, null);
        inputRef.current?.focus();
    };

    const handleManualEntry = () => {
        setPrefillName(inputValue);
        setIsFocused(false);
        setTimeout(() => {
            if (onManualEntry) {
                onManualEntry(inputValue);
            }
        }, 100);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!showDropdown) return;
        const totalItems = filteredEmployees.length + (allowManualEntry ? 1 : 0);

        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlightedIndex(prev => (prev + 1) % totalItems);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlightedIndex(prev => (prev - 1 + totalItems) % totalItems);
        } else if (e.key === "Enter" && highlightedIndex >= 0) {
            e.preventDefault();
            if (highlightedIndex < filteredEmployees.length) {
                handleSelect(filteredEmployees[highlightedIndex]);
            } else if (allowManualEntry) {
                handleManualEntry();
            }
        } else if (e.key === "Escape") {
            setIsFocused(false);
            inputRef.current?.blur();
        }
    };

    return (
        <div
            data-component="employee-autocomplete"
            className="space-y-2"
            data-testid={dataTestId ?? "employee-autocomplete"}
        >
            {label && (
                <Label className={cn(error && "text-destructive")}>
                    {label}
                    {required && <span className="text-destructive ml-1">*</span>}
                </Label>
            )}
            <div ref={containerRef} className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onKeyDown={handleKeyDown}
                    placeholder={t(locale, "clients.form.employee-search-placeholder")}
                    data-component="employee-autocomplete-input"
                    style={{ outline: "2px solid transparent", outlineOffset: "2px" }}
                    className={cn(
                        "w-full h-9 px-3 pr-16 py-1 rounded-md border bg-transparent text-sm shadow-sm transition-colors",
                        "placeholder:text-muted-foreground",
                        error && "border-destructive",
                        !error && "border-input"
                    )}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {isLoading && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    {selectedEmployee && !isLoading && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="p-0.5 rounded-sm hover:bg-accent"
                        >
                            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                        </button>
                    )}
                </div>

                {showDropdown && (
                    <div
                        className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border bg-popover shadow-md animate-in fade-in-0 zoom-in-95"
                        data-testid="employee-autocomplete-dropdown"
                    >
                        {isLoading ? (
                            <div className="flex items-center justify-center py-6">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : filteredEmployees.length === 0 ? (
                            <div className="py-6 text-center text-sm text-muted-foreground">
                                {t(locale, "clients.form.no-employee-found")}
                            </div>
                        ) : (
                            <div className="max-h-[200px] overflow-y-auto py-1">
                                {filteredEmployees.map((employee, index) => (
                                    <div
                                        key={employee.id}
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            handleSelect(employee);
                                        }}
                                        onMouseEnter={() => setHighlightedIndex(index)}
                                        className={cn(
                                            "flex flex-col items-start gap-1 px-3 py-2 cursor-pointer transition-colors",
                                            highlightedIndex === index && "bg-accent",
                                            selectedEmployee?.id === employee.id && "bg-accent/50"
                                        )}
                                    >
                                        <div className="flex items-center gap-2 w-full">
                                            <Check
                                                className={cn(
                                                    "h-4 w-4 shrink-0",
                                                    selectedEmployee?.id === employee.id ? "opacity-100" : "opacity-0"
                                                )}
                                            />
                                            <span className="font-medium text-sm">{employee.name}</span>
                                        </div>
                                        <span className="text-xs text-muted-foreground ml-6">
                                            {employee.workArea.join(", ")} · {employee.phone}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {allowManualEntry && (
                            <>
                                <div className="h-px bg-border" />
                                <div
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleManualEntry();
                                    }}
                                    onMouseEnter={() => setHighlightedIndex(filteredEmployees.length)}
                                    className={cn(
                                        "flex flex-col w-full py-3 px-3 cursor-pointer transition-colors",
                                        highlightedIndex === filteredEmployees.length && "bg-accent"
                                    )}
                                    data-testid="employee-autocomplete-add-button"
                                >
                                    <div className="flex items-center gap-2">
                                        <UserPlus className="h-4 w-4" />
                                        <span className="text-sm font-medium text-primary">
                                            {t(locale, "contract-msg.employee-manual-entry")}
                                        </span>
                                    </div>
                                    <span className="text-xs text-muted-foreground mt-1 ml-6">
                                        {t(locale, "contract-msg.employee-manual-entry-description")}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {helperText && (
                <p className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
                    {helperText}
                </p>
            )}
        </div>
    );
}
