"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
    Box,
    IconButton,
    Chip,
    CircularProgress,
    Alert,
} from "@mui/material";
import { Plus } from "lucide-react";
import { useClients, useDeleteClient, useClient } from "@/app/hooks/useClients";
import { Client, SERVICE_STATUS_OPTIONS } from "@/app/lib/client/types";
import { ContentPaper } from "../root/content-paper";
import { ClientFormDialog } from "./ClientFormDialog";
import { ClientDetailModal } from "./ClientDetailModal";
import { useLocale } from "../LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import { DataTableToolbar } from "@/components/ui/datatable/DataTableToolbar";
import { useMemo } from "react";
import { matchesKoreanSearch } from "@/app/lib/utils/korean-search";

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
    const [rowsPerPage] = useState(8);
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [search, setSearch] = useState("");
    const [searchInput, setSearchInput] = useState("");

    const { data, isLoading, error, isFetching } = useClients(
        page + 1,
        rowsPerPage,
        search || undefined
    );

    const handleSearch = () => {
        setSearch(searchInput);
        setPage(0);
    };
    const deleteClient = useDeleteClient();

    const { data: clientFromParam } = useClient(clientIdParam ? Number(clientIdParam) : 0);

    useEffect(() => {
        if (clientIdParam && clientFromParam) {
            setSelectedClient(clientFromParam);
            setDetailModalOpen(true);
        }
    }, [clientIdParam, clientFromParam]);

    const handlePageChange = (newPage: number) => {
        setPage(newPage);
    };

    const handleFilterChange = (value: string | null) => {
        setStatusFilter(value);
        setPage(0);
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
    type ClientRow = Client & Record<string, unknown>;
    const tableData = clients as ClientRow[];
    const columns: DataTableColumn<ClientRow>[] = [
        {
            key: "name",
            header: t(locale, "clients.table.name"),
            align: "center",
            width: "30%",
        },
        {
            key: "serviceStatus",
            header: t(locale, "clients.table.status"),
            align: "center",
            width: "40%",
            render: (client) => getStatusChip(client.serviceStatus),
        },
        {
            key: "startDate",
            header: t(locale, "clients.table.start-date"),
            align: "center",
            width: "30%",
            render: (client) => formatDate(client.startDate),
        },
    ];
    const searchPlaceholder = t(locale, "clients.search-placeholder") || "이름 검색";

    return (
        <ContentPaper
            data-component="ClientsTable"
            title={t(locale, "clients.title")}
            subtitle={t(locale, "clients.subtitle")}
            sx={{ minHeight: "70vh", flexGrow: 1, width: "100%" }}
        >
            <Box data-component="clients-table-container">
                <DataTableToolbar
                    searchPlaceholder={t(locale, "clients.search-placeholder")}
                    searchValue={searchInput}
                    onSearchChange={setSearchInput}
                    onSearchSubmit={handleSearch}
                    onAddClick={handleAddNew}
                    dataComponent="clients-toolbar"
                    showSearchIconOnly={true}
                />

                <Divider />

                {/* Table */}
                <Box sx={{ minHeight: 200, width: "100%" }}>
                    <TableContainer data-component="clients-table-container-old">
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
