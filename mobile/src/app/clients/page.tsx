"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Users, Plus, Phone, MessageSquare, FileText, ClipboardList, Clock, UserCheck, AlertTriangle } from "lucide-react";
import { useClients, useDeleteClient, useClient } from "@/hooks/useClients";
import { Client, SERVICE_STATUS_OPTIONS } from "@/lib/client/types";
import { ClientFormDialog } from "@/components/app/clients/ClientFormDialog";
import { ClientDetailModal } from "@/components/app/clients/ClientDetailModal";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
    PageHeader,
    StatsBar,
    SplitLayout,
    ListPanel,
    DetailPanel,
    InfoCard,
    InfoRow,
    StatusBadge,
    AnimatedSlotList,
    HeaderActionButton,
    EmptyState,
    ListEmptyState,
    DetailTabs,
} from "@/components/app/v3";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import type { StatusType } from "@/components/app/v3";

const FILTER_CHIPS = [
    { label: "전체", value: "all" },
    { label: "진행중", value: "active" },
    { label: "대기", value: "pending" },
    { label: "완료", value: "completed" },
    { label: "만료", value: "expired" },
];

const getAvatarGradient = (name: string) => {
    const charCode = name.charCodeAt(0);
    const gradients = [
        "bg-gradient-to-br from-[hsl(214,100%,34%)] to-[hsl(214,100%,28%)]",
        "bg-gradient-to-br from-[hsl(137,34%,31%)] to-[hsl(137,34%,25%)]",
        "bg-gradient-to-br from-[hsl(355,36%,45%)] to-[hsl(355,36%,38%)]",
        "bg-gradient-to-br from-[hsl(34,100%,55%)] to-[hsl(34,100%,45%)]",
        "bg-gradient-to-br from-[hsl(175,60%,40%)] to-[hsl(175,60%,30%)]",
        "bg-gradient-to-br from-[hsl(270,60%,55%)] to-[hsl(270,60%,45%)]",
    ];
    return gradients[charCode % gradients.length];
};

const getStatusLabel = (status: string | null) => {
    const option = SERVICE_STATUS_OPTIONS.find((o) => o.value === status);
    return option ? option.label : "-";
};

const mapServiceStatusToV3 = (status: string | null): StatusType => {
    switch (status) {
        case "active":
            return "active";
        case "waiting":
        case "pending":
        case "replacement_requested":
            return "pending";
        case "terminated":
        case "cancelled":
            return "expired";
        case "completed":
            return "completed";
        default:
            return "pending";
    }
};

const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("ko-KR");
};

const formatPrice = (price: string | null): string => {
    if (!price) return "-";
    const cleaned = price.replace(/,/g, "");
    const num = parseInt(cleaned, 10);
    if (isNaN(num)) return "-";
    return `${num.toLocaleString("ko-KR")}원`;
};

const filterValueToStatus = (filter: string): string | null => {
    switch (filter) {
        case "active":
            return "active";
        case "pending":
            return "waiting";
        case "completed":
            return "completed";
        case "expired":
            return "terminated";
        default:
            return null;
    }
};

