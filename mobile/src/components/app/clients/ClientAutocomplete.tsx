"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { UserPlus, FileCheck, ChevronsUpDown, Check, X, Loader2 } from "lucide-react";
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

    // Sync inputValue when selectedClient changes (e.g., after creating a new client)
    useEffect(() => {
        if (selectedClient) {
            setInputValue(selectedClient.name);
        } else if (value === null) {
            setInputValue("");
        }
    }, [selectedClient, value]);

    // Filter clients based on input - Korean IME compatible
    const filteredClients = useMemo(() => {
        if (!inputValue.trim()) return [];
        return availableClients.filter(
            (client) =>
                // 초성 search only for name (e.g., ㄱ → 김현아)
                matchesKoreanSearch(client.name, inputValue) ||
                // Phone: simple substring match (no 초성)
                (client.phone && client.phone.includes(inputValue)) ||
                // Address: simple substring match (no 초성 to avoid false positives)
                (client.address && client.address.toLowerCase().includes(inputValue.toLowerCase()))
        );
    }, [availableClients, inputValue]);

    const handleSelect = (client: Client) => {
        setInputValue(client.name);
        onChange(client.id, client);
        setIsOpen(false);
    };

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        setInputValue("");
        onChange(null, null);
        // Focus back to trigger for better UX
        setTimeout(() => triggerRef.current?.focus(), 0);
    };

    const handleManualEntry = () => {
        setIsOpen(false);
        // Save the typed name to the store so ClientFormDialog can prefill it
        setPrefillName(inputValue);
        // Use setTimeout to ensure dropdown is fully closed before opening dialog
        setTimeout(() => {
            if (onManualEntry) {
                onManualEntry();
            }
        }, 100);
    };

    return (
        <div data-component="clients-autocomplete" className="space-y-2">
            <Label className={cn(error && "text-destructive")}>
                {label}
                {required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>
                    <Button
                        ref={triggerRef}
                        variant="outline"
                        role="combobox"
                        aria-expanded={isOpen}
                        data-component="clients-autocomplete-input"
                        className={cn(
                            "w-full justify-between font-normal",
                            !selectedClient && "text-muted-foreground",
                            error && "border-destructive focus:ring-destructive"
                        )}
                    >
                        <span className="truncate">
                            {selectedClient
                                ? selectedClient.name
                                : t(locale, "contract-msg.client-search-placeholder")}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                            {isLoading && (
                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                            {selectedClient && !isLoading && (
                                <X
                                    className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-pointer"
                                    onClick={handleClear}
                                />
                            )}
                            <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                        </div>
                    </Button>
                </PopoverTrigger>
                <PopoverContent data-component="clients-autocomplete-dropdown" className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command shouldFilter={false}>
                        <CommandInput
                            placeholder={t(locale, "contract-msg.client-search-placeholder")}
                            value={inputValue}
                            onValueChange={setInputValue}
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
                                <CommandGroup>
                                    {filteredClients.map((client) => (
                                        <CommandItem
                                            key={client.id}
                                            value={client.id.toString()}
                                            onSelect={() => handleSelect(client)}
                                            className="flex flex-col items-start gap-1 py-2"
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
                                            <span className="text-xs text-muted-foreground ml-6">
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
                                <div
                                    className="flex flex-col w-full py-3 px-3 cursor-pointer hover:bg-accent transition-colors"
                                    onClick={handleManualEntry}
                                >
                                    <div className="flex items-center gap-2">
                                        <UserPlus className="h-4 w-4" />
                                        <span className="text-sm font-medium text-primary">
                                            {t(locale, "contract-msg.manual-entry")}
                                        </span>
                                    </div>
                                    <span className="text-xs text-muted-foreground mt-1">
                                        {t(locale, "contract-msg.manual-entry-description")}
                                    </span>
                                </div>
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
