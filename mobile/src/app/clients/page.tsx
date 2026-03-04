"use client";

import { useState, useMemo, useEffect, useLayoutEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
    Users,
    Plus,
    Phone,
    MessageSquare,
    FileText,
    ClipboardList,
    Clock,
    UserCheck,
    AlertTriangle,
    MoreVertical,
} from "lucide-react";
import { useDeleteClient, useClient } from "@/hooks/useClients";
import { toast } from "@/hooks/use-toast";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import { Client, SERVICE_STATUS_OPTIONS } from "@/lib/client/types";
import {
    ClientActionButtons,
    type ClientActionButtonItem,
} from "@/components/app/clients/ClientActionButtons";
import { ClientFormDialog } from "@/components/app/clients/ClientFormDialog";
import { ClientDetailModal } from "@/components/app/clients/ClientDetailModal";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    ListEmptyState,
    DetailTabs,
} from "@/components/app/v3";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import type { StatusType } from "@/components/app/v3";
import { useFormStore } from "@/stores/form-store";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ConfirmActionModal } from "@/components/app/ui/ConfirmActionModal";

const FILTER_CHIPS = [
    { label: "전체", value: "all" },
    { label: "진행중", value: "active" },
    { label: "대기", value: "pending" },
    { label: "완료", value: "completed" },
    { label: "만료", value: "expired" },
];

const DETAIL_SECTION_ORDER = ["basic", "service"] as const;
type DetailSectionKey = (typeof DETAIL_SECTION_ORDER)[number];

const getDetailSectionIndex = (section: DetailSectionKey) =>
    DETAIL_SECTION_ORDER.indexOf(section);

