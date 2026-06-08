"use client";

import { useState, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Users, Calendar, CalendarDays, Plus, Clock, UserCheck, AlertTriangle, MoreVertical, Pencil, Trash2 } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useClients, useDeleteClient, useClient } from "@/hooks/useClients";
import { Client, SERVICE_STATUS_OPTIONS } from "@/lib/client/types";
import { ClientFormDialog } from "@/components/app/clients/ClientFormDialog";
import { ClientDetailModal } from "@/components/app/clients/ClientDetailModal";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
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
    PageSection,
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
    { label: "중단", value: "expired" },
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
            return "terminated";
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

const toDate = (value: string | null): Date | null => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
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
    const shouldOpenClientFormFromUrl = searchParams.get("openClientForm") === "1";

    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState("all");
    const [activeDetailTab, setActiveDetailTab] = useState<string>("basic");
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const clientDialogDraft = useClientDialogStore((state) => state.draft);


    const { data, isLoading } = useClients(1, 50);
    const deleteClient = useDeleteClient();

    const { data: clientFromParam } = useClient(
        clientIdParam ? Number(clientIdParam) : 0
    );

    const activeSelectedClient = selectedClient ?? (clientIdParam ? clientFromParam ?? null : null);

    const clients = useMemo(() => data?.data || [], [data?.data]);

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
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();
        const nextMonthDate = new Date(currentYear, currentMonth + 1, 1);
        const nextMonthYear = nextMonthDate.getFullYear();
        const nextMonth = nextMonthDate.getMonth();

        const today = new Date(currentYear, currentMonth, now.getDate());
        const threeDaysLater = new Date(currentYear, currentMonth, now.getDate() + 3);

        const thisMonthCount = clients.filter((c) => {
            const dueDate = toDate(c.dueDate);
            return dueDate
                ? dueDate.getFullYear() === currentYear && dueDate.getMonth() === currentMonth
                : false;
        }).length;

        const nextMonthCount = clients.filter((c) => {
            const dueDate = toDate(c.dueDate);
            return dueDate
                ? dueDate.getFullYear() === nextMonthYear && dueDate.getMonth() === nextMonth
                : false;
        }).length;

        const activeCount = clients.filter((c) => c.serviceStatus === "active").length;
        const pendingCount = clients.filter(
            (c) => c.serviceStatus === "waiting" || c.serviceStatus === "pending"
        ).length;

        const endingSoonCount = clients.filter((c) => {
            const endDate = toDate(c.endDate);
            if (!endDate) return false;

            const normalizedEndDate = new Date(
                endDate.getFullYear(),
                endDate.getMonth(),
                endDate.getDate()
            );

            return normalizedEndDate >= today && normalizedEndDate <= threeDaysLater;
        }).length;

        return { thisMonthCount, nextMonthCount, activeCount, pendingCount, endingSoonCount };
    }, [clients]);

    const handleAddNew = () => {
        router.push("/clients/new");
    };

    const handleSelectClient = (client: Client) => {
        if (clientIdParam) {
            router.replace("/clients");
        }

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
                if (activeSelectedClient?.id === id) {
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

        if (shouldOpenClientFormFromUrl) {
            router.replace("/clients");
        }
    };

    const handleDetailModalClose = () => {
        setDetailModalOpen(false);
        if (clientIdParam) {
            router.replace("/clients");
        }
    };

    return (
        <PageSection name="clients">
            <StatsBar
                name="clients"
                isLoading={isLoading}
                items={[
                    { icon: Calendar, value: stats.thisMonthCount, label: "이번달 고객", counter: "명" },
                    { icon: CalendarDays, value: stats.nextMonthCount, label: "다음달 고객", counter: "명", colorIndex: 1 },
                    { icon: UserCheck, value: stats.activeCount, label: "서비스 진행중", counter: "명", colorIndex: 2 },
                    { icon: Clock, value: stats.pendingCount, label: "서비스 대기중", counter: "명", colorIndex: 1 },
                    { icon: AlertTriangle, value: stats.endingSoonCount, label: "3일내 종료", counter: "명", colorIndex: 3 },
                ]}
            />

            <SplitLayout
                hasSelection={!!activeSelectedClient}
                onBack={() => {
                    if (clientIdParam) {
                        router.replace("/clients");
                    }

                    setSelectedClient(null);
                }}
            >
	                <ListPanel
	                    title="고객 목록"
	                    tabs={FILTER_CHIPS}
	                    activeTab={activeFilter}
	                    onTabChange={setActiveFilter}
	                    searchValue={searchQuery}
	                    onSearchChange={setSearchQuery}
	                    searchPlaceholder={t(locale, "clients.search-placeholder")}
	                    isLoading={isLoading}
	                    headerActions={
	                        <HeaderActionButton
	                            icon={Plus}
	                            label={t(locale, "clients.add")}
	                            onClick={handleAddNew}
	                            data-testid="add-client-button"
	                            data-component="clients-header-add"
	                        />
	                    }
	                >
	                    <div data-component="clients-list-content" className="space-y-2">
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
                                                (activeSelectedClient?.id === item.id
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
	                                                    <div data-component="clients-list-item-avatar-skeleton" className="w-11 h-11 rounded-[14px] shrink-0 shadow-md bg-v3-dim-white flex items-center justify-center">
	                                                        <Skeleton className="w-5 h-5 rounded-md bg-white/70" />
	                                                    </div>
	                                                ) : (
	                                                    client && (
                                                        <div
                                                            data-component="clients-list-item-avatar"
                                                            className={cn(
                                                                "w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 shadow-md",
                                                                getAvatarGradient(client.name)
                                                            )}
                                                        >
                                                            <Users className="w-5 h-5 shrink-0 transition-colors text-white" aria-hidden="true" />
                                                        </div>
	                                                    )
	                                                )}

	                                                <div data-component="clients-list-item-info" className="flex-1 min-w-0">
	                                                    <div data-component="clients-list-item-name-row" className="flex items-center gap-2 mb-0.5">
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
                                                            </>
                                                        )}
                                                    </div>

	                                                    {isLoading ? (
	                                                        <Skeleton className="h-3 w-52 bg-v3-dim-white" />
	                                                    ) : (
	                                                        <div data-component="clients-list-item-meta-row" className="flex items-center gap-2 text-[0.7rem] text-v3-text-muted truncate">
	                                                            {client?.phone && <span>{client.phone}</span>}
	                                                            {client?.address && (
	                                                                <span className="truncate">
	                                                                    {client.address.split(" ")[1] || client.address}
	                                                                </span>
	                                                            )}
	                                                        </div>
	                                                    )}
	                                                </div>

	                                                <div data-component="clients-list-item-status" className="shrink-0">
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

                {activeSelectedClient ? (
                    <DetailPanel
                        compactBackLabel="고객 목록으로 돌아가기"
                        avatar={
                            <div
                                data-component="clients-detail-avatar"
                                className={cn(
                                    "w-16 h-16 rounded-[20px] flex items-center justify-center text-white shadow-lg shrink-0",
                                    getAvatarGradient(activeSelectedClient.name)
                                )}
                            >
                                <Users className="w-7 h-7 shrink-0 transition-colors text-white" aria-hidden="true" />
                            </div>
                        }
                        title={activeSelectedClient.name}
                        badges={
                            <>
                                <StatusBadge
                                    status={mapServiceStatusToV3(
                                        activeSelectedClient.serviceStatus
                                    )}
                                    label={getStatusLabel(
                                        activeSelectedClient.serviceStatus
                                    )}
                                />
                                {activeSelectedClient.breastPump && (
                                    <StatusBadge status="breastPump" />
                                )}
                                {activeSelectedClient.careCenter && (
                                    <StatusBadge status="careCenter" />
                                )}
                            </>
                        }
                        subtitle={
                            <>
                                {activeSelectedClient.type || "일반"} ·{" "}
                                {activeSelectedClient.duration
                                    ? `${activeSelectedClient.duration}일`
                                    : "-"}
                            </>
                        }
                        trailing={
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button type="button" className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-v3-dim-white transition-colors">
                                        <MoreVertical className="w-5 h-5 text-v3-text-muted" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="min-w-[140px]">
                                    <DropdownMenuItem onClick={() => handleEdit(activeSelectedClient)} className="gap-2">
                                        <Pencil className="w-4 h-4" />
                                        {t(locale, "common.edit")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleDelete(activeSelectedClient.id)} className="gap-2 text-destructive focus:text-destructive">
                                        <Trash2 className="w-4 h-4" />
                                        {t(locale, "common.delete")}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        }
                        tabs={
                            <DetailTabs
                                tabs={[
                                    { key: "basic", label: "기본 정보" },
                                    { key: "contracts", label: "계약서 정보" },
                                    { key: "alimtalk", label: "알림톡 발송 현황" },
                                ]}
                                activeTab={activeDetailTab}
                                onTabChange={setActiveDetailTab}
                            />
                        }
                    >
                        <div data-component="clients-detail-content" className="space-y-4">
                            {activeDetailTab === "basic" && (
                                <div data-component="clients-detail-basic-grid" className="grid grid-cols-2 gap-4">
                                    <InfoCard title="고객 정보" className="col-start-1 row-start-1 row-end-3">
                                        <InfoRow
                                            label={t(locale, "clients.form.name")}
                                            value={activeSelectedClient.name}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.birthday")}
                                            value={activeSelectedClient.birthday || "-"}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.due-date")}
                                            value={formatDate(activeSelectedClient.dueDate)}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.phone")}
                                            value={activeSelectedClient.phone || "-"}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.address")}
                                            value={activeSelectedClient.address || "-"}
                                        />
                                    </InfoCard>

                                    <InfoCard title="담당 관리사" className="col-start-1 row-start-3 row-end-5">
                                        <InfoRow
                                            label={t(locale, "clients.form.primary-employee")}
                                            value={
                                                activeSelectedClient.primaryEmployee?.name ??
                                                "-"
                                            }
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.secondary-employee")}
                                            value={
                                                activeSelectedClient.secondaryEmployee
                                                    ?.name ?? "-"
                                            }
                                        />
                                    </InfoCard>

                                    <InfoCard title="서비스 정보" className="col-start-2 row-start-1 row-end-5">
                                        <InfoRow
                                            label={t(locale, "clients.form.voucher-type")}
                                            value={activeSelectedClient.type || "-"}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.duration")}
                                            value={
                                                activeSelectedClient.duration
                                                    ? `${activeSelectedClient.duration}일`
                                                    : "-"
                                            }
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.start-date")}
                                            value={formatDate(activeSelectedClient.startDate)}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.end-date")}
                                            value={formatDate(activeSelectedClient.endDate)}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.full-price")}
                                            value={formatPrice(
                                                activeSelectedClient.fullPrice
                                            )}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.grant")}
                                            value={formatPrice(activeSelectedClient.grant)}
                                        />
                                        <InfoRow
                                            label={t(locale, "clients.form.actual-price")}
                                            value={formatPrice(
                                                activeSelectedClient.actualPrice
                                            )}
                                        />
                                    </InfoCard>


                                </div>
                            )}

                            {activeDetailTab === "contracts" && (
                                <div data-component="clients-detail-contracts-empty" className="text-center py-12 text-v3-text-muted text-[0.85rem]">
                                    계약서 정보가 없습니다
                                </div>
                            )}

                            {activeDetailTab === "alimtalk" && (
                                <div data-component="clients-detail-alimtalk-empty" className="text-center py-12 text-v3-text-muted text-[0.85rem]">
                                    알림톡 발송 현황이 없습니다
                                </div>
                            )}
                        </div>
                    </DetailPanel>
                ) : (
                    <EmptyState name="clients-empty-state" icon={Users} message="고객을 선택하면 상세 정보가 표시됩니다" />
                )}
            </SplitLayout>

                <ClientDetailModal
                    open={detailModalOpen}
                    onClose={handleDetailModalClose}
                    client={activeSelectedClient}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                />

            <ClientFormDialog
                open={formDialogOpen || shouldOpenClientFormFromUrl}
                onClose={handleFormDialogClose}
                client={editingClient ?? clientDialogDraft?.client ?? null}
            />
        </PageSection>
    );
}
