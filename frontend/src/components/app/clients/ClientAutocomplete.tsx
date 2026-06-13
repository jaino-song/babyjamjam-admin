"use client";

import { useState, useMemo, useRef } from "react";
import { UserPlus, FileCheck, ChevronsUpDown, Check, X, Loader2, Play } from "lucide-react";
import { useAllClients } from "@/hooks/useClients";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import type { Client } from "@/lib/client/types";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { V3_INPUT_CONTROL_CLASS_NAME } from "@/components/ui/input";

interface ClientAutocompleteProps {
    value: number | null;
    onChange: (clientId: number | null, client: Client | null) => void;
    label: string;
    required?: boolean;
    error?: boolean;
    helperText?: string;
    placeholder?: string;
    excludeIds?: number[];
    allowManualEntry?: boolean;
    onManualEntry?: () => void;
    manualValue?: string;
    onManualValueChange?: (value: string) => void;
}

export function ClientAutocomplete({
    value,
    onChange,
    label,
    required = false,
    error = false,
    helperText,
    placeholder,
    excludeIds = [],
    allowManualEntry = false,
    onManualEntry,
    manualValue,
    onManualValueChange,
}: ClientAutocompleteProps) {
    const locale = useLocale();
    const { data: clients, isLoading } = useAllClients();
    const setPrefillName = useClientDialogStore((state) => state.setPrefillName);
    const allowsInlineManualValue = typeof onManualValueChange === "function";

    // Track input value for display synchronization
    const [inputValue, setInputValue] = useState("");
    // Track open state for controlled dropdown behavior
    const [isOpen, setIsOpen] = useState(false);
    // Ref for focusing input after clear
    const triggerRef = useRef<HTMLButtonElement>(null);

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

    const commandInputValue = selectedClient?.name || (allowsInlineManualValue ? manualValue ?? "" : inputValue);

    // Filter clients based on input - Korean IME compatible
    const filteredClients = useMemo(() => {
        if (!commandInputValue.trim()) return [];
        return availableClients.filter(
            (client) =>
                // 초성 search only for name (e.g., ㄱ → 김현아)
                matchesKoreanSearch(client.name, commandInputValue) ||
                // Phone: simple substring match (no 초성)
                (client.phone && client.phone.includes(commandInputValue)) ||
                // Address: simple substring match (no 초성 to avoid false positives)
                (client.address && client.address.toLowerCase().includes(commandInputValue.toLowerCase()))
        );
    }, [availableClients, commandInputValue]);

    const handleSelect = (client: Client) => {
        setInputValue(client.name);
        onChange(client.id, client);
        setIsOpen(false);
    };

    const clearSelection = () => {
        setInputValue("");
        onManualValueChange?.("");
        onChange(null, null);
        // Focus back to trigger for better UX
        setTimeout(() => triggerRef.current?.focus(), 0);
    };

    const handleClear = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        clearSelection();
    };

    const handleManualEntry = () => {
        setIsOpen(false);
        // Save the typed name to the store so ClientFormDialog can prefill it
        setPrefillName(commandInputValue);
        // Use setTimeout to ensure dropdown is fully closed before opening dialog
        setTimeout(() => {
            if (onManualEntry) {
                onManualEntry();
            }
        }, 100);
    };

    const commitInlineManualValue = () => {
        if (!allowsInlineManualValue || !commandInputValue.trim()) return;

        if (value !== null) {
            onChange(null, null);
        }
        onManualValueChange?.(commandInputValue);
        setIsOpen(false);
        setTimeout(() => triggerRef.current?.focus(), 0);
    };

    const handleInputValueChange = (nextValue: string) => {
        setInputValue(nextValue);

        if (selectedClient && nextValue !== selectedClient.name) {
            onChange(null, null);
        }
        onManualValueChange?.(nextValue);
    };

    const displayValue = selectedClient?.name || (allowsInlineManualValue ? manualValue ?? "" : "");
    const hasDisplayValue = displayValue.trim().length > 0;
    const clearLabel = selectedClient ? "고객 선택 해제" : "고객 이름 입력 지우기";
    const searchPlaceholder = placeholder ?? t(locale, "contract-msg.client-search-placeholder");

    return (
        <div data-component="clients-autocomplete" className="space-y-2">
            <Label className={cn(error && "text-destructive")}>
                {label}
                {required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <div className="relative">
                    <PopoverTrigger asChild>
                        <Button
                            ref={triggerRef}
                            variant="outline"
                            role="combobox"
                            aria-expanded={isOpen}
                            data-component="clients-autocomplete-input"
                            className={cn(
                                V3_INPUT_CONTROL_CLASS_NAME,
                                "w-full justify-between font-normal hover:bg-white",
                                hasDisplayValue
                                    ? "text-v3-dark hover:text-v3-dark"
                                    : "text-muted-foreground hover:text-muted-foreground",
                                error && "border-destructive focus:ring-destructive"
                            )}
                        >
                            <span className="min-w-0 flex-1 truncate text-left">
                                {hasDisplayValue ? displayValue : searchPlaceholder}
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                                {isLoading && (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                )}
                                {hasDisplayValue && !isLoading && (
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        aria-label={clearLabel}
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
                    data-component="clients-autocomplete-dropdown"
                    className="w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-[22px] border-none bg-white p-0 text-v3-dark shadow-[0_0_0_2px_hsla(214,30%,40%,0.12),0_0_12px_hsla(214,30%,40%,0.05)]"
                    align="start"
                >
                    <Command shouldFilter={false}>
                        <CommandInput
                            placeholder={searchPlaceholder}
                            value={commandInputValue}
                            onValueChange={handleInputValueChange}
                            onKeyDown={(event) => {
                                if (
                                    event.key !== "Enter" ||
                                    event.nativeEvent.isComposing ||
                                    !allowsInlineManualValue
                                ) {
                                    return;
                                }

                                event.preventDefault();
                                event.stopPropagation();
                                commitInlineManualValue();
                            }}
                            endElement={
                                allowsInlineManualValue ? (
                                    <button
                                        type="button"
                                        aria-label="수동 입력으로 진행"
                                        title="수동 입력으로 진행"
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-transparent text-v3-primary transition-colors hover:text-v3-primary/80 disabled:cursor-not-allowed disabled:opacity-40"
                                        disabled={!commandInputValue.trim()}
                                        onClick={commitInlineManualValue}
                                    >
                                        <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                                    </button>
                                ) : undefined
                            }
                        />
                        <CommandList>
                            {isLoading ? (
                                <div className="flex items-center justify-center py-6">
                                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                            ) : filteredClients.length === 0 ? (
                                <CommandEmpty>
                                    <span className="text-muted-foreground">
                                        {t(locale, "contract-msg.no-client-found")}
                                    </span>
                                </CommandEmpty>
                            ) : (
                                <CommandGroup className="p-0">
                                    {filteredClients.map((client) => (
                                        <CommandItem
                                            key={client.id}
                                            value={client.id.toString()}
                                            onSelect={() => handleSelect(client)}
                                            className="group flex flex-col items-start gap-1 rounded-[16px] px-3 py-2.5 data-[selected=true]:not-hover:bg-transparent data-[selected=true]:not-hover:text-current hover:text-white hover:rounded-none"
                                        >
                                            <div className="flex items-center gap-2 w-full">
                                                <Check
                                                    className={cn(
                                                        "h-4 w-4 shrink-0",
                                                        selectedClient?.id === client.id
                                                            ? "opacity-100"
                                                            : "opacity-0"
                                                    )}
                                                />
                                                <span className="font-medium">{client.name}</span>
                                                {client.hasSigned && (
                                                    <StatusBadge variant="doc_completed" className="text-xs py-0 h-5">
                                                        <FileCheck className="h-3 w-3 mr-1" />
                                                        {t(locale, "contract-msg.client-signed")}
                                                    </StatusBadge>
                                                )}
                                            </div>
                                            <span className="text-xs text-muted-foreground ml-6 group-hover:text-white">
                                                {client.phone || "-"}{" "}
                                                {client.address && `· ${client.address}`}
                                            </span>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )}
                        </CommandList>

                        {/* Manual Entry Footer */}
                        {allowManualEntry && (
                            <>
                                <CommandSeparator />
                                <button
                                    type="button"
                                    className="group flex w-full flex-col rounded-[16px] px-3 py-3 text-left transition-colors hover:bg-accent hover:text-white hover:rounded-t-none"
                                    onClick={handleManualEntry}
                                >
                                    <div className="flex items-center gap-2">
                                        <UserPlus className="h-4 w-4" />
                                        <span className="text-sm font-medium text-primary group-hover:text-white">
                                            {t(locale, "contract-msg.manual-entry")}
                                        </span>
                                    </div>
                                    <span className="text-xs text-muted-foreground mt-1 group-hover:text-white">
                                        {t(locale, "contract-msg.manual-entry-description")}
                                    </span>
                                </button>
                            </>
                        )}
                    </Command>
                </PopoverContent>
            </Popover>
            {helperText && (
                <p className={cn("text-sm", error ? "text-destructive" : "text-muted-foreground")}>
                    {helperText}
                </p>
            )}
        </div>
    );
}
