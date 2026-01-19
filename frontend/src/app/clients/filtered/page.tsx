"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    IconButton,
    Chip,
    CircularProgress,
    Alert,
    Typography,
} from "@mui/material";
import { X } from "lucide-react";
import { useFilteredClients, useDeleteClient } from "@/app/hooks/useClients";
import { Client, DocumentStatus } from "@/app/lib/client/types";
import { ClientDetailModal } from "../../(components)/clients/ClientDetailModal";
import { ClientFormDialog } from "../../(components)/clients/ClientFormDialog";

type FilterType = "starting-soon" | "ending-soon" | "incomplete-contracts" | "no-contract";

const FILTER_CONFIG: Record<FilterType, { title: string }> = {
    "starting-soon": { title: "7일 내 서비스 시작 예정" },
    "ending-soon": { title: "7일 내 서비스 종료 예정" },
    "incomplete-contracts": { title: "계약서 미완료" },
    "no-contract": { title: "계약서 미발송" },
};

const getDocumentStatusChip = (status: DocumentStatus) => {
    switch (status) {
        case "completed":
            return <Chip label="완료" size="small" color="success" />;
        case "opened":
        case "requested":
            return <Chip label="진행중" size="small" color="warning" />;
        case "created":
            return <Chip label="생성됨" size="small" color="info" />;
        default:
            return <Chip label="미발송" size="small" variant="outlined" />;
    }
};

const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("ko-KR");
};

export default function FilteredClientsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const filter = searchParams.get("filter") as FilterType | null;

    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [formDialogOpen, setFormDialogOpen] = useState(false);

    const { data: clients, isLoading, error } = useFilteredClients(filter || "");
    const deleteClient = useDeleteClient();

    const filterConfig = filter ? FILTER_CONFIG[filter] : null;

    const handleClose = () => router.push("/");

    const handleRowClick = (client: Client) => {
        setSelectedClient(client);
        setDetailModalOpen(true);
    };

    const handleEdit = (client: Client) => {
        setEditingClient(client);
        setFormDialogOpen(true);
        setDetailModalOpen(false);
    };

    const handleDelete = async (id: number) => {
        if (window.confirm("정말 삭제하시겠습니까?")) {
            try {
                await deleteClient.mutateAsync(id);
                setDetailModalOpen(false);
            } catch (err) {
                console.error("Failed to delete client:", err);
            }
        }
    };

    if (!filter || !filterConfig) {
        return (
            <Box sx={{ p: 3 }}>
                <Alert severity="error">잘못된 필터입니다</Alert>
            </Box>
        );
    }

    return (
        <Box sx={{ bgcolor: "background.paper", minHeight: "100vh" }}>
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    px: 2,
                    py: 1.5,
                    borderBottom: "1px solid",
                    borderColor: "divider",
                }}
            >
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    {filterConfig.title}
                </Typography>
                <IconButton onClick={handleClose} size="small">
                    <X size={24} />
                </IconButton>
            </Box>

            <Box sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
                {isLoading ? (
                    <Box display="flex" justifyContent="center" py={8}>
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Alert severity="error">데이터를 불러오는데 실패했습니다</Alert>
                ) : !clients?.length ? (
                    <Alert severity="info">해당하는 클라이언트가 없습니다</Alert>
                ) : (
                    <TableContainer>
                        <Table sx={{ tableLayout: "fixed" }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell
                                        align="center"
                                        sx={{
                                            fontWeight: 500,
                                            color: "rgba(0, 0, 0, 0.6)",
                                            fontSize: "0.875rem",
                                            width: "40%",
                                        }}
                                    >
                                        이름
                                    </TableCell>
                                    <TableCell
                                        align="center"
                                        sx={{
                                            fontWeight: 500,
                                            color: "rgba(0, 0, 0, 0.6)",
                                            fontSize: "0.875rem",
                                            width: "30%",
                                        }}
                                    >
                                        시작일
                                    </TableCell>
                                    <TableCell
                                        align="center"
                                        sx={{
                                            fontWeight: 500,
                                            color: "rgba(0, 0, 0, 0.6)",
                                            fontSize: "0.875rem",
                                            width: "30%",
                                        }}
                                    >
                                        계약서
                                    </TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {clients.map((client) => (
                                    <TableRow
                                        key={client.id}
                                        hover
                                        onClick={() => handleRowClick(client)}
                                        sx={{
                                            cursor: "pointer",
                                            "&:hover": { bgcolor: "rgba(0, 0, 0, 0.04)" },
                                        }}
                                    >
                                        <TableCell
                                            align="center"
                                            sx={{ fontSize: "0.875rem", color: "rgba(0, 0, 0, 0.87)", px: 1 }}
                                        >
                                            {client.name}
                                        </TableCell>
                                        <TableCell
                                            align="center"
                                            sx={{ fontSize: "0.875rem", color: "rgba(0, 0, 0, 0.87)", px: 1 }}
                                        >
                                            {formatDate(client.startDate)}
                                        </TableCell>
                                        <TableCell align="center" sx={{ px: 1 }}>
                                            {getDocumentStatusChip(client.documentStatus)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Box>

            <ClientDetailModal
                open={detailModalOpen}
                onClose={() => setDetailModalOpen(false)}
                client={selectedClient}
                onEdit={handleEdit}
                onDelete={handleDelete}
            />

            <ClientFormDialog
                open={formDialogOpen}
                onClose={() => {
                    setFormDialogOpen(false);
                    setEditingClient(null);
                }}
                client={editingClient}
            />
        </Box>
    );
}
