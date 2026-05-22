"use client";

import {
    useState,
    useMemo,
    useEffect,
    useRef,
    type ReactNode,
} from "react";
import { Check, ChevronDown, X, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/app/v3";

export interface AutocompleteManualEntry {
    label: ReactNode;
    description?: ReactNode;
    icon?: ReactNode;
    onSelect: (query: string) => void;
}

export interface AutocompleteItemContext {
    highlighted: boolean;
    selected: boolean;
}

export interface AutocompleteProps<T> {
    name: string;
    value: T | null;
    onChange: (item: T | null) => void;
    items: T[];
    isLoading?: boolean;
    getItemKey: (item: T) => string | number;
    getItemLabel: (item: T) => string;
    getItemMeta?: (item: T, ctx: AutocompleteItemContext) => ReactNode;
    getItemHeaderExtra?: (item: T, ctx: AutocompleteItemContext) => ReactNode;
    filter?: (item: T, query: string) => boolean;
    placeholder?: string;
    label?: ReactNode;
    required?: boolean;
    error?: boolean;
    helperText?: ReactNode;
    emptyMessage?: ReactNode;
    manualEntry?: AutocompleteManualEntry;
    className?: string;
}

export function Autocomplete<T>({
    name,
    value,
    onChange,
    items,
    isLoading = false,
    getItemKey,
    getItemLabel,
    getItemMeta,
    getItemHeaderExtra,
    filter,
    placeholder,
    label,
    required,
    error,
    helperText,
    emptyMessage,
    manualEntry,
    className,
}: AutocompleteProps<T>) {
    const [inputValue, setInputValue] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const [isToggledOpen, setIsToggledOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (value) {
            setInputValue(getItemLabel(value));
        } else {
            setInputValue("");
        }
    }, [value, getItemLabel]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsFocused(false);
                setIsToggledOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const filteredItems = useMemo(() => {
        const query = inputValue.trim();
        if (!query) return items;
        if (filter) return items.filter((item) => filter(item, query));
        return items.filter((item) =>
            getItemLabel(item).toLowerCase().includes(query.toLowerCase())
        );
    }, [items, inputValue, filter, getItemLabel]);

    const showDropdown =
        (isFocused && inputValue.trim().length > 0) || isToggledOpen;

    useEffect(() => {
        setHighlightedIndex(-1);
    }, [filteredItems]);

    const handleSelect = (item: T) => {
        setInputValue(getItemLabel(item));
        onChange(item);
        setIsFocused(false);
        setIsToggledOpen(false);
        inputRef.current?.blur();
    };

    const handleClear = () => {
        setInputValue("");
        onChange(null);
        inputRef.current?.focus();
    };

    const handleManualEntry = () => {
        const query = inputValue;
        setIsFocused(false);
        setIsToggledOpen(false);
        setTimeout(() => manualEntry?.onSelect(query), 100);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!showDropdown) return;
        const total = filteredItems.length + (manualEntry ? 1 : 0);
        if (total === 0) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlightedIndex((prev) => (prev + 1) % total);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlightedIndex((prev) => (prev - 1 + total) % total);
        } else if (e.key === "Enter" && highlightedIndex >= 0) {
            e.preventDefault();
            if (highlightedIndex < filteredItems.length) {
                handleSelect(filteredItems[highlightedIndex]);
            } else if (manualEntry) {
                handleManualEntry();
            }
        } else if (e.key === "Escape") {
            setIsFocused(false);
            setIsToggledOpen(false);
            inputRef.current?.blur();
        }
    };

    const containerDc = `${name}-autocomplete`;
    const inputDc = `${name}-autocomplete-input`;
    const toggleDc = `${name}-autocomplete-toggle`;
    const dropdownDc = `${name}-autocomplete-dropdown`;
    const addBtnDc = `${name}-autocomplete-add-button`;

    return (
        <div
            data-component={containerDc}
            data-testid={containerDc}
            className={cn("space-y-2", className)}
        >
            {label && (
                <Label className={cn(error && "text-destructive")}>
                    {label}
                    {required && <span className="text-destructive ml-1">*</span>}
                </Label>
            )}
            <div ref={containerRef} className="relative">
                <Input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    data-component={inputDc}
                    className={cn("pr-16", error && "border-destructive")}
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {value && !isLoading && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="p-0.5 rounded-2xl"
                            aria-label="선택 해제"
                        >
                            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                        </button>
                    )}
                    {isLoading && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                    <button
                        type="button"
                        onClick={() => {
                            if (showDropdown) {
                                setIsToggledOpen(false);
                                setIsFocused(false);
                                inputRef.current?.blur();
                            } else {
                                setIsToggledOpen(true);
                                inputRef.current?.focus();
                            }
                        }}
                        className="p-1 rounded-2xl"
                        aria-label="목록 열기"
                        data-component={toggleDc}
                    >
                        <ChevronDown
                            className={cn(
                                "h-4 w-4 text-muted-foreground transition-transform",
                                showDropdown && "rotate-180"
                            )}
                        />
                    </button>
                </div>

                {showDropdown && (
                    <div
                        data-component={dropdownDc}
                        data-testid={dropdownDc}
                        className="absolute top-full left-0 right-0 z-50 rounded-2xl bg-white shadow-[0_4px_16px_rgba(0,0,0,0.06)] overflow-hidden animate-in fade-in-0 zoom-in-95"
                    >
                        {isLoading ? (
                            <div className="flex items-center justify-center py-6">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : filteredItems.length === 0 ? (
                            <div className="py-6 text-center text-sm text-muted-foreground">
                                {emptyMessage ?? "결과 없음"}
                            </div>
                        ) : (
                            <div className="max-h-[200px] overflow-y-auto">
                                {filteredItems.map((item, index) => {
                                    const selected =
                                        value != null &&
                                        getItemKey(value) === getItemKey(item);
                                    const highlighted = highlightedIndex === index;
                                    const ctx = { highlighted, selected };
                                    const meta = getItemMeta?.(item, ctx);
                                    const headerExtra = getItemHeaderExtra?.(item, ctx);
                                    return (
                                        <div
                                            key={getItemKey(item)}
                                            onMouseDown={(e) => {
                                                e.preventDefault();
                                                handleSelect(item);
                                            }}
                                            onMouseEnter={() => setHighlightedIndex(index)}
                                            className={cn(
                                                "flex flex-col items-start px-3 py-2 cursor-pointer transition-colors",
                                                highlighted && "bg-v3-primary text-white",
                                                selected && !highlighted && "bg-v3-primary/10"
                                            )}
                                        >
                                            <div className="flex items-center gap-2 w-full">
                                                <Check
                                                    className={cn(
                                                        "h-4 w-4 shrink-0",
                                                        selected ? "opacity-100" : "opacity-0"
                                                    )}
                                                />
                                                <span className="font-medium text-sm">
                                                    {getItemLabel(item)}
                                                </span>
                                                {headerExtra}
                                            </div>
                                            {meta != null && meta !== "" && (
                                                <div
                                                    className={cn(
                                                        "text-xs ml-6 mt-1",
                                                        !highlighted && "text-muted-foreground"
                                                    )}
                                                >
                                                    {meta}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {manualEntry && (
                            <>
                                <div className="h-px bg-v3-border" />
                                <div
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        handleManualEntry();
                                    }}
                                    onMouseEnter={() =>
                                        setHighlightedIndex(filteredItems.length)
                                    }
                                    className={cn(
                                        "flex flex-col w-full py-3 px-3 cursor-pointer transition-colors",
                                        highlightedIndex === filteredItems.length &&
                                            "bg-v3-primary text-white"
                                    )}
                                    data-component={addBtnDc}
                                    data-testid={addBtnDc}
                                >
                                    <div className="flex items-center gap-2">
                                        {manualEntry.icon}
                                        <span
                                            className={cn(
                                                "text-sm font-medium",
                                                highlightedIndex !== filteredItems.length &&
                                                    "text-primary"
                                            )}
                                        >
                                            {manualEntry.label}
                                        </span>
                                    </div>
                                    {manualEntry.description && (
                                        <span
                                            className={cn(
                                                "text-xs mt-1 ml-6",
                                                highlightedIndex !== filteredItems.length &&
                                                    "text-muted-foreground"
                                            )}
                                        >
                                            {manualEntry.description}
                                        </span>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {helperText && (
                <p
                    className={cn(
                        "text-xs",
                        error ? "text-destructive" : "text-muted-foreground"
                    )}
                >
                    {helperText}
                </p>
            )}
        </div>
    );
}
