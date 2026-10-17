"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { ContractLinkConfirmDialog } from "@/components/app/clients/ContractLinkConfirmDialog";
import {
    allLinkConfirmationsQueryKey,
    describeLinkConfirmDifferences,
} from "@/components/app/clients/contract-link-confirm";
import { QueryErrorState } from "@/components/app/ui/QueryErrorState";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { Button } from "@/components/ui/button";
import { useActiveBranchId } from "@/features/system-templates/branch-context";
import { eformsignApi, type EformsignLinkConfirmation } from "@/services/api";

const COLLAPSED_ENTRY_COUNT = 5;
const BASE = "desktop_contracts_link-confirmations";

export function ContractLinkConfirmationsNotice() {
    const branchId = useActiveBranchId();
    const query = useQuery({
        queryKey: allLinkConfirmationsQueryKey(branchId),
        queryFn: () => eformsignApi.getLinkConfirmations(),
    });
    const [expanded, setExpanded] = useState(false);
    const [selectedEntry, setSelectedEntry] = useState<EformsignLinkConfirmation | null>(null);
    const entries = query.data;

    if (entries === undefined && !query.isError) return null;
    if (entries?.length === 0 && !query.isError) return null;

    return (
        <section data-component={BASE} data-slot="link-confirmations" className="shrink-0 space-y-2">
            {query.isError ? (
                <QueryErrorState
                    dataComponent={`${BASE}_error`}
                    size="inline"
                    title={entries === undefined
                        ? "연결 확인이 필요한 계약서를 불러오지 못했습니다"
                        : "최신 정보를 불러오지 못했습니다"}
                    isRetrying={query.isFetching}
                    onRetry={() => void query.refetch()}
                />
            ) : null}
            {entries && entries.length > 0 ? (
                <>
                    <h2
                        data-component={`${BASE}_heading`}
                        data-slot="heading"
                        className="text-sm font-semibold text-v3-dark"
                    >
                        연결 확인이 필요한 계약서 {entries.length}건
                    </h2>
                    <ul
                        data-component={`${BASE}_entries`}
                        data-slot="entries"
                        className="max-h-[200px] space-y-1 overflow-y-auto"
                    >
                        {(expanded ? entries : entries.slice(0, COLLAPSED_ENTRY_COUNT)).map((entry) => (
                            <li
                                key={entry.documentId}
                                data-component={`${BASE}_entries_row`}
                                data-slot="entry"
                                className="flex items-center gap-2 text-sm"
                            >
                                <StatusBadge data-component={`${BASE}_entries_row_badge`} variant="warning">
                                    연결 확인 필요
                                </StatusBadge>
                                <span
                                    data-component={`${BASE}_entries_row_document`}
                                    data-slot="document-name"
                                    className="min-w-0 truncate"
                                >
                                    {entry.documentName || "계약서"}
                                </span>
                                <span
                                    data-component={`${BASE}_entries_row_client`}
                                    data-slot="client-name"
                                    className="shrink-0"
                                >
                                    {entry.client.name}
                                </span>
                                <span
                                    data-component={`${BASE}_entries_row_differences`}
                                    data-slot="differences"
                                    className="min-w-0 truncate text-v3-text-muted"
                                >
                                    {describeLinkConfirmDifferences(entry.differences)}
                                </span>
                                {entry.canConfirm ? (
                                    <Button
                                        type="button"
                                        variant="neutral"
                                        size="sm"
                                        data-component={`${BASE}_entries_row_confirm`}
                                        className="shrink-0"
                                        onClick={() => setSelectedEntry(entry)}
                                    >
                                        확인
                                    </Button>
                                ) : (
                                    <span
                                        data-component={`${BASE}_entries_row_manager-only`}
                                        data-slot="manager-only"
                                        className="min-w-0 truncate text-v3-text-muted"
                                    >
                                        지점 관리자만 연결을 확정할 수 있습니다
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                    {entries.length > COLLAPSED_ENTRY_COUNT ? (
                        <Button
                            type="button"
                            variant="neutral"
                            size="sm"
                            data-component={`${BASE}_toggle`}
                            aria-expanded={expanded}
                            onClick={() => setExpanded((value) => !value)}
                        >
                            {expanded ? "접기" : `${entries.length - COLLAPSED_ENTRY_COUNT}건 더 보기`}
                        </Button>
                    ) : null}
                </>
            ) : null}
            {selectedEntry ? (
                <ContractLinkConfirmDialog
                    entry={selectedEntry}
                    clientId={selectedEntry.client.id}
                    dataComponentPrefix="desktop_contracts"
                    onClose={() => setSelectedEntry(null)}
                />
            ) : null}
        </section>
    );
}