const isDetailSectionKey = (section: string): section is DetailSectionKey =>
    DETAIL_SECTION_ORDER.includes(section as DetailSectionKey);

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
    const [activeSection, setActiveSection] = useState<DetailSectionKey>("basic");
    const [sectionDirection, setSectionDirection] = useState<-1 | 0 | 1>(0);
    const [deleteTargetClientId, setDeleteTargetClientId] = useState<number | null>(null);
    const prefersReducedMotion = useReducedMotion();
    const detailContentMotionRef = useRef<HTMLDivElement | null>(null);
    const basicSectionRef = useRef<HTMLDivElement | null>(null);

    const {
        clients: filteredClients,
        allClients,
        total,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        isInitialLoad,
    } = useInfiniteClients({
        filter: activeFilter,
        search: searchQuery,
        filterFn: (c, filterValue) => {
            const statusValue = filterValueToStatus(filterValue);
            return statusValue ? c.serviceStatus === statusValue : true;
        },
        searchFn: (c, query) => matchesKoreanSearch(c.name, query),
    });
    const deleteClient = useDeleteClient();

    const { data: clientFromParam } = useClient(
        clientIdParam ? Number(clientIdParam) : 0
    );

    useEffect(() => {
        if (clientIdParam && clientFromParam) {
            setSelectedClient(clientFromParam);
        }
    }, [clientIdParam, clientFromParam]);

    const stats = useMemo(() => {
        const activeCount = allClients.filter((c) => c.serviceStatus === "active").length;
        const pendingCount = allClients.filter(
            (c) => c.serviceStatus === "waiting" || c.serviceStatus === "pending"
        ).length;
        const expiredCount = allClients.filter(
            (c) => c.serviceStatus === "terminated" || c.serviceStatus === "cancelled"
        ).length;
        return { activeCount, pendingCount, expiredCount };
    }, [allClients]);

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

    const handleDeleteRequest = (id: number) => {
        setDeleteTargetClientId(id);
    };

    const handleDeleteConfirm = async () => {
        if (deleteTargetClientId == null) {
            return;
        }

        try {
            await deleteClient.mutateAsync(deleteTargetClientId);
            if (selectedClient?.id === deleteTargetClientId) {
                setSelectedClient(null);
            }
            setDeleteTargetClientId(null);
            toast({
                title: t(locale, "clients.delete-success"),
                description: t(locale, "clients.delete-success-description"),
            });
        } catch (err) {
            toast({
                title: t(locale, "clients.delete-fail"),
                description: t(locale, "clients.delete-fail-description"),
                variant: "destructive",
            });
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

    const handleSectionChange = (nextSection: string) => {
        if (!isDetailSectionKey(nextSection)) {
            return;
        }

        const currentIndex = getDetailSectionIndex(activeSection);
        const nextIndex = getDetailSectionIndex(nextSection);

        if (nextIndex === currentIndex) {
            setSectionDirection(0);
            setActiveSection(nextSection);
            return;
        }

        setSectionDirection(nextIndex > currentIndex ? 1 : -1);
        setActiveSection(nextSection);
    };

    const getDetailContentEnterX = (direction: -1 | 0 | 1) => {
        if (direction === 0) return 0;
        return direction > 0 ? "100%" : "-100%";
    };

    const getDetailContentExitX = (direction: -1 | 0 | 1) => {
        if (direction === 0) return 0;
        return direction > 0 ? "-100%" : "100%";
    };

    const detailContentVariants = {
        initial: (direction: -1 | 0 | 1) => ({
            x: prefersReducedMotion ? 0 : getDetailContentEnterX(direction),
        }),
        animate: { x: 0 },
        exit: (direction: -1 | 0 | 1) => ({
            x: prefersReducedMotion ? 0 : getDetailContentExitX(direction),
        }),
    };

    const detailContentTransition = prefersReducedMotion
        ? { duration: 0 }
        : {
              type: "tween" as const,
              duration: 0.32,
              ease: [0.22, 1, 0.36, 1] as const,
          };

    useLayoutEffect(() => {
        if (activeSection !== "basic") {
            return;
        }

        const motionContainer = detailContentMotionRef.current;
        const basicSectionElement = basicSectionRef.current;

        if (!motionContainer || !basicSectionElement) {
            return;
        }

        const updateMinHeight = () => {
            motionContainer.style.minHeight = `${Math.ceil(
                basicSectionElement.getBoundingClientRect().height
            )}px`;
        };

        updateMinHeight();

        const resizeObserver = new ResizeObserver(() => {
            updateMinHeight();
        });

        resizeObserver.observe(basicSectionElement);

        return () => {
            resizeObserver.disconnect();
        };
    }, [activeSection, selectedClient?.id]);

    const clientActionItems = useMemo<ClientActionButtonItem[]>(() => {
        if (!selectedClient) return [];

        const items: ClientActionButtonItem[] = [];

        if (selectedClient.phone) {
            items.push({
                key: "phone",
                label: "전화",
                icon: Phone,
                href: `tel:${selectedClient.phone}`,
            });
        }

        items.push(
            {
                key: "message",
                label: "메시지",
                icon: MessageSquare,
                onClick: () => {
                    useFormStore.getState().prefillFromClient(selectedClient);
                    router.push("/messages");
                },
            },
            { key: "contract", label: "계약", icon: FileText },
            { key: "document", label: "서류", icon: ClipboardList }
        );

        return items;
    }, [selectedClient, router]);

    return (
        <section data-component="clients" className="space-y-6">
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

	            <SplitLayout hasSelection={!!selectedClient} onBack={() => setSelectedClient(null)} autoHeight>
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
	                    <div className="space-y-2">
	                        {!isLoading && filteredClients.length === 0 ? (
	                            <ListEmptyState message={t(locale, "clients.no-data")} />
	                        ) : (
	                            <>
                                <AnimatedSlotList<Client>
                                    items={filteredClients}
                                    isLoading={isLoading}
                                    loadingCount={6}
                                    className="space-y-2"
                                    hasMore={hasNextPage}
                                    onLoadMore={fetchNextPage}
                                    isFetchingMore={isFetchingNextPage}
                                    isInitialLoad={isInitialLoad}
	                                    slotClassName={({ item, isLoading }) =>
	                                        cn(
	                                            "flex items-center gap-3 p-4 rounded-2xl transition-all duration-200 bg-white border-2 border-transparent",
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
	                                                    <div className="w-11 h-11 rounded-2xl shrink-0 shadow-md bg-v3-dim-white flex items-center justify-center">
	                                                        <Skeleton className="w-5 h-5 rounded-2xl bg-white/70" />
	                                                    </div>
	                                                ) : (
	                                                    client && (
	                                                        <div
	                                                            className={cn(
	                                                                "w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-sm text-white shrink-0 shadow-md",
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
                        mobileActions={
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        data-component="clients-detail-mobile-more-trigger"
                                        className="h-9 w-9 rounded-full text-v3-text-muted hover:bg-v3-dim-white hover:text-v3-primary"
                                        aria-label="상세 액션 더보기"
                                    >
                                        <MoreVertical className="h-5 w-5" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    data-component="clients-detail-mobile-more-content"
                                    align="end"
                                    sideOffset={8}
                                    avoidCollisions
                                    className="min-w-[8.5rem]"
                                >
                                    <DropdownMenuItem
                                        data-component="clients-detail-mobile-more-edit"
                                        onClick={() => handleEdit(selectedClient)}
                                    >
                                        {t(locale, "common.edit")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        data-component="clients-detail-mobile-more-delete"
                                        variant="destructive"
                                        onClick={() => handleDeleteRequest(selectedClient.id)}
                                    >
                                        {t(locale, "common.delete")}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        }
                        header={
                            <div>
                                <div className="flex items-center gap-4">
                                    <div
                                        className={cn(
                                            "w-20 h-20 shrink-0 rounded-2xl flex items-center justify-center text-2xl font-bold text-white shadow-lg",
                                            getAvatarGradient(selectedClient.name)
                                        )}
                                    >
                                        {selectedClient.name.charAt(0)}
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-v3-dark">
                                            {selectedClient.name}
                                        </h2>
                                        <p className="text-[0.8rem] text-v3-text-muted mt-1">
                                            {selectedClient.type || "일반"} ·{" "}
                                            {selectedClient.duration
                                                ? `${selectedClient.duration}일`
                                                : "-"}
                                        </p>
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            <StatusBadge
                                                status={mapServiceStatusToV3(
                                                    selectedClient.serviceStatus
                                                )}
                                                label={getStatusLabel(
                                                    selectedClient.serviceStatus
                                                )}
                                            />
                                            <StatusBadge
                                                status={selectedClient.voucherClient ? "active" : "expired"}
                                                label={t(locale, "clients.form.voucher-client")}
                                            />
                                            <StatusBadge
                                                status={selectedClient.breastPump ? "active" : "expired"}
                                                label={t(locale, "clients.form.breast-pump")}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        }
                        actions={
                            <ClientActionButtons items={clientActionItems} />
                        }
                        tabs={
                            <DetailTabs
                                tabs={[
                                    { key: "basic", label: "기본 정보" },
                                    { key: "service", label: "서비스 정보" },
                                ]}
                                activeTab={activeSection}
                                onTabChange={handleSectionChange}
                            />
                        }
                    >
                        <div
                            data-component="clients-detail-content-motion"
                            className="relative overflow-hidden"
                            ref={detailContentMotionRef}
                        >
                            <AnimatePresence mode="popLayout" initial={false} custom={sectionDirection}>
                                <motion.div
                                    key={activeSection}
                                    custom={sectionDirection}
                                    data-component="clients-detail-content"
                                    className="space-y-4 transform-gpu will-change-transform"
                                    ref={activeSection === "basic" ? basicSectionRef : undefined}
                                    variants={detailContentVariants}
                                    initial="initial"
                                    animate="animate"
                                    exit="exit"
                                    transition={detailContentTransition}
                                >
                                    {activeSection === "basic" && (
                                        <>
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
                                            <InfoCard title="담당 관리사">
                                                <InfoRow
                                                    label={t(locale, "clients.form.primary-employee")}
                                                    value={selectedClient.primaryEmployee?.name ?? "-"}
                                                />
                                                <InfoRow
                                                    label={t(locale, "clients.form.secondary-employee")}
                                                    value={selectedClient.secondaryEmployee?.name ?? "-"}
                                                />
                                            </InfoCard>
                                            <div
                                                data-component="client-request-box"
                                                className="bg-v3-dim-white rounded-2xl p-4"
                                            >
                                                <h3 className="text-[0.7rem] uppercase tracking-[0.1em] text-v3-text-muted font-semibold mb-3">
                                                    요청 사항
                                                </h3>
                                                <textarea
                                                    className="w-full min-h-[80px] bg-transparent text-[0.8rem] text-v3-dark placeholder:text-v3-text-muted resize-none outline-none"
                                                    placeholder="고객 요청 사항을 입력하세요..."
                                                />
                                            </div>
                                        </>
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
                                                    value={formatPrice(selectedClient.fullPrice)}
                                                />
                                                <InfoRow
                                                    label={t(locale, "clients.form.grant")}
                                                    value={formatPrice(selectedClient.grant)}
                                                />
                                                <InfoRow
                                                    label={t(locale, "clients.form.actual-price")}
                                                    value={formatPrice(selectedClient.actualPrice)}
                                                />
                                            </InfoCard>

                                            <InfoCard title={t(locale, "clients.form.section-flags")}>
                                                <div className="flex flex-wrap gap-2">
                                                    <StatusBadge
                                                        status={
                                                            selectedClient.voucherClient
                                                                ? "active"
                                                                : "expired"
                                                        }
                                                        label={t(locale, "clients.form.voucher-client")}
                                                    />
                                                    <StatusBadge
                                                        status={
                                                            selectedClient.careCenter
                                                                ? "active"
                                                                : "expired"
                                                        }
                                                        label={t(locale, "clients.form.care-center")}
                                                    />
                                                    <StatusBadge
                                                        status={
                                                            selectedClient.breastPump
                                                                ? "active"
                                                                : "expired"
                                                        }
                                                        label={t(locale, "clients.form.breast-pump")}
                                                    />
                                                </div>
                                            </InfoCard>
                                        </>
                                    )}

                                    <div
                                        data-component="clients-detail-actions"
                                        className="hidden lg:flex gap-3 pt-2"
                                    >
                                        <Button
                                            variant="outline"
                                            className="flex-1 rounded-full"
                                            onClick={() => handleDeleteRequest(selectedClient.id)}
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
                                </motion.div>
                            </AnimatePresence>
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
                onDelete={handleDeleteRequest}
            />

            <ConfirmActionModal
                open={deleteTargetClientId != null}
                title={t(locale, "common.delete")}
                description={t(locale, "clients.delete-confirm")}
                cancelLabel={t(locale, "common.cancel")}
                confirmLabel={t(locale, "common.delete")}
                loading={deleteClient.isPending}
                onOpenChange={(open) => {
                    if (!open && !deleteClient.isPending) {
                        setDeleteTargetClientId(null);
                    }
                }}
                onCancel={() => setDeleteTargetClientId(null)}
                onConfirm={handleDeleteConfirm}
            />

            <ClientFormDialog
                open={formDialogOpen}
                onClose={handleFormDialogClose}
                client={editingClient}
            />
        </section>
    );
}
