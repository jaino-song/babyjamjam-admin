"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { QueryErrorState } from "@/components/app/ui/QueryErrorState";
import { ClientAutocomplete } from "../clients/ClientAutocomplete";
import { eformsignApi } from "@/services/api";
import type { Client, DocumentStatus } from "@/lib/client/types";
import type { EformsignDocument } from "@/lib/eformsign/types";
import { isRejectedContractDocument } from "./contract-status-label";

export interface ContractStatusResult {
    clientId: number;
    clientName: string;
    documentStatus: DocumentStatus;
    serviceStatus: string | null;
    /** Step-aware signed flag from the selected client; documentStatus alone cannot tell 060 from 070. */
    hasSigned: boolean;
    /** True when the client's contract document is rejected by the provider's reviewer (071); the summary above cannot say so. */
    rejectedByReviewer: boolean;
}

interface ContractStatusWizardProps {
    onCheck?: (result: ContractStatusResult) => void;
}

export default function ContractStatusWizard({ onCheck }: ContractStatusWizardProps) {
    const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);

    const handleClientChange = useCallback((clientId: number | null, client: Client | null) => {
        setSelectedClientId(clientId);
        setSelectedClient(client);
    }, []);

    // 문서가 있으면 조회 성공 전에는 답하지 않는다. 실패한 refetch는 캐시를 남기므로
    // 데이터 존재 여부가 아니라 query의 success 상태로 판단한다.
    const contractDocumentId = selectedClient?.latestContractDocumentId ?? selectedClient?.eDocId ?? null;
    const { data: contractDocument, isSuccess: contractDocumentLoaded, isError, isFetching, refetch } = useQuery<EformsignDocument>({
        queryKey: ["eformsign-docs", "document", contractDocumentId],
        queryFn: async () => {
            if (!contractDocumentId) throw new Error("documentId is required");
            return eformsignApi.getDocument(contractDocumentId);
        },
        enabled: Boolean(contractDocumentId),
        staleTime: 1000 * 60,
    });
    const documentUnresolved = Boolean(contractDocumentId) && !contractDocumentLoaded;
    const documentLoading = documentUnresolved && isFetching;

    const handleSubmit = useCallback(() => {
        if (!selectedClient || documentUnresolved) return;

        onCheck?.({
            clientId: selectedClient.id,
            clientName: selectedClient.name,
            documentStatus: selectedClient.documentStatus,
            serviceStatus: selectedClient.serviceStatus,
            hasSigned: selectedClient.hasSigned,
            rejectedByReviewer: contractDocumentLoaded && isRejectedContractDocument(contractDocument),
        });
    }, [selectedClient, contractDocument, contractDocumentLoaded, documentUnresolved, onCheck]);

    return (
        <div data-component="desktop_chat_page_wizard-contract-status" className="flex flex-col">
            <div className="mb-4">
                <h3 className="text-base font-bold mb-1">
                    계약서 상태 조회
                </h3>
                <p className="text-sm text-muted-foreground">
                    계약서 상태를 확인할 산모를 선택해주세요.
                </p>
            </div>

            <div data-component="desktop_chat_page_wizard-contract-status_body" className="flex flex-col gap-4">
                <ClientAutocomplete
                  data-component="desktop_chat_page_wizard-contract-status_body_client-autocomplete"
                    value={selectedClientId}
                    onChange={handleClientChange}
                    label="산모 선택"
                    required
                />

                {contractDocumentId && isError ? (
                    <QueryErrorState
                        dataComponent="desktop_chat_page_wizard-contract-status_body_document-error"
                        size="inline"
                        isRetrying={isFetching}
                        onRetry={() => { void refetch(); }}
                    />
                ) : null}

                <Button
                    data-component="desktop_chat_page_wizard-contract-status_body_submit"
                    onClick={handleSubmit}
                    className="w-full"
                    size="lg"
                    disabled={!selectedClient || documentUnresolved}
                    aria-busy={documentLoading}
                >
                    {documentLoading ? (
                        <Spinner data-component="desktop_chat_page_wizard-contract-status_body_submit_spinner" size="sm" aria-hidden="true" />
                    ) : (
                        <Search className="w-4 h-4 mr-2" />
                    )}
                    조회하기
                </Button>
            </div>
        </div>
    );
}
