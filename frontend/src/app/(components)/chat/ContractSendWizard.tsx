"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
    Box,
    Button,
    Typography,
    Stack,
    Chip,
} from "@mui/material";
import { FileCheck, Send } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ClientAutocomplete } from "../clients/ClientAutocomplete";
import { useFormStore } from "@/app/store/form-store";
import type { Client } from "@/app/lib/client/types";

function formatDueDate(dateStr: string | null): string {
    if (!dateStr) return "";
    try {
        const date = parseISO(dateStr);
        return format(date, "yyyy년 MM월 dd일");
    } catch {
        return dateStr;
    }
}

interface ContractSendWizardProps {
    onComplete?: () => void;
}

export default function ContractSendWizard({ onComplete }: ContractSendWizardProps) {
    const router = useRouter();
    const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);

    const {
        setClientId,
        setName,
        setPhone,
        setBirthday,
        setAddress,
        setDueDate,
        setIsManualEntry,
    } = useFormStore();

    const handleClientChange = useCallback((clientId: number | null, client: Client | null) => {
        setSelectedClientId(clientId);
        setSelectedClient(client);
    }, []);

    const handleSendContract = useCallback(() => {
        if (!selectedClient) return;

        setClientId(selectedClient.id);
        setName(selectedClient.name);
        setPhone(selectedClient.phone || "");
        setBirthday(selectedClient.birthday || "");
        setAddress(selectedClient.address || "");
        setDueDate(selectedClient.dueDate || "");
        setIsManualEntry(false);

        router.push("/messages");
        onComplete?.();
    }, [selectedClient, setClientId, setName, setPhone, setBirthday, setAddress, setDueDate, setIsManualEntry, router, onComplete]);

    return (
        <Box sx={{ minHeight: 300, display: "flex", flexDirection: "column" }}>
            <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                    계약서 전송
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    계약서를 보낼 산모를 선택해주세요.
                </Typography>
            </Box>

            <Stack spacing={3} sx={{ flex: 1 }}>
                <ClientAutocomplete
                    value={selectedClientId}
                    onChange={handleClientChange}
                    label="산모 선택"
                    required
                />

                <Box>
                    <Stack spacing={1.5} sx={{ pl: 2, borderLeft: 3, borderColor: selectedClient ? "primary.main" : "grey.300", mb: 3 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minHeight: 24 }}>
                            {selectedClient && (
                                <>
                                    <Typography variant="body1" fontWeight={600}>
                                        {selectedClient.name}
                                    </Typography>
                                    {selectedClient.hasSigned && (
                                        <Chip
                                            icon={<FileCheck size={14} />}
                                            label="계약 완료"
                                            size="small"
                                            color="success"
                                            variant="outlined"
                                            sx={{ height: 20, fontSize: "0.7rem" }}
                                        />
                                    )}
                                </>
                            )}
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                            <strong>연락처:</strong> {selectedClient?.phone || ""}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            <strong>주소:</strong> {selectedClient?.address || ""}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            <strong>출산예정일:</strong> {formatDueDate(selectedClient?.dueDate ?? null)}
                        </Typography>
                    </Stack>

                    <Button
                        variant="contained"
                        startIcon={<Send size={18} />}
                        onClick={handleSendContract}
                        fullWidth
                        size="large"
                        disabled={!selectedClient}
                    >
                        계약서 전송하러 가기
                    </Button>
                </Box>
            </Stack>
        </Box>
    );
}
