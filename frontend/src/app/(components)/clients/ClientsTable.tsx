"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useClients, useDeleteClient, useClient } from "@/app/hooks/useClients";
import { Client, SERVICE_STATUS_OPTIONS } from "@/app/lib/client/types";
import { ClientFormDialog } from "./ClientFormDialog";
import { ClientDetailModal } from "./ClientDetailModal";
import { useLocale } from "../LocaleProvider";
import { t } from "@/app/lib/i18n/translations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContentPaper } from "../root/content-paper";
import { DataTable, type DataTableColumn, type FilterOption } from "../ui/datatable";
import { cn } from "@/lib/utils";

// Filter options for status dropdown - converted to DataTable FilterOption format
const STATUS_FILTER_OPTIONS: FilterOption[] = [
    { value: null, label: "전체", color: "default" },
    { value: "active", label: "진행중", color: "success" },
    { value: "pending", label: "대기", color: "warning" },
    { value: "completed", label: "완료", color: "info" },
    { value: "terminated", label: "종료", color: "default" },
];

// Status styles matching reference design
type ServiceStatus = "active" | "pending" | "completed" | "terminated" | "replacement_requested" | "inactive";

const statusStyles: Record<ServiceStatus, string> = {
    active: "bg-success/10 text-success border-success/20",
    pending: "bg-warning/10 text-warning border-warning/20",
    completed: "bg-info/10 text-info border-info/20",
    terminated: "bg-muted text-muted-foreground border-muted",
    replacement_requested: "bg-destructive/10 text-destructive border-destructive/20",
    inactive: "bg-muted text-muted-foreground border-muted",
};

const getStatusBadge = (status: string | null) => {
    const option = SERVICE_STATUS_OPTIONS.find(o => o.value === status);
    if (!option) {
        return (
            <Badge variant="outline" className="bg-muted text-muted-foreground border-muted">
                -
            </Badge>
        );
    }

    const normalizedStatus = (status || "inactive") as ServiceStatus;
    const styleClass = statusStyles[normalizedStatus] || statusStyles.inactive;

    return (
        <Badge variant="outline" className={cn(styleClass)}>
            {option.label}
        </Badge>
    );
};

const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("ko-KR");
};

// Define row type for DataTable
type ClientRow = Client & Record<string, unknown>;

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

    const { data, isLoading, error } = useClients(
        page + 1,
        rowsPerPage,
        searchQuery.trim() ? searchQuery.trim() : undefined
    );
    const deleteClient = useDeleteClient();

    const { data: clientFromParam } = useClient(clientIdParam ? Number(clientIdParam) : 0);

    // Open detail modal when client ID is in URL params
    useEffect(() => {
        if (clientIdParam && clientFromParam) {
            setSelectedClient(clientFromParam);
            setDetailModalOpen(true);
        }
    }, [clientIdParam, clientFromParam]);

    const handleAddNew = () => {
        setEditingClient(null);
        setFormDialogOpen(true);
    };

    const handleRowClick = (client: ClientRow) => {
        setSelectedClient(client as Client);
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

    const handleSearchChange = (query: string) => {
        setSearchQuery(query);
        setPage(0);
    };

    const handleFilterChange = (value: string | null) => {
        setStatusFilter(value);
        setPage(0);
    };

    const handlePageChange = (newPage: number) => {
        setPage(newPage);
    };

    // Filter clients by status (client-side filtering on server-fetched data)
    const clients = data?.data || [];
    const filteredClients = useMemo(() => {
        if (!statusFilter) return clients;
        return clients.filter((client) => client.serviceStatus === statusFilter);
    }, [clients, statusFilter]);

    const total = data?.total || 0;

    // Define columns for DataTable
    const columns: DataTableColumn<ClientRow>[] = [
        {
            key: "name",
            header: t(locale, "clients.table.name"),
            align: "center",
        },
        {
            key: "serviceStatus",
            header: t(locale, "clients.table.status"),
            align: "center",
            render: (row) => getStatusBadge(row.serviceStatus as string | null),
        },
        {
            key: "startDate",
            header: t(locale, "clients.table.start-date"),
            align: "center",
            render: (row) => formatDate(row.startDate as string | null),
        },
    ];

    // Toolbar action button
    const toolbarActions = (
        <Button
            className="gap-2 w-[100px]"
            onClick={handleAddNew}
            data-testid="add-client-button"
        >
            <Plus className="h-4 w-4" />
            {t(locale, "clients.add")}
        </Button>
    );

    return (
        <ContentPaper
            title={t(locale, "clients.title")}
            subtitle={t(locale, "clients.subtitle")}
            className="min-h-[70vh] flex-grow w-full"
        >
            <div data-component="clients-table-container">
                <DataTable<ClientRow>
                    data={filteredClients as ClientRow[]}
                    columns={columns}
                    isLoading={isLoading}
                    error={error instanceof Error ? error : null}
                    getRowKey={(row) => String(row.id)}
                    searchEnabled
                    searchPlaceholder={t(locale, "clients.search-placeholder")}
                    searchQuery={searchQuery}
                    onSearch={handleSearchChange}
                    filterOptions={STATUS_FILTER_OPTIONS}
                    filterValue={statusFilter}
                    onFilterChange={handleFilterChange}
                    pagination="server"
                    totalCount={total}
                    pageSize={rowsPerPage}
                    page={page}
                    onPageChange={handlePageChange}
                    onRowClick={handleRowClick}
                    toolbarActions={toolbarActions}
                    emptyMessage={t(locale, "clients.no-data")}
                />
            </div>

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
        </ContentPaper>
    );
}
