"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useClients, useDeleteClient, useClient } from "@/app/hooks/useClients";
import { Client, SERVICE_STATUS_OPTIONS } from "@/app/lib/client/types";
import { ContentPaper } from "../root/content-paper";
import { ClientFormDialog } from "./ClientFormDialog";
import { ClientDetailModal } from "./ClientDetailModal";
import { useLocale } from "../LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import { DataTable, type DataTableColumn, type FilterOption } from "@/app/(components)/ui/datatable";
import { StatusBadge } from "@/app/(components)/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Filter options for service status (includes "전체" for all)
const STATUS_FILTER_OPTIONS: FilterOption[] = [
    { label: "전체", value: null, color: "default" },
    ...SERVICE_STATUS_OPTIONS.map(opt => ({
        label: opt.label,
        value: opt.value,
        color: opt.color,
    })),
];

// Map service status to StatusBadge variant
type ServiceStatusVariant = "waiting" | "in_progress" | "completed" | "cancelled" | "replacement_requested" | "default";

const getStatusBadge = (status: string | null) => {
    const option = SERVICE_STATUS_OPTIONS.find(o => o.value === status);
    if (!option) return <StatusBadge variant="default">-</StatusBadge>;

    const variantMap: Record<string, ServiceStatusVariant> = {
        pending: "waiting",
        waiting: "waiting",
        active: "in_progress",
        in_progress: "in_progress",
        completed: "completed",
        terminated: "cancelled",
        cancelled: "cancelled",
        replacement_requested: "replacement_requested",
    };

    return (
        <StatusBadge variant={variantMap[status || ""] || "default"}>
            {option.label}
        </StatusBadge>
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
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<string | null>(null);

    const { data, isLoading, error, isFetching } = useClients(
        page + 1,
        rowsPerPage,
        searchQuery.trim() ? searchQuery.trim() : undefined
    );
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
                <div className="flex justify-center items-center min-h-[400px]">
                    <Spinner className="h-8 w-8" />
                </div>
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
                <Alert variant="destructive">
                    <AlertDescription>{t(locale, "clients.load-error")}</AlertDescription>
                </Alert>
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
            render: (client) => getStatusBadge(client.serviceStatus),
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
            <div data-component="clients-table-container">
                <DataTable
                    data={tableData}
                    columns={columns}
                    isLoading={isFetching && !clients.length}
                    getRowKey={(client) => client.id}
                    pagination="server"
                    totalCount={total}
                    pageSize={rowsPerPage}
                    page={page}
                    onPageChange={handlePageChange}
                    onRowClick={(client) => handleRowClick(client)}
                    searchEnabled
                    searchFields={["name"]}
                    searchPlaceholder={searchPlaceholder}
                    searchQuery={searchQuery}
                    onSearch={setSearchQuery}
                    emptyMessage={t(locale, "clients.no-data")}
                    filterOptions={STATUS_FILTER_OPTIONS}
                    filterValue={statusFilter}
                    onFilterChange={handleFilterChange}
                    toolbarActions={
                        <Button
                            variant="ghost"
                            size="icon"
                            className="ml-auto text-accent hover:text-accent/80"
                            onClick={handleAddNew}
                            data-testid="add-client-button"
                        >
                            <Plus className="h-7 w-7" strokeWidth={2} />
                        </Button>
                    }
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
            </div>
        </ContentPaper>
    );
}