export default function ClientsPage() {
    const locale = useLocale();
    const router = useRouter();
    const searchParams = useSearchParams();
    const clientIdParam = searchParams.get("id");

    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState("all");
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const [activeSection, setActiveSection] = useState<string>("basic");

    const { data, isLoading } = useClients(1, 50);
    const deleteClient = useDeleteClient();

    const { data: clientFromParam } = useClient(
        clientIdParam ? Number(clientIdParam) : 0
    );

    useEffect(() => {
        if (clientIdParam && clientFromParam) {
            setSelectedClient(clientFromParam);
        }
    }, [clientIdParam, clientFromParam]);

    const clients = data?.data || [];
    const total = data?.total || 0;

    const filteredClients = useMemo(() => {
        let result = clients;
        const statusValue = filterValueToStatus(activeFilter);
        if (statusValue) result = result.filter((c) => c.serviceStatus === statusValue);
        if (searchQuery.trim()) {
            result = result.filter((c) => matchesKoreanSearch(c.name, searchQuery.trim()));
        }
        return result;
    }, [clients, activeFilter, searchQuery]);

    const stats = useMemo(() => {
        const activeCount = clients.filter((c) => c.serviceStatus === "active").length;
        const pendingCount = clients.filter(
            (c) => c.serviceStatus === "waiting" || c.serviceStatus === "pending"
        ).length;
        const expiredCount = clients.filter(
            (c) => c.serviceStatus === "terminated" || c.serviceStatus === "cancelled"
        ).length;
        return { activeCount, pendingCount, expiredCount };
    }, [clients]);

    const handleAddNew = () => {
        router.push("/clients/new");
    };

    const handleSelectClient = (client: Client) => {
        setSelectedClient(client);
    };

    const handleEdit = (client: Client) => {
        setEditingClient(client);
        setFormDialogOpen(true);
    };

    const handleDelete = async (id: number) => {
        if (window.confirm(t(locale, "clients.delete-confirm"))) {
            try {
                await deleteClient.mutateAsync(id);
                if (selectedClient?.id === id) {
                    setSelectedClient(null);
                }
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
        if (clientIdParam) {
            router.replace("/clients");
        }
    };

    return (
        <section data-component="clients" className="space-y-6 pb-10">
            <PageHeader
                title="고객 관리"
                icon={Users}
                actions={
                    <HeaderActionButton
                        icon={Plus}
                        label={t(locale, "clients.add")}
                        onClick={handleAddNew}
                        data-testid="add-client-button"
                        data-component="clients-header-add"
                    />
                }
            />

            <StatsBar
                name="clients"
                isLoading={isLoading}
                items={[
                    { icon: Users, value: total, label: "전체 고객", counter: "명" },
                    { icon: UserCheck, value: stats.activeCount, label: "진행중", counter: "명", colorIndex: 2 },
                    { icon: Clock, value: stats.pendingCount, label: "대기중", counter: "명", colorIndex: 1 },
                    { icon: AlertTriangle, value: stats.expiredCount, label: "만료임박", counter: "명", colorIndex: 3 },
                ]}
            />

	            <SplitLayout hasSelection={!!selectedClient} onBack={() => setSelectedClient(null)}>
	                <ListPanel
	                    title="고객 목록"
	                    tabs={FILTER_CHIPS}
	                    activeTab={activeFilter}
	                    onTabChange={setActiveFilter}
	                    searchValue={searchQuery}
	                    onSearchChange={setSearchQuery}
	                    searchPlaceholder={t(locale, "clients.search-placeholder")}
	                    isLoading={isLoading}
	                >
	                    <div className="space-y-2">
	                        {!isLoading && filteredClients.length === 0 ? (
	                            <ListEmptyState message={t(locale, "clients.no-data")} />
	                        ) : (
	                            <>
	                                <AnimatedSlotList<Client>
	                                    items={filteredClients}
	                                    isLoading={isLoading}
	                                    loadingCount={10}
	                                    className="space-y-2"
	                                    slotClassName={({ item, isLoading }) =>
	                                        cn(
	                                            "flex items-center gap-3 p-4 rounded-[18px] transition-all duration-200 bg-white border-2 border-transparent",
	                                            !isLoading &&
	                                                item &&
	                                                (selectedClient?.id === item.id
	                                                    ? "bg-v3-primary-light border-2 border-v3-primary"
	                                                    : "bg-white border-2 border-transparent hover:bg-v3-primary-light/50 hover:border-v3-primary/30")
	                                        )
	                                    }
	                                    onSlotClick={(client) => handleSelectClient(client)}
	                                    render={({ item, isLoading }) => {
	                                        const client = item;
	                                        return (
	                                            <>
	                                                {isLoading ? (
	                                                    <div className="w-11 h-11 rounded-[14px] shrink-0 shadow-md bg-v3-dim-white flex items-center justify-center">
	                                                        <Skeleton className="w-5 h-5 rounded-md bg-white/70" />
	                                                    </div>
	                                                ) : (
	                                                    client && (
	                                                        <div
	                                                            className={cn(
	                                                                "w-11 h-11 rounded-[14px] flex items-center justify-center font-bold text-sm text-white shrink-0 shadow-md",
	                                                                getAvatarGradient(client.name)
	                                                            )}
	                                                        >
	                                                            {client.name.charAt(0)}
	                                                        </div>
	                                                    )
	                                                )}

	                                                <div className="flex-1 min-w-0">
	                                                    <div className="flex items-center gap-2 mb-0.5">
	                                                        {isLoading ? (
	                                                            <>
	                                                                <Skeleton className="h-4 w-28 bg-v3-dim-white" />
	                                                                <Skeleton className="h-4 w-10 rounded-full bg-v3-dim-white" />
	                                                            </>
	                                                        ) : (
	                                                            <>
	                                                                <span className="font-bold text-[0.85rem] text-v3-dark truncate">
	                                                                    {client?.name}
	                                                                </span>
	                                                                <Badge
	                                                                    variant="secondary"
	                                                                    className="bg-[hsl(270,60%,94%)] text-[hsl(270,60%,55%)] border-none rounded-full px-2 py-0 text-[9px] font-bold shrink-0"
	                                                                >
	                                                                    {client?.type || "일반"}
	                                                                </Badge>
	                                                            </>
	                                                        )}
	                                                    </div>

	                                                    {isLoading ? (
	                                                        <Skeleton className="h-3 w-52 bg-v3-dim-white" />
	                                                    ) : (
	                                                        <div className="flex items-center gap-2 text-[0.7rem] text-v3-text-muted truncate">
	                                                            {client?.phone && <span>{client.phone}</span>}
	                                                            {client?.address && (
	                                                                <span className="truncate">
	                                                                    {client.address.split(" ")[1] || client.address}
	                                                                </span>
	                                                            )}
	                                                        </div>
	                                                    )}
	                                                </div>

	                                                <div className="shrink-0">
	                                                    {isLoading ? (
	                                                        <Skeleton className="h-6 w-14 rounded-full bg-v3-dim-white" />
	                                                    ) : (
	                                                        client && (
	                                                            <StatusBadge
	                                                                status={mapServiceStatusToV3(client.serviceStatus)}
	                                                                label={getStatusLabel(client.serviceStatus)}
	                                                            />
	                                                        )
	                                                    )}
	                                                </div>
	                                            </>
	                                        );
	                                    }}
	                                />
	                            </>
	                        )}
	                    </div>
	                </ListPanel>

                {selectedClient ? (
                    <DetailPanel
                        header={
                            <div className="text-center">
                                <div
                                    className={cn(
                                        "mx-auto w-20 h-20 rounded-[24px] flex items-center justify-center text-2xl font-bold text-white mb-4 shadow-lg",
                                        getAvatarGradient(selectedClient.name)
                                    )}
                                >
                                    {selectedClient.name.charAt(0)}
                                </div>
                                <h2 className="text-xl font-bold text-v3-dark">
                                    {selectedClient.name}
                                </h2>
                                <p className="text-[0.8rem] text-v3-text-muted mt-1">
                                    {selectedClient.type || "일반"} ·{" "}
                                    {selectedClient.duration
                                        ? `${selectedClient.duration}일`
                                        : "-"}
                                </p>
                                <div className="mt-3">
                                    <StatusBadge
                                        status={mapServiceStatusToV3(
                                            selectedClient.serviceStatus
                                        )}
                                        label={getStatusLabel(
                                            selectedClient.serviceStatus
                                        )}
                                    />
                                </div>

                                <div className="flex gap-2 justify-center mt-5">
                                    {selectedClient.phone && (
                                        <a
                                            href={`tel:${selectedClient.phone}`}
                                            className="flex-1"
                                        >
                                            <Button
                                                variant="ghost"
                                                className="w-full flex-col h-auto py-3 gap-1 hover:bg-v3-primary-light hover:text-v3-primary rounded-[14px]"
                                            >
                                                <Phone className="w-4 h-4" />
                                                <span className="text-[10px] font-semibold">
                                                    전화
                                                </span>
                                            </Button>
                                        </a>
                                    )}
                                    <Button
                                        variant="ghost"
                                        className="flex-1 flex-col h-auto py-3 gap-1 hover:bg-v3-primary-light hover:text-v3-primary rounded-[14px]"
                                    >
                                        <MessageSquare className="w-4 h-4" />
                                        <span className="text-[10px] font-semibold">
                                            메시지
                                        </span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        className="flex-1 flex-col h-auto py-3 gap-1 hover:bg-v3-primary-light hover:text-v3-primary rounded-[14px]"
                                    >
                                        <FileText className="w-4 h-4" />
                                        <span className="text-[10px] font-semibold">
                                            계약
                                        </span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        className="flex-1 flex-col h-auto py-3 gap-1 hover:bg-v3-primary-light hover:text-v3-primary rounded-[14px]"
                                    >
                                        <ClipboardList className="w-4 h-4" />
                                        <span className="text-[10px] font-semibold">
                                            서류
                                        </span>
                                    </Button>
                                </div>
                            </div>
                        }
                        tabs={
                            <DetailTabs
                                tabs={[
                                    { key: "basic", label: "기본 정보" },
                                    { key: "caregiver", label: "담당 관리사" },
                                    { key: "service", label: "서비스 정보" },
                                ]}
                                activeTab={activeSection}
                                onTabChange={setActiveSection}
                            />
                        }
                    >
                        <div data-component="clients-detail-content" className="space-y-4">
                            {activeSection === "basic" && (
                            <InfoCard title="기본 정보">
                                <InfoRow
                                    label={t(locale, "clients.form.name")}
                                    value={selectedClient.name}
                                />
                                <InfoRow
                                    label={t(locale, "clients.form.birthday")}
                                    value={selectedClient.birthday || "-"}
                                />
                                <InfoRow
                                    label={t(locale, "clients.form.due-date")}
                                    value={formatDate(selectedClient.dueDate)}
                                />
                                <InfoRow
                                    label={t(locale, "clients.form.phone")}
                                    value={selectedClient.phone || "-"}
                                />
                                <InfoRow
                                    label={t(locale, "clients.form.address")}
                                    value={selectedClient.address || "-"}
                                />
                            </InfoCard>
                            )}

                            {activeSection === "caregiver" && (
                            <InfoCard title="담당 관리사">
                                <InfoRow
                                    label={t(locale, "clients.form.primary-employee")}
                                    value={
                                        selectedClient.primaryEmployee?.name ??
                                        "-"
                                    }
                                />
                                <InfoRow
                                    label={t(locale, "clients.form.secondary-employee")}
                                    value={
                                        selectedClient.secondaryEmployee
                                            ?.name ?? "-"
                                    }
                                />
                            </InfoCard>
                            )}

                            {activeSection === "service" && (
                            <>
                            <InfoCard title="서비스 정보">
                                <InfoRow
                                    label={t(locale, "clients.form.voucher-type")}
                                    value={selectedClient.type || "-"}
                                />
                                <InfoRow
                                    label={t(locale, "clients.form.duration")}
                                    value={
                                        selectedClient.duration
                                            ? `${selectedClient.duration}일`
                                            : "-"
                                    }
                                />
                                <InfoRow
                                    label={t(locale, "clients.form.start-date")}
                                    value={formatDate(selectedClient.startDate)}
                                />
                                <InfoRow
                                    label={t(locale, "clients.form.end-date")}
                                    value={formatDate(selectedClient.endDate)}
                                />
                            </InfoCard>

                            <InfoCard title="요금 정보">
                                <InfoRow
                                    label={t(locale, "clients.form.full-price")}
                                    value={formatPrice(
                                        selectedClient.fullPrice
                                    )}
                                />
                                <InfoRow
                                    label={t(locale, "clients.form.grant")}
                                    value={formatPrice(selectedClient.grant)}
                                />
                                <InfoRow
                                    label={t(locale, "clients.form.actual-price")}
                                    value={formatPrice(
                                        selectedClient.actualPrice
                                    )}
                                />
                            </InfoCard>
                            </>
                            )}

                            <div data-component="clients-detail-actions" className="flex gap-3 pt-2">
                                <Button
                                    variant="outline"
                                    className="flex-1 rounded-full"
                                    onClick={() => handleDelete(selectedClient.id)}
                                >
                                    {t(locale, "common.delete")}
                                </Button>
                                <Button
                                    variant="v3"
                                    className="flex-1 rounded-full"
                                    onClick={() => handleEdit(selectedClient)}
                                >
                                    {t(locale, "common.edit")}
                                </Button>
                            </div>
                        </div>
                    </DetailPanel>
                ) : (
                    <EmptyState name="clients-empty-state" icon={Users} message="고객을 선택하면 상세 정보가 표시됩니다" className="min-h-[400px]" />
                )}
            </SplitLayout>

            <ClientDetailModal
                open={detailModalOpen}
                onClose={handleDetailModalClose}
                client={selectedClient}
                onEdit={handleEdit}
                onDelete={handleDelete}
            />

            <ClientFormDialog
                open={formDialogOpen}
                onClose={handleFormDialogClose}
                client={editingClient}
            />
        </section>
    );
}
