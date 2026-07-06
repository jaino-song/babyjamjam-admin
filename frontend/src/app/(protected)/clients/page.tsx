"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
    Workflow,
    Users,
    Calendar,
    CalendarDays,
    Plus,
    Clock,
    UserCheck,
    AlertTriangle,
    MoreVertical,
    Pencil,
    Trash2,
    FileSignature,
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
    useApproveScheduleChange,
    useClients,
    useDeleteClient,
    useRejectScheduleChange,
    useClient,
} from "@/features/clients/hooks/use-clients";
import type { Client, ServiceStatus } from "@/lib/client/types";
import {
    getClientBadgeAvatarClassName,
    getClientBadges,
    getPrimaryClientBadge,
    prioritizeClientBadges,
} from "@/lib/client/badges";
import { useToast } from "@/hooks/use-toast";
import { useAlimtalkHistory } from "@/features/alimtalk-triggers/hooks/use-alimtalk-triggers";
import type { AlimtalkHistoryRecord } from "@/features/alimtalk-triggers/types";
import {
    getMessageHistoryTimestamp,
    MessageHistoryDetailPanel,
    MESSAGE_HISTORY_STATUS_META,
    normalizeMessageHistoryRecord,
    type MessageHistoryRecord,
} from "@/components/app/messages/MessageHistoryDetailPanel";
import {
    CLIENT_FORM_STEPPER_STEPS,
    ClientFormDialog,
    ClientFormPanel,
} from "@/components/app/clients/ClientFormDialog";
import { ClientDetailModal } from "@/components/app/clients/ClientDetailModal";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
    AnimatedSlotListItemContent,
    HeaderActionButton,
    EmptyState,
    DetailEmptyState,
    PageSection,
    ListEmptyState,
    DetailTabPanels,
    DetailTabs,
    SectionNav,
    SteppedWizardStepper,
} from "@/components/app/v3";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { normalizeKoreanPhoneLookupKey } from "@/lib/phone";
import { matchesMessageHistoryClient } from "@/lib/message-history/client-match";

const FILTER_CHIPS = [
    { label: "전체", value: "all" },
    { label: "대기", value: "waiting" },
    { label: "교체 요청", value: "replacement_requested" },
    { label: "진행중", value: "active" },
    { label: "완료", value: "completed" },
    { label: "중단", value: "terminated" },
];

const CLIENT_SECTIONS = [
    { id: "list", label: "고객 목록", icon: Users },
    { id: "automation", label: "자동화", icon: Workflow },
] as const;

type ClientSectionId = (typeof CLIENT_SECTIONS)[number]["id"];

const CLIENT_DETAIL_TABS = [
    { key: "basic", label: "기본 정보" },
    { key: "contracts", label: "계약서 정보" },
    { key: "alimtalk", label: "메시지 발송 현황" },
] as const;

const SCHEDULE_CHANGE_DETAIL_TAB = { key: "schedule-change", label: "일정 변경" } as const;

type ClientDetailTabKey =
    | (typeof CLIENT_DETAIL_TABS)[number]["key"]
    | typeof SCHEDULE_CHANGE_DETAIL_TAB["key"];

type ClientAutomationItem = {
    id: "eformsign-auto-client-registration";
    title: string;
    subtitle: string;
    defaultEnabled: boolean;
    icon: typeof FileSignature;
};

const CLIENT_AUTOMATION_ITEMS: readonly ClientAutomationItem[] = [
    {
        id: "eformsign-auto-client-registration",
        title: "전자문서 자동 고객 등록",
        subtitle: "전자문서 생성 시 고객 정보가 자동으로 등록됩니다.",
        defaultEnabled: true,
        icon: FileSignature,
    },
];

const CLIENT_MESSAGE_HISTORY_LIMIT = 500;
const CLIENT_MESSAGE_DETAIL_SLIDE_DURATION_MS = 300;
const CLIENT_MESSAGE_HISTORY_LIST_STATUS_LABELS = {
    sent: "성공",
    failed: "실패",
    pending: "대기",
} satisfies Record<MessageHistoryRecord["status"], string>;

const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("ko-KR");
};

const formatScheduleChangeMonthDay = (dateStr: string): string => {
    const [, month, day] = dateStr.split("-");
    const monthNumber = Number(month);
    const dayNumber = Number(day);

    if (!month || !day || Number.isNaN(monthNumber) || Number.isNaN(dayNumber)) {
        return dateStr;
    }

    return `${monthNumber}월 ${dayNumber}일`;
};

