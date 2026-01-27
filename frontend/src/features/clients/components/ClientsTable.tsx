"use client";

import { useState } from "react";
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
    TextField,
    InputAdornment,
} from "@mui/material";
import { Search, Plus } from "lucide-react";
import { useClients, useDeleteClient } from "../hooks/use-clients";
import { Client, SERVICE_STATUS_OPTIONS } from "../types";
import { ContentPaper } from "@/app/(components)/root/content-paper";
import { ClientFormDialog } from "./ClientFormDialog";
import { ClientDetailModal } from "./ClientDetailModal";
import { useLocale } from "@/core/providers";
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
    const [page, setPage] = useState(0);
    const [rowsPerPage] = useState(10);
    const [search, setSearch] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [editingClient, setEditingClient] = useState<Client | null>(null);

    const { data, isLoading, error, isFetching } = useClients(
        page + 1,
        rowsPerPage,
        search || undefined
    );
    const deleteClient = useDeleteClient();

    const handleChangePage = (_event: unknown, newPage: number) => {
        setPage(newPage);
    };

    const handleSearch = () => {
        setSearch(searchInput);
        setPage(0);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleSearch();
        }
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
            data-component="ClientsTable"
            title={t(locale, "clients.title")}
            subtitle={t(locale, "clients.subtitle")}
            sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
        >
            <Box data-component="clients-table-container">
                {/* Toolbar */}
                <Box
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        mb: 2,
                        gap: 2,
                    }}
                >
                    {/* Search */}
                    <TextField
                        size="small"
                        placeholder={t(locale, "clients.search-placeholder")}
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton size="small" onClick={handleSearch}>
                                        <Search size={20} />
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }}
                        sx={{ minWidth: 250 }}
                    />

                    {/* Add Button */}
                    <IconButton
                        color="primary"
                        onClick={handleAddNew}
                        sx={{
                            bgcolor: "primary.main",
                            color: "white",
                            "&:hover": { bgcolor: "primary.dark" }
                        }}
                    >
                        <Plus size={24} />
                    </IconButton>
                </Box>

                {/* Table */}
                <TableContainer data-component="clients-table-container">
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ fontWeight: 600 }}>{t(locale, "clients.table.name")}</TableCell>
                                <TableCell sx={{ fontWeight: 600 }}>{t(locale, "clients.table.status")}</TableCell>
                                <TableCell sx={{ fontWeight: 600 }}>{t(locale, "clients.table.start-date")}</TableCell>
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
                                        sx={{ cursor: "pointer" }}
                                    >
                                        <TableCell>{client.name}</TableCell>
                                        <TableCell>{getStatusChip(client.serviceStatus)}</TableCell>
                                        <TableCell sx={{ p: 0 }}>{formatDate(client.startDate)}</TableCell>
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
                    rowsPerPageOptions={[10]}
                    labelRowsPerPage=""
                />

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
