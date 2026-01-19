"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TablePagination,
    IconButton,
    Chip,
    CircularProgress,
    Alert,
    Divider,
} from "@mui/material";
import { Search, Plus } from "lucide-react";
import { useClients, useDeleteClient, useClient } from "@/app/hooks/useClients";
import { Client, SERVICE_STATUS_OPTIONS } from "@/app/lib/client/types";
import { ContentPaper } from "../root/ContentPaper";
import { ClientFormDialog } from "./ClientFormDialog";
import { ClientDetailModal } from "./ClientDetailModal";
import { useLocale } from "../LocaleProvider";
import { t } from "@/app/lib/i18n/translations";

const getStatusChip = (status: string | null) => {
    const option = SERVICE_STATUS_OPTIONS.find(o => o.value === status);
    if (!option) return <Chip label="-" size="small" variant="outlined" />;

    return (
        <Chip
            label={option.label}
            color={option.color}
            size="small"
        />
    );
};

const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("ko-KR");
};

export function ClientsTable() {
    const locale = useLocale();
    const router = useRouter();
    const searchParams = useSearchParams();
    const clientIdParam = searchParams.get("id");

    const [page, setPage] = useState(0);
    const [rowsPerPage] = useState(10);
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [editingClient, setEditingClient] = useState<Client | null>(null);

    const { data, isLoading, error, isFetching } = useClients(
        page + 1,
        rowsPerPage,
        undefined
    );
    const deleteClient = useDeleteClient();

    const { data: clientFromParam } = useClient(clientIdParam ? Number(clientIdParam) : 0);

    useEffect(() => {
        if (clientIdParam && clientFromParam) {
            setSelectedClient(clientFromParam);
            setDetailModalOpen(true);
        }
    }, [clientIdParam, clientFromParam]);

    const handleChangePage = (_event: unknown, newPage: number) => {
        setPage(newPage);
    };

    const handleAddNew = () => {
        setEditingClient(null);
        setFormDialogOpen(true);
    };

    const handleRowClick = (client: Client) => {
        setSelectedClient(client);
        setDetailModalOpen(true);
    };

    const handleEdit = (client: Client) => {
        setEditingClient(client);
        setFormDialogOpen(true);
    };

    const handleDelete = async (id: number) => {
        if (window.confirm(t(locale, "clients.delete-confirm"))) {
            try {
                await deleteClient.mutateAsync(id);
            } catch (err) {
                console.error("Failed to delete client:", err);
            }
        }
    };

    const handleFormDialogClose = () => {
        setFormDialogOpen(false);
        setEditingClient(null);
    };

    const handleDetailModalClose = () => {
        setDetailModalOpen(false);
        setSelectedClient(null);
        if (clientIdParam) {
            router.replace("/clients");
        }
    };

    if (isLoading) {
        return (
            <ContentPaper
                title={t(locale, "clients.title")}
                subtitle={t(locale, "clients.subtitle")}
                sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
            >
                <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                    <CircularProgress />
                </Box>
            </ContentPaper>
        );
    }

    if (error) {
        return (
            <ContentPaper
                title={t(locale, "clients.title")}
                subtitle={t(locale, "clients.subtitle")}
                sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
            >
                <Alert severity="error">{t(locale, "clients.load-error")}</Alert>
            </ContentPaper>
        );
    }

    const clients = data?.data || [];
    const total = data?.total || 0;

    return (
        <ContentPaper
            title={t(locale, "clients.title")}
            subtitle={t(locale, "clients.subtitle")}
            sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
        >
            <Box data-component="clients-table-container">
                {/* Toolbar */}
                <Box
                    data-component="clients-toolbar"
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-around",
                    }}
                >
                    <Box
                        data-component="clients-toolbar-buttons"
                        sx={{
                            display: "flex",
                            justifyContent: "space-around",
                            alignItems: "center",
                            gap: 1,
                            width: "100%"
                        }}
                    >
                        {/* Search Button */}
                        <IconButton size="medium" sx={{ color: "grey.600" }}>
                            <Search size={24} strokeWidth={2} />
                        </IconButton>

                        {/* Spacer */}
                        <Box sx={{ flex: 1 }} />

                        {/* Add Button */}
                        <IconButton
                            size="medium"
                            sx={{ color: "#1e88e5" }}
                            onClick={handleAddNew}
                            data-testid="add-client-button"
                        >
                            <Plus size={30} strokeWidth={2} />
                        </IconButton>
                    </Box>
                </Box>

                <Divider />

                {/* Table */}
                <Box sx={{ minHeight: 200, width: "100%" }}>
                    <TableContainer>
                        <Table sx={{ tableLayout: "fixed", width: "100%" }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell
                                        align="center"
                                        sx={{
                                            fontWeight: 500,
                                            color: "rgba(0, 0, 0, 0.6)",
                                            fontSize: "0.875rem",
                                            width: "30%",
                                        }}
                                    >
                                        {t(locale, "clients.table.name")}
                                    </TableCell>
                                    <TableCell
                                        align="center"
                                        sx={{
                                            fontWeight: 500,
                                            color: "rgba(0, 0, 0, 0.6)",
                                            fontSize: "0.875rem",
                                            width: "40%",
                                        }}
                                    >
                                        {t(locale, "clients.table.status")}
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
                                        {t(locale, "clients.table.start-date")}
                                    </TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {isFetching && !clients.length ? (
                                    <TableRow>
                                        <TableCell colSpan={3} align="center" sx={{ py: 4 }}>
                                            <CircularProgress size={30} />
                                        </TableCell>
                                    </TableRow>
                                ) : clients.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={3} align="center" sx={{ py: 4 }}>
                                            {t(locale, "clients.no-data")}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    clients.map((client) => (
                                        <TableRow
                                            key={client.id}
                                            hover
                                            onClick={() => handleRowClick(client)}
                                            sx={{ cursor: "pointer", "&:hover": { bgcolor: "rgba(0, 0, 0, 0.04)" } }}
                                        >
                                            <TableCell
                                                align="center"
                                                sx={{ fontSize: "0.875rem", color: "rgba(0, 0, 0, 0.87)", px: 1 }}
                                            >
                                                {client.name}
                                            </TableCell>
                                            <TableCell align="center" sx={{ px: 1 }}>
                                                {getStatusChip(client.serviceStatus)}
                                            </TableCell>
                                            <TableCell
                                                align="center"
                                                sx={{ fontSize: "0.875rem", color: "rgba(0, 0, 0, 0.87)", px: 1 }}
                                            >
                                                {formatDate(client.startDate)}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>

                    {/* Pagination */}
                    <TablePagination
                        component="div"
                        count={total}
                        page={page}
                        onPageChange={handleChangePage}
                        rowsPerPage={rowsPerPage}
                        rowsPerPageOptions={[]}
                        labelRowsPerPage=""
                        sx={{
                            "& .MuiTablePagination-selectLabel": { display: "none" },
                            "& .MuiTablePagination-select": { display: "none" },
                            "& .MuiTablePagination-spacer": { display: "none" },
                            "& .MuiTablePagination-displayedRows": { margin: 0 },
                        }}
                    />
                </Box>

                {/* Detail Modal */}
                <ClientDetailModal
                    open={detailModalOpen}
                    onClose={handleDetailModalClose}
                    client={selectedClient}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                />

                {/* Form Dialog */}
                <ClientFormDialog
                    open={formDialogOpen}
                    onClose={handleFormDialogClose}
                    client={editingClient}
                />
            </Box>
        </ContentPaper>
    );
}