const getScheduleChangeErrorCode = (error: unknown): string | null => {
    if (!error || typeof error !== "object" || !("response" in error)) {
        return null;
    }

    const response = error.response;
    if (!response || typeof response !== "object" || !("data" in response)) {
        return null;
    }

    const data = response.data;
    if (!data || typeof data !== "object" || !("code" in data)) {
        return null;
    }

    return typeof data.code === "string" ? data.code : null;
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

const filterValueToStatus = (filter: string): ServiceStatus | null => {
    switch (filter) {
        case "waiting":
            return "waiting";
        case "replacement_requested":
            return "replacement_requested";
        case "active":
            return "active";
        case "completed":
            return "completed";
        case "terminated":
            return "terminated";
        default:
            return null;
    }
};

function getClientMessageHistoryTime(record: AlimtalkHistoryRecord) {
    const timestamp = getMessageHistoryTimestamp(record);
    const time = new Date(timestamp).getTime();
    return Number.isNaN(time) ? 0 : time;
}

function ClientMessageHistoryList({
    records,
    canLookupMessages,
    isError,
    isLoading,
    clientName,
    selectedRecordId,
    onSelectRecord,
}: {
    records: AlimtalkHistoryRecord[];
    canLookupMessages: boolean;
    isError: boolean;
    isLoading: boolean;
    clientName: string;
    selectedRecordId: number | null;
    onSelectRecord: (record: AlimtalkHistoryRecord) => void;
}) {
    if (!canLookupMessages) {
        return (
            <DetailEmptyState
                name="clients-detail-messages-empty"
                message="고객 정보가 없어 메시지 발송 내역을 조회할 수 없습니다"
            />
        );
    }

    if (isLoading) {
        return (
            <div data-component="clients-detail-messages-skeleton-list" className="space-y-2">
                {[0, 1, 2].map((index) => (
                    <div
                        key={index}
                        data-component="clients-detail-messages-skeleton-item"
                        className="flex items-center gap-[calc(12px*var(--v3-ui-scale,1))] rounded-[18px] border-2 border-transparent bg-white p-[calc(16px*var(--v3-ui-scale,1))]"
                    >
                        <Skeleton className="h-[calc(44px*var(--v3-ui-scale,1))] w-[calc(44px*var(--v3-ui-scale,1))] shrink-0 rounded-[14px] bg-v3-dim-white" />
                        <div data-component="clients-detail-messages-skeleton-copy" className="min-w-0 flex-1 space-y-2">
                            <Skeleton className="h-[calc(16px*var(--v3-ui-scale,1))] w-[calc(96px*var(--v3-ui-scale,1))] bg-v3-dim-white" />
                            <Skeleton className="h-[calc(12px*var(--v3-ui-scale,1))] w-[calc(160px*var(--v3-ui-scale,1))] bg-v3-dim-white" />
                            <Skeleton className="h-[calc(12px*var(--v3-ui-scale,1))] w-[calc(208px*var(--v3-ui-scale,1))] bg-v3-dim-white" />
                        </div>
                        <div data-component="clients-detail-messages-skeleton-meta" className="ml-auto flex shrink-0 flex-col items-end gap-1">
                            <Skeleton className="h-[calc(24px*var(--v3-ui-scale,1))] w-[calc(56px*var(--v3-ui-scale,1))] rounded-full bg-v3-dim-white" />
                            <Skeleton className="h-[calc(12px*var(--v3-ui-scale,1))] w-[calc(80px*var(--v3-ui-scale,1))] bg-v3-dim-white" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (isError) {
        return (
            <div data-component="clients-detail-messages-error" className="text-center py-12 text-v3-text-muted text-[0.85rem]">
                메시지 발송 내역을 불러오지 못했습니다
            </div>
        );
    }

    if (records.length === 0) {
        return (
            <DetailEmptyState
                name="clients-detail-messages-empty"
                message="메시지 발송 내역이 없습니다"
            />
        );
    }

    return (
        <div data-component="clients-detail-messages-list">
            <AnimatedSlotList<AlimtalkHistoryRecord>
                items={records}
                isLoading={false}
                itemVariant="card"
                itemDataComponent="clients-detail-messages-list-item"
                getItemKey={(record) => String(record.id)}
                getSlotState={({ item }) => ({
                    isActive: item?.id === selectedRecordId,
                    isInteractive: Boolean(item),
                })}
                onSlotClick={(record) => onSelectRecord(record)}
                render={({ item: record }) => {
                    if (!record) return null;

                    const normalizedRecord = normalizeMessageHistoryRecord(record, {
                        recipientNameFallback: clientName,
                        recipientListLabelFallback: clientName,
                    });
                    const statusMeta = MESSAGE_HISTORY_STATUS_META[normalizedRecord.status] ?? MESSAGE_HISTORY_STATUS_META.failed;
                    const statusBorderClassName =
                        normalizedRecord.status === "sent"
                            ? "border-[hsl(137,34%,84%)]"
                            : normalizedRecord.status === "pending"
                                ? "border-amber-100"
                                : "border-red-100";
                    const ItemIcon = normalizedRecord.icon;

                    return (
                        <AnimatedSlotListItemContent
                            dataComponent="clients-detail-messages-list-item"
                            icon={ItemIcon}
                            iconContainerClassName="text-v3-primary"
                            title={normalizedRecord.title}
                            subtitle={normalizedRecord.messagePreview}
                            status={
                                <div
                                    data-component="clients-detail-messages-list-item-meta"
                                    className="flex shrink-0 flex-col items-end justify-end gap-1 text-right"
                                >
                                    <span
                                        data-component="clients-detail-messages-list-item-status"
                                        className={cn(
                                            "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[50px] border px-[calc(12px*var(--v3-ui-scale,1))] py-[calc(4px*var(--v3-ui-scale,1))] text-[calc(10.4px*var(--v3-ui-scale,1))] font-semibold whitespace-nowrap transition-colors",
                                            statusMeta.tone,
                                            statusBorderClassName
                                        )}
                                    >
                                        {CLIENT_MESSAGE_HISTORY_LIST_STATUS_LABELS[normalizedRecord.status]}
                                    </span>
                                </div>
                            }
                        />
                    );
                }}
            />
        </div>
    );
}

function ClientMessageDetailSlide({
    isMessageDetailActive,
    selectedRecord,
    onBack,
    children,
}: {
    isMessageDetailActive: boolean;
    selectedRecord: MessageHistoryRecord | null;
    onBack: () => void;
    children: ReactNode;
}) {
    const shouldRenderMessageDetail = selectedRecord !== null;

    return (
        <div
            data-component="clients-detail-message-slide"
            data-active-panel={isMessageDetailActive ? "message" : "client"}
            className="h-full min-h-0 overflow-hidden"
        >
            <div
                data-component="clients-detail-message-slide-track"
                className={cn(
                    "flex h-full min-h-0 gap-[var(--compact-panel-gap,16px)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none",
                )}
                style={{
                    transform: isMessageDetailActive
                        ? "translateX(calc(-100% - var(--compact-panel-gap, 16px)))"
                        : "translateX(0)",
                }}
            >
                <div
                    data-component="clients-detail-message-slide-panel"
                    data-panel="client"
                    aria-hidden={isMessageDetailActive}
                    className={cn("h-full min-h-0 w-full min-w-0 shrink-0", isMessageDetailActive && "pointer-events-none")}
                >
                    {children}
                </div>
                <div
                    data-component="clients-detail-message-slide-panel"
                    data-panel="message"
                    aria-hidden={!isMessageDetailActive}
                    className={cn(
                        "h-full min-h-0 w-full min-w-0 shrink-0",
                        !isMessageDetailActive && "pointer-events-none"
                    )}
                >
                    {shouldRenderMessageDetail ? (
                        <MessageHistoryDetailPanel
                            selectedRecord={selectedRecord}
                            backAction={{
                                label: "고객 상세로 돌아가기",
                                onClick: onBack,
                            }}
                            dataComponentPrefix="clients-message-history"
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function ClientAutomationSection() {
    const [selectedAutomationId, setSelectedAutomationId] = useState<ClientAutomationItem["id"] | null>(null);
    const [automationEnabledById, setAutomationEnabledById] = useState<Record<ClientAutomationItem["id"], boolean>>(() =>
        CLIENT_AUTOMATION_ITEMS.reduce(
            (acc, item) => ({
                ...acc,
                [item.id]: item.defaultEnabled,
            }),
            {} as Record<ClientAutomationItem["id"], boolean>,
        ),
    );
    const selectedAutomation =
        CLIENT_AUTOMATION_ITEMS.find((item) => item.id === selectedAutomationId) ?? null;
    const selectedAutomationEnabled = selectedAutomation
        ? automationEnabledById[selectedAutomation.id]
        : false;

    return (
        <section data-component="clients-automation-section" className="flex h-full min-h-0 flex-1 flex-col">
            <SplitLayout
                hasSelection={selectedAutomation !== null}
                onBack={() => setSelectedAutomationId(null)}
            >
                <ListPanel
                    title="고객 자동화"
                    subtitle="고객 등록과 문서 흐름을 자동화합니다."
                >
                    <div data-component="clients-automation-list" className="space-y-2">
                        <AnimatedSlotList<ClientAutomationItem>
                            items={CLIENT_AUTOMATION_ITEMS}
                            isLoading={false}
                            className="space-y-2"
                            getItemKey={(item) => item.id}
                            itemVariant="card"
                            getSlotState={({ item }) => ({
                                isActive: item?.id === selectedAutomationId,
                                isInteractive: Boolean(item),
                            })}
                            onSlotClick={(item) => setSelectedAutomationId(item.id)}
                            render={({ item }) => {
                                if (!item) return null;

                                return (
                                    <AnimatedSlotListItemContent
                                        dataComponent="clients-automation-item"
                                        icon={item.icon}
                                        iconContainerClassName="text-v3-primary"
                                        title={item.title}
                                        subtitle={item.subtitle}
                                        status={(
                                            <Switch
                                                data-component="clients-automation-item-toggle"
                                                aria-label={`${item.title} 사용`}
                                                checked={automationEnabledById[item.id]}
                                                onClick={(event) => event.stopPropagation()}
                                                onCheckedChange={(checked) =>
                                                    setAutomationEnabledById((current) => ({
                                                        ...current,
                                                        [item.id]: checked,
                                                    }))
                                                }
                                                className="ml-auto shrink-0"
                                            />
                                        )}
                                    />
                                );
                            }}
                        />
                    </div>
                </ListPanel>

                {selectedAutomation ? (
                    <DetailPanel
                        compactBackLabel="자동화 목록으로 돌아가기"
                        title={selectedAutomation.title}
                        subtitle={selectedAutomation.subtitle}
                    >
                        <InfoCard title="임시 안내">
                            <p data-component="clients-automation-detail-temporary-copy" className="text-[0.85rem] leading-6 text-v3-text-muted">
                                {selectedAutomationEnabled
                                    ? "전자문서 생성 시에 자동으로 고객이 등록됩니다."
                                    : "자동 고객 등록이 꺼져 있습니다."}
                            </p>
                        </InfoCard>
                    </DetailPanel>
                ) : (
                    <DetailPanel
                        overlay={(
                            <ListEmptyState
                                name="clients-automation-detail-empty"
                                icon={Workflow}
                                message="왼쪽 목록에서 자동화 항목을 선택해 주세요."
                                className="flex-none min-h-0"
                            />
                        )}
                    >
                        {null}
                    </DetailPanel>
                )}
            </SplitLayout>
        </section>
    );
}

export default function ClientsPage() {
    const locale = useLocale();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const clientIdParam = searchParams.get("id");
    const shouldOpenClientFormFromUrl = searchParams.get("openClientForm") === "1";

    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [isCreatingClient, setIsCreatingClient] = useState(false);
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState("all");
    const [detailTabState, setDetailTabState] = useState<{ key: ClientDetailTabKey; clientId: number | null }>({
        key: "basic",
        clientId: null,
    });
    const [activeSection, setActiveSection] = useState<ClientSectionId>("list");
    const [clientFormActiveStep, setClientFormActiveStep] = useState(0);
    const [selectedMessageHistoryId, setSelectedMessageHistoryId] = useState<number | null>(null);
    const [isMessageHistoryDetailVisible, setIsMessageHistoryDetailVisible] = useState(false);
    const clearMessageHistorySelectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [detailModalOpen, setDetailModalOpen] = useState(false);
    const clientDialogDraft = useClientDialogStore((state) => state.draft);
    const clearClientDialogDraft = useClientDialogStore((state) => state.clearDraft);


    const { data, isLoading } = useClients(1, 50);
    const deleteClient = useDeleteClient();
    const approveScheduleChange = useApproveScheduleChange();
    const rejectScheduleChange = useRejectScheduleChange();
    const {
        data: messageHistoryData = [],
        isLoading: isMessageHistoryLoading,
        isError: isMessageHistoryError,
    } = useAlimtalkHistory(CLIENT_MESSAGE_HISTORY_LIMIT);

    const { data: clientFromParam } = useClient(
        clientIdParam ? Number(clientIdParam) : 0
    );

    const activeSelectedClient = selectedClient ?? (clientIdParam ? clientFromParam ?? null : null);
    const panelFormClient = shouldOpenClientFormFromUrl ? clientDialogDraft?.client ?? null : null;
    const shouldShowClientFormPanel = isCreatingClient || shouldOpenClientFormFromUrl;
    const activeScheduleChange = activeSelectedClient?.pendingScheduleChange ?? null;
    const hasActiveScheduleChange = Boolean(activeScheduleChange);
    const activeClientDetailTabs = useMemo(
        () => hasActiveScheduleChange ? [SCHEDULE_CHANGE_DETAIL_TAB, ...CLIENT_DETAIL_TABS] : [...CLIENT_DETAIL_TABS],
        [hasActiveScheduleChange]
    );
    const activeSelectedClientBadges = useMemo(
        () => activeSelectedClient ? getClientBadges(activeSelectedClient) : [],
        [activeSelectedClient]
    );
    const activeSelectedClientPhoneKey = useMemo(
        () => normalizeKoreanPhoneLookupKey(activeSelectedClient?.phone ?? ""),
        [activeSelectedClient?.phone]
    );
    const activeSelectedClientId = activeSelectedClient?.id ?? null;

    const activeDetailTab = useMemo<ClientDetailTabKey>(() => {
        if (detailTabState.clientId !== activeSelectedClientId) {
            if (activeScheduleChange) {
                return "schedule-change";
            }

            return detailTabState.key === "schedule-change" ? "basic" : detailTabState.key;
        }

        if (detailTabState.key === "schedule-change" && !hasActiveScheduleChange) {
            return "basic";
        }

        return detailTabState.key;
    }, [activeScheduleChange, activeSelectedClientId, detailTabState, hasActiveScheduleChange]);

    const setActiveDetailTab = (key: ClientDetailTabKey, clientId: number | null = activeSelectedClientId) => {
        setDetailTabState({ key, clientId });
    };

    const clients = useMemo(() => data?.data || [], [data?.data]);
    const isScheduleChangeActionPending = approveScheduleChange.isPending || rejectScheduleChange.isPending;

    const activeClientMessageHistory = useMemo(
        () =>
            activeSelectedClientId !== null || activeSelectedClientPhoneKey
                ? messageHistoryData
                    .filter((record) => matchesMessageHistoryClient(record, activeSelectedClient))
                    .sort((left, right) => getClientMessageHistoryTime(right) - getClientMessageHistoryTime(left))
                : [],
        [activeSelectedClient, activeSelectedClientId, activeSelectedClientPhoneKey, messageHistoryData]
    );

    const selectedClientMessageRecord = useMemo(
        () =>
            selectedMessageHistoryId === null
                ? null
                : activeClientMessageHistory.find((record) => record.id === selectedMessageHistoryId) ?? null,
        [activeClientMessageHistory, selectedMessageHistoryId]
    );

    const selectedClientMessageDetailRecord = useMemo<MessageHistoryRecord | null>(() => {
        if (!selectedClientMessageRecord || !activeSelectedClient || activeDetailTab !== "alimtalk") {
            return null;
        }

        return normalizeMessageHistoryRecord(selectedClientMessageRecord, {
            recipientNameFallback: activeSelectedClient.name,
            recipientListLabelFallback: activeSelectedClient.name,
        });
    }, [activeDetailTab, activeSelectedClient, selectedClientMessageRecord]);

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
        const pendingCount = clients.filter((c) => c.serviceStatus === "waiting").length;

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
    useEffect(() => {
        return () => {
            if (clearMessageHistorySelectionTimeoutRef.current) {
                clearTimeout(clearMessageHistorySelectionTimeoutRef.current);
                clearMessageHistorySelectionTimeoutRef.current = null;
            }
        };
    }, []);

    const clearClientMessageHistoryDetail = () => {
        if (clearMessageHistorySelectionTimeoutRef.current) {
            clearTimeout(clearMessageHistorySelectionTimeoutRef.current);
            clearMessageHistorySelectionTimeoutRef.current = null;
        }

        setIsMessageHistoryDetailVisible(false);
        setSelectedMessageHistoryId(null);
    };

    const handleSelectClientMessageHistoryRecord = (record: AlimtalkHistoryRecord) => {
        if (clearMessageHistorySelectionTimeoutRef.current) {
            clearTimeout(clearMessageHistorySelectionTimeoutRef.current);
            clearMessageHistorySelectionTimeoutRef.current = null;
        }

        setSelectedMessageHistoryId(record.id);
        setIsMessageHistoryDetailVisible(true);
    };

    const handleClientMessageHistoryDetailBack = () => {
        if (clearMessageHistorySelectionTimeoutRef.current) {
            clearTimeout(clearMessageHistorySelectionTimeoutRef.current);
        }

        setIsMessageHistoryDetailVisible(false);
        clearMessageHistorySelectionTimeoutRef.current = setTimeout(() => {
            setSelectedMessageHistoryId(null);
            clearMessageHistorySelectionTimeoutRef.current = null;
        }, CLIENT_MESSAGE_DETAIL_SLIDE_DURATION_MS);
    };

    const handleSectionSelect = (sectionId: string) => {
        const nextSection = sectionId as ClientSectionId;
        setActiveSection(nextSection);

        if (nextSection === "automation") {
            clearClientDialogDraft();
            setIsCreatingClient(false);
            setSelectedClient(null);
            clearClientMessageHistoryDetail();
            setClientFormActiveStep(0);

            if (clientIdParam || shouldOpenClientFormFromUrl) {
                router.replace("/clients");
            }
        }
    };

    const handleAddNew = () => {
        setActiveSection("list");

        if (clientIdParam || shouldOpenClientFormFromUrl) {
            router.replace("/clients");
        }

        if (!shouldOpenClientFormFromUrl) {
            clearClientDialogDraft();
        }

        setSelectedClient(null);
        setEditingClient(null);
        setActiveDetailTab("basic");
        clearClientMessageHistoryDetail();
        setClientFormActiveStep(0);
        setIsCreatingClient(true);
    };

    const handleSelectClient = (client: Client) => {
        setActiveSection("list");

        if (clientIdParam || shouldOpenClientFormFromUrl) {
            router.replace("/clients");
        }

        clearClientDialogDraft();
        setIsCreatingClient(false);
        clearClientMessageHistoryDetail();
        setSelectedClient(client);
        if (client.pendingScheduleChange) {
            setActiveDetailTab("schedule-change", client.id);
        } else if (activeDetailTab === "schedule-change") {
            setActiveDetailTab("basic", client.id);
        }
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

    const clearSelectedClientScheduleChange = (clientId: number) => {
        setSelectedClient((currentClient) => {
            if (!currentClient || currentClient.id !== clientId) {
                return currentClient;
            }

            return { ...currentClient, pendingScheduleChange: null };
        });
    };

    const showScheduleChangeErrorToast = (error: unknown, fallbackMessage: string) => {
        toast({
            variant: "destructive",
            description: getScheduleChangeErrorCode(error) === "REQUEST_STALE"
                ? "요청이 최신 상태와 달라 만료되었습니다"
                : fallbackMessage,
        });
    };

    const handleApproveScheduleChange = async (client: Client) => {
        const pendingScheduleChange = client.pendingScheduleChange;
        if (!pendingScheduleChange) return;

        try {
            await approveScheduleChange.mutateAsync({
                requestId: pendingScheduleChange.id,
                clientId: client.id,
            });
            clearSelectedClientScheduleChange(client.id);
            setActiveDetailTab("basic");
            toast({ description: "일정 변경 요청을 승인했습니다." });
        } catch (error) {
            showScheduleChangeErrorToast(error, "일정 변경 요청 승인 중 오류가 발생했습니다.");
        }
    };

    const handleRejectScheduleChange = async (client: Client) => {
        const pendingScheduleChange = client.pendingScheduleChange;
        if (!pendingScheduleChange) return;

        try {
            await rejectScheduleChange.mutateAsync({
                requestId: pendingScheduleChange.id,
                clientId: client.id,
            });
            clearSelectedClientScheduleChange(client.id);
            setActiveDetailTab("basic");
            toast({ description: "일정 변경 요청을 거부했습니다." });
        } catch (error) {
            showScheduleChangeErrorToast(error, "일정 변경 요청 거부 중 오류가 발생했습니다.");
        }
    };

    const handleFormDialogClose = () => {
        setFormDialogOpen(false);
        setEditingClient(null);

        if (shouldOpenClientFormFromUrl) {
            router.replace("/clients");
        }
    };

    const handleClientFormPanelClose = () => {
        clearClientDialogDraft();
        setIsCreatingClient(false);
        setClientFormActiveStep(0);
        clearClientMessageHistoryDetail();

        if (shouldOpenClientFormFromUrl) {
            router.replace("/clients");
        }
    };

    const handleClientFormPanelSuccess = (client: Client) => {
        setIsCreatingClient(false);
        setSelectedClient(client);
        setActiveDetailTab("basic");
        setClientFormActiveStep(0);
        clearClientMessageHistoryDetail();

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

    const handleDetailTabChange = (nextTab: string) => {
        const nextDetailTab = activeClientDetailTabs.find((tab) => tab.key === nextTab)?.key;

        if (!nextDetailTab) return;
        if (nextDetailTab === activeDetailTab) return;

        setActiveDetailTab(nextDetailTab);
        if (nextDetailTab !== "alimtalk") {
            clearClientMessageHistoryDetail();
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

            <div data-component="clients-sections" className="flex flex-1 min-h-0 flex-col gap-4 lg:flex-row lg:items-stretch">
                <SectionNav
                    items={CLIENT_SECTIONS}
                    activeId={activeSection}
                    onSelect={handleSectionSelect}
                />

                <div data-component="clients-section-content" className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {activeSection === "list" ? (
                        <section data-component="clients-list-section" className="flex min-h-0 flex-1 flex-col">
                            <SplitLayout
                                hasSelection={shouldShowClientFormPanel || !!activeSelectedClient}
                                onBack={() => {
                                    if (shouldShowClientFormPanel) {
                                        handleClientFormPanelClose();
                                        return;
                                    }

                                    if (clientIdParam) {
                                        router.replace("/clients");
                                    }

                                    clearClientMessageHistoryDetail();
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
                            className={
                                shouldShowClientFormPanel
                                    ? "bg-v3-primary text-white hover:bg-v3-primary"
                                    : undefined
                            }
                        />
                    }
                    emptyState={!isLoading && filteredClients.length === 0 ? (
                        <ListEmptyState message={t(locale, "clients.no-data")} />
                    ) : undefined}
                >
                    <div data-component="clients-list-content" className="space-y-2">
                        <AnimatedSlotList<Client>
	                                    items={filteredClients}
	                                    isLoading={isLoading}
	                                    loadingCount={10}
	                                    className="space-y-2"
	                                    itemVariant="card"
	                                    getSlotState={({ item, isLoading }) => ({
	                                        isActive: !isLoading && item?.id === activeSelectedClient?.id,
	                                        isInteractive: !isLoading && Boolean(item),
	                                    })}
	                                    onSlotClick={(client) => handleSelectClient(client)}
	                                    render={({ item, isLoading }) => {
	                                        const client = item;
	                                        if (isLoading) {
	                                            return (
	                                                <>
	                                                    <div data-component="clients-list-item-avatar-skeleton" className="flex h-[calc(44px*var(--v3-ui-scale,1))] w-[calc(44px*var(--v3-ui-scale,1))] shrink-0 items-center justify-center rounded-[14px] bg-v3-dim-white shadow-md">
	                                                        <Skeleton className="h-[calc(20px*var(--v3-ui-scale,1))] w-[calc(20px*var(--v3-ui-scale,1))] rounded-md bg-white/70" />
	                                                    </div>
	                                                    <div data-component="clients-list-item-info-skeleton" className="flex-1 min-w-0">
	                                                        <Skeleton className="h-[calc(16px*var(--v3-ui-scale,1))] w-[calc(112px*var(--v3-ui-scale,1))] bg-v3-dim-white" />
	                                                        <Skeleton className="mt-[calc(6px*var(--v3-ui-scale,1))] h-[calc(12px*var(--v3-ui-scale,1))] w-[calc(192px*var(--v3-ui-scale,1))] bg-v3-dim-white" />
	                                                    </div>
	                                                    <Skeleton className="h-[calc(24px*var(--v3-ui-scale,1))] w-[calc(56px*var(--v3-ui-scale,1))] rounded-full bg-v3-dim-white" />
	                                                </>
	                                            );
	                                        }

	                                        if (!client) return null;
	                                        const clientBadges = getClientBadges(client);
	                                        const sortedClientBadges = prioritizeClientBadges(clientBadges);
	                                        const primaryClientBadge = getPrimaryClientBadge(clientBadges);

	                                        return (
	                                            <AnimatedSlotListItemContent
	                                                dataComponent="clients-list-item"
	                                                icon={Users}
	                                                iconContainerClassName={getClientBadgeAvatarClassName(primaryClientBadge)}
	                                                title={client.name}
	                                                subtitle={
	                                                    <>
	                                                        {client.phone ? <span>{client.phone}</span> : null}
	                                                        {client.address ? (
	                                                            <span className="truncate">
	                                                                {client.address.split(" ")[1] || client.address}
	                                                            </span>
	                                                        ) : null}
	                                                    </>
	                                                }
			                                                status={sortedClientBadges.map((badge, badgeIndex) => (
			                                                    <StatusBadge
			                                                        key={badge.key ?? `${badge.status}-${badge.label ?? badgeIndex}`}
			                                                        status={badge.status}
			                                                        label={badge.label}
			                                                    />
			                                                ))}
			                                            />
	                                        );
	                                    }}
	                                />
	                        </div>
	                </ListPanel>

                {shouldShowClientFormPanel ? (
                    <ClientFormPanel
                        client={panelFormClient}
                        onClose={handleClientFormPanelClose}
                        onSuccess={handleClientFormPanelSuccess}
                        activeStep={clientFormActiveStep}
                        onActiveStepChange={setClientFormActiveStep}
                        renderLayout={({ content, footer }) => (
                            <DetailPanel
                                compactBackLabel="고객 목록으로 돌아가기"
                                title={panelFormClient ? t(locale, "clients.form.edit-title") : t(locale, "clients.form.add-title")}
                                subtitle={
                                    panelFormClient
                                        ? "기본 정보, 담당 인력, 서비스 조건을 한 번에 수정합니다."
                                        : "고객의 기본 정보와 서비스 조건을 단계별로 입력합니다."
                                }
                                stepper={
                                    <SteppedWizardStepper
                                        steps={CLIENT_FORM_STEPPER_STEPS}
                                        currentStep={clientFormActiveStep}
                                    />
                                }
                                footer={footer}
                            >
                                {content}
                            </DetailPanel>
                        )}
                    />
                ) : activeSelectedClient ? (
                    <div
                        key={`clients-detail-${activeSelectedClient.id}`}
                        data-component="clients-detail-selection-slide-up"
                        className="h-full min-h-0 animate-v3-slide-up"
                    >
                        <ClientMessageDetailSlide
                            isMessageDetailActive={isMessageHistoryDetailVisible && selectedClientMessageDetailRecord !== null}
                            selectedRecord={selectedClientMessageDetailRecord}
                            onBack={handleClientMessageHistoryDetailBack}
                        >
                            <DetailPanel
                            compactBackLabel="고객 목록으로 돌아가기"
                            avatar={
                                <div
                                    data-component="clients-detail-avatar"
                                    className={cn(
                                        "w-16 h-16 rounded-[20px] flex items-center justify-center shadow-lg shrink-0",
                                        getClientBadgeAvatarClassName(getPrimaryClientBadge(activeSelectedClientBadges))
                                    )}
                                >
                                    <Users className="w-7 h-7 shrink-0 transition-colors text-current" aria-hidden="true" />
                                </div>
                            }
                            title={activeSelectedClient.name}
                            badges={
                                <>
                                    {activeSelectedClientBadges
                                        .filter((badge) => badge.key !== "breast_pump")
                                        .map((badge) => (
                                            <StatusBadge
                                                key={badge.key}
                                                status={badge.status}
                                                label={badge.label}
                                            />
                                        ))}
                                </>
                            }
                            badgesRight={
                                <>
                                    {activeSelectedClientBadges
                                        .filter((badge) => badge.key === "breast_pump")
                                        .map((badge) => (
                                            <StatusBadge
                                                key={badge.key}
                                                status={badge.status}
                                                label={badge.label}
                                            />
                                        ))}
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
                                    tabs={activeClientDetailTabs}
                                    activeTab={activeDetailTab}
                                    onTabChange={handleDetailTabChange}
                                />
                            }
                        >
                            <DetailTabPanels
                                activeTab={activeDetailTab}
                                dataComponent="clients-detail-content"
                                panelDataComponent="clients-detail-content-panel"
                                className="shrink-0"
                                panels={[
                                    ...(activeScheduleChange
                                        ? [
                                            {
                                                key: "schedule-change",
                                                children: (
                                                    <InfoCard
                                                        title="서비스 일정 변경 요청이 있습니다."
                                                        data-component="clients-detail-schedule-change-card"
                                                    >
                                                        <div
                                                            data-component="clients-detail-schedule-change-content"
                                                            className="space-y-[calc(12px*var(--v3-ui-scale,1))]"
                                                        >
                                                            <p className="text-[calc(14px*var(--v3-ui-scale,1))] font-semibold text-v3-dark">
                                                                기존 날짜: {formatScheduleChangeMonthDay(activeScheduleChange.fromDate)} → 변경 날짜: {formatScheduleChangeMonthDay(activeScheduleChange.toDate)}
                                                            </p>
                                                            <p className="text-[calc(13px*var(--v3-ui-scale,1))] text-v3-text-muted">
                                                                회차: {activeScheduleChange.sessionIndex}회차 · 종료일 {activeScheduleChange.oldEndDate} → {activeScheduleChange.newEndDate}
                                                            </p>
                                                            <div
                                                                data-component="clients-detail-schedule-change-actions"
                                                                className="flex justify-end gap-2"
                                                            >
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    size="sm"
                                                                    disabled={isScheduleChangeActionPending}
                                                                    onClick={() => void handleRejectScheduleChange(activeSelectedClient)}
                                                                >
                                                                    거부
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    variant="positive"
                                                                    size="sm"
                                                                    disabled={isScheduleChangeActionPending}
                                                                    onClick={() => void handleApproveScheduleChange(activeSelectedClient)}
                                                                >
                                                                    승인
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </InfoCard>
                                                ),
                                            },
                                        ]
                                        : []),
                                    {
                                        key: "basic",
                                        children: (
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
                                        ),
                                    },
                                    {
                                        key: "contracts",
                                        children: (
                                            <DetailEmptyState
                                                name="clients-detail-contracts-empty"
                                                message="계약서 정보가 없습니다"
                                            />
                                        ),
                                    },
                                    {
                                        key: "alimtalk",
                                        children: (
                                            <ClientMessageHistoryList
                                                records={activeClientMessageHistory}
                                                canLookupMessages={activeSelectedClientId !== null || activeSelectedClientPhoneKey.length > 0}
                                                isLoading={isMessageHistoryLoading}
                                                isError={isMessageHistoryError}
                                                clientName={activeSelectedClient.name}
                                                selectedRecordId={selectedMessageHistoryId}
                                                onSelectRecord={handleSelectClientMessageHistoryRecord}
                                            />
                                        ),
                                    },
                                ]}
                            />
                            </DetailPanel>
                        </ClientMessageDetailSlide>
                    </div>
                ) : (
                    <EmptyState name="clients-empty-state" icon={Users} message="고객을 선택하면 상세 정보가 표시됩니다" />
                )}
                            </SplitLayout>
                        </section>
                    ) : (
                        <ClientAutomationSection />
                    )}
                </div>
            </div>

                <ClientDetailModal
                    open={detailModalOpen}
                    onClose={handleDetailModalClose}
                    client={activeSelectedClient}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                />

            <ClientFormDialog
                open={formDialogOpen}
                onClose={handleFormDialogClose}
                client={editingClient ?? null}
            />
        </PageSection>
    );
}
