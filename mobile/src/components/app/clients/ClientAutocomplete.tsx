"use client";

import { useMemo } from "react";
import { UserPlus, FileCheck } from "lucide-react";
import { normalizeApiError } from "@babyjamjam/shared";

import { useAllClients } from "@/hooks/useClients";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import type { Client } from "@/lib/client/types";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import { matchesKoreanSearch } from "@/lib/search/korean-search";

import { Autocomplete } from "@/components/app/ui/Autocomplete";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { ErrorFallback } from "@/components/app/ui/error-fallback";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface ClientAutocompleteProps {
    "data-component": string;
    inputId?: string;
    value: number | null;
    onChange: (clientId: number | null, client: Client | null) => void;
    inputValue?: string;
    onInputValueChange?: (value: string) => void;
    placeholder?: string;
    label: string;
    required?: boolean;
    error?: boolean;
    helperText?: string;
    excludeIds?: number[];
    allowManualEntry?: boolean;
    manualEntryLabel?: string;
    manualEntryDescription?: string;
    onManualEntry?: (query: string) => void;
}

export function ClientAutocomplete({
    "data-component": dataComponent,
    inputId,
    value,
    onChange,
    inputValue,
    onInputValueChange,
    placeholder,
    label,
    required = false,
    error = false,
    helperText,
    excludeIds = [],
    allowManualEntry = false,
    manualEntryLabel,
    manualEntryDescription,
    onManualEntry,
}: ClientAutocompleteProps) {
    const locale = useLocale();
    const {
        data: clients,
        isLoading,
        isError,
        error: clientsError,
        refetch,
        isFetching,
    } = useAllClients();
    const setPrefillName = useClientDialogStore((state) => state.setPrefillName);
    const hasData = clients !== undefined;
    const normalizedError = clientsError
        ? normalizeApiError(clientsError, { operation: "read", locale: "ko-KR" })
        : null;
    const showError = isError && Boolean(normalizedError) && !normalizedError?.suppress;
    const showInitialError = showError && !hasData;
    const showRefreshError = showError && hasData;

    const availableClients = useMemo(() => {
        if (!clients) return [];
        return clients.filter((c) => !excludeIds.includes(c.id));
    }, [clients, excludeIds]);

    const selectedClient = useMemo(() => {
        if (value === null || value === undefined || !clients) return null;
        return clients.find((c) => c.id === value) || null;
    }, [value, clients]);

    if (showInitialError) {
        return (
            <ErrorFallback
                title="고객 목록을 불러오지 못했어요"
                description={normalizedError?.message ?? "요청한 정보를 불러오지 못했어요."}
                onReset={() => void refetch()}
                className="min-h-0 px-4 py-8"
            />
        );
    }

    return (
        <>
            {showRefreshError ? (
                <Alert
                    variant="warning"
                    role="status"
                    aria-live="polite"
                    data-component={`${dataComponent}_refresh-error`}
                >
                    <AlertTitle>고객 목록을 새로 불러오지 못했어요</AlertTitle>
                    <AlertDescription>
                        <p>{normalizedError?.message}</p>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={() => void refetch()}
                            disabled={isFetching}
                        >
                            다시 시도
                        </Button>
                    </AlertDescription>
                </Alert>
            ) : null}
            <Autocomplete<Client>
                data-component={dataComponent}
                name="clients"
                inputId={inputId}
                value={selectedClient}
                onChange={(c) => onChange(c?.id ?? null, c)}
                inputValue={inputValue}
                onInputValueChange={onInputValueChange}
                items={availableClients}
                isLoading={isLoading || Boolean(normalizedError?.suppress && !hasData)}
                getItemKey={(c) => c.id}
                getItemLabel={(c) => c.name}
                getItemMeta={(c) =>
                    `${c.phone || "-"}${c.address ? ` · ${c.address}` : ""}`
                }
                getItemHeaderExtra={(c) =>
                    c.hasSigned ? (
                        <StatusBadge
                            variant="doc_completed"
                            className="text-xs py-0 h-5"
                        >
                            <FileCheck className="h-3 w-3 mr-1" />
                            {t(locale, "contract-msg.client-signed")}
                        </StatusBadge>
                    ) : null
                }
                filter={(c, q) =>
                    matchesKoreanSearch(c.name, q) ||
                    (c.phone ? c.phone.includes(q) : false) ||
                    (c.address
                        ? c.address.toLowerCase().includes(q.toLowerCase())
                        : false)
                }
                placeholder={placeholder ?? t(locale, "contract-msg.client-search-placeholder")}
                label={label}
                required={required}
                error={error}
                helperText={helperText}
                emptyMessage={t(locale, "contract-msg.no-client-found")}
                manualEntry={
                    allowManualEntry
                        ? {
                              label: manualEntryLabel ?? t(locale, "contract-msg.manual-entry"),
                              description: manualEntryDescription ?? t(locale, "contract-msg.manual-entry-description"),
                              icon: <UserPlus className="h-4 w-4" />,
                              onSelect: (query) => {
                                  setPrefillName(query);
                                  onManualEntry?.(query);
                              },
                          }
                        : undefined
                }
            />
        </>
    );
}
