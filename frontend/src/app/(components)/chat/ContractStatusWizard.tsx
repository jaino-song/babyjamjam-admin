"use client";

import { useState, useCallback } from "react";
import {
    Box,
    Button,
    Typography,
    Stack,
} from "@mui/material";
import { Search } from "lucide-react";
import { ClientAutocomplete } from "../clients/ClientAutocomplete";
import type { Client, DocumentStatus } from "@/app/lib/client/types";

export interface ContractStatusResult {
    clientId: number;
    clientName: string;
    documentStatus: DocumentStatus;
    serviceStatus: string | null;
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

    const handleSubmit = useCallback(() => {
        if (!selectedClient) return;
        
        onCheck?.({
            clientId: selectedClient.id,
            clientName: selectedClient.name,
            documentStatus: selectedClient.documentStatus,
            serviceStatus: selectedClient.serviceStatus,
        });
    }, [selectedClient, onCheck]);

    return (
        <Box sx={{ display: "flex", flexDirection: "column" }}>
            <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                    계약서 상태 조회
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    계약서 상태를 확인할 산모를 선택해주세요.
                </Typography>
            </Box>

            <Stack spacing={2}>
                <ClientAutocomplete
                    value={selectedClientId}
                    onChange={handleClientChange}
                    label="산모 선택"
                    required
                />

                <Button
                    variant="contained"
                    startIcon={<Search size={18} />}
                    onClick={handleSubmit}
                    fullWidth
                    size="large"
                    disabled={!selectedClient}
                >
                    조회하기
                </Button>
            </Stack>
        </Box>
    );
}
