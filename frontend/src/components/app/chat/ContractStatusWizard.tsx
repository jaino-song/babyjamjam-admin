"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
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

    // The contract document the summary was derived from. While it is loading, failed or absent the
    // result falls back to the summary's own wording, so the wizard never waits on it.
    const contractDocumentId = selectedClient?.latestContractDocumentId ?? selectedClient?.eDocId ?? null;
    const { data: contractDocument } = useQuery<EformsignDocument>({
        queryKey: ["eformsign-docs", "document", contractDocumentId],
        queryFn: async () => {
            if (!contractDocumentId) throw new Error("documentId is required");
            return eformsignApi.getDocument(contractDocumentId);
        },
        enabled: Boolean(contractDocumentId),
        staleTime: 1000 * 60,
        retry: 1,
    });

    const handleSubmit = useCallback(() => {
        if (!selectedClient) return;

        onCheck?.({
            clientId: selectedClient.id,
            clientName: selectedClient.name,
            documentStatus: selectedClient.documentStatus,
            serviceStatus: selectedClient.serviceStatus,
            hasSigned: selectedClient.hasSigned,
            rejectedByReviewer: isRejectedContractDocument(contractDocument),
        });
    }, [selectedClient, contractDocument, onCheck]);

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

                <Button
                    onClick={handleSubmit}
                    className="w-full"
                    size="lg"
                    disabled={!selectedClient}
                >
                    <Search className="w-4 h-4 mr-2" />
                    조회하기
                </Button>
            </div>
        </div>
    );
}
