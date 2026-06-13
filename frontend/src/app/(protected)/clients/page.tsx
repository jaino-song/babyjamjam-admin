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
import { useClients, useDeleteClient, useClient } from "@/hooks/useClients";
import { Client, SERVICE_STATUS_OPTIONS, type ServiceStatus } from "@/lib/client/types";
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
    HeaderActionButton,
    EmptyState,
    PageSection,
    ListEmptyState,
    DetailTabPanels,
    DetailTabs,
    SectionNav,
    SteppedWizardStepper,
} from "@/components/app/v3";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { normalizeKoreanPhoneLookupKey } from "@/lib/phone";
import type { StatusType } from "@/components/app/v3";

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

type ClientDetailTabKey = (typeof CLIENT_DETAIL_TABS)[number]["key"];

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
            return "pending";
        case "replacement_requested":
            return "terminated";
        case "terminated":
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
    hasClientPhone,
    isError,
    isLoading,
    clientName,
    selectedRecordId,
    onSelectRecord,
}: {
    records: AlimtalkHistoryRecord[];
    hasClientPhone: boolean;
    isError: boolean;
    isLoading: boolean;
    clientName: string;
    selectedRecordId: number | null;
    onSelectRecord: (record: AlimtalkHistoryRecord) => void;
}) {
    if (!hasClientPhone) {
        return (
            <div data-component="clients-detail-messages-empty" className="text-center py-12 text-v3-text-muted text-[0.85rem]">
                고객 전화번호가 등록되어 있지 않습니다
            </div>
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
            <div data-component="clients-detail-messages-empty" className="text-center py-12 text-v3-text-muted text-[0.85rem]">
                메시지 발송 내역이 없습니다
            </div>
        );
    }

    return (
        <div data-component="clients-detail-messages-list" className="space-y-2">
            {records.map((record) => {
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
                const isSelected = selectedRecordId === record.id;

                return (
                    <button
                        key={record.id}
                        type="button"
                        data-component="clients-detail-messages-list-item"
                        aria-pressed={isSelected}
                        onClick={() => onSelectRecord(record)}
                        className={cn(
                            "flex min-h-[calc(94px*var(--v3-ui-scale,1))] w-full items-center gap-[calc(12px*var(--v3-ui-scale,1))] rounded-[18px] border-2 bg-white p-[calc(16px*var(--v3-ui-scale,1))] text-left transition-all duration-200",
                            isSelected
                                ? "border-v3-primary bg-v3-primary-light"
                                : "border-transparent hover:border-v3-primary/30 hover:bg-v3-primary-light/50"
                        )}
                    >
                        <div data-component="clients-detail-messages-list-item-icon" className="flex h-[calc(44px*var(--v3-ui-scale,1))] w-[calc(44px*var(--v3-ui-scale,1))] shrink-0 items-center justify-center rounded-[14px] bg-v3-dim-white text-v3-primary shadow-md">
                            <ItemIcon className="h-[calc(20px*var(--v3-ui-scale,1))] w-[calc(20px*var(--v3-ui-scale,1))]" />
                        </div>

                        <div data-component="clients-detail-messages-list-item-copy" className="min-w-0 flex-1">
                            <p className="truncate text-[calc(16px*var(--v3-ui-scale,1))] font-bold text-v3-dark">
                                {normalizedRecord.title}
                            </p>
                            <p className="mt-[calc(2px*var(--v3-ui-scale,1))] truncate text-[calc(14px*var(--v3-ui-scale,1))] text-v3-text-muted">
                                {normalizedRecord.messagePreview}
                            </p>
                        </div>

                        <div
                            data-component="clients-detail-messages-list-item-meta"
                            className="ml-auto flex shrink-0 flex-col items-end justify-end gap-1 text-right"
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
                    </button>
                );
            })}
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
                            slotClassName={({ item }) =>
                                cn(
                                    "flex min-h-[calc(94px*var(--v3-ui-scale,1))] items-center gap-[calc(12px*var(--v3-ui-scale,1))] rounded-[18px] border-2 p-[calc(16px*var(--v3-ui-scale,1))] text-left transition-all duration-200 cursor-pointer",
                                    item?.id === selectedAutomationId
                                        ? "border-v3-primary bg-v3-primary-light"
                                        : "border-transparent bg-white hover:border-v3-primary/30 hover:bg-v3-primary-light/50",
                                )
                            }
                            onSlotClick={(item) => setSelectedAutomationId(item.id)}
                            render={({ item }) => {
                                if (!item) return null;
                                const Icon = item.icon;

                                return (
                                    <>
                                        <div data-component="clients-automation-item-icon" className="flex h-[calc(44px*var(--v3-ui-scale,1))] w-[calc(44px*var(--v3-ui-scale,1))] shrink-0 items-center justify-center rounded-[14px] bg-v3-dim-white text-v3-primary shadow-md">
                                            <Icon className="h-[calc(20px*var(--v3-ui-scale,1))] w-[calc(20px*var(--v3-ui-scale,1))]" />
                                        </div>
                                        <div data-component="clients-automation-item-copy" className="min-w-0 flex-1">
                                            <p className="truncate text-[calc(13.6px*var(--v3-ui-scale,1))] font-bold text-v3-dark">{item.title}</p>
                                            <p className="mt-[calc(2px*var(--v3-ui-scale,1))] truncate text-[calc(11.2px*var(--v3-ui-scale,1))] text-v3-text-muted">{item.subtitle}</p>
                                        </div>
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
                                    </>
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
    const clientIdParam = searchParams.get("id");
    const shouldOpenClientFormFromUrl = searchParams.get("openClientForm") === "1";

    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [isCreatingClient, setIsCreatingClient] = useState(false);
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState("all");
    const [activeDetailTab, setActiveDetailTab] = useState<ClientDetailTabKey>("basic");
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
    const activeSelectedClientPhoneKey = useMemo(
        () => normalizeKoreanPhoneLookupKey(activeSelectedClient?.phone ?? ""),
        [activeSelectedClient?.phone]
    );

    const clients = useMemo(() => data?.data || [], [data?.data]);

    const activeClientMessageHistory = useMemo(
        () =>
            activeSelectedClientPhoneKey
                ? messageHistoryData
                    .filter((record) => normalizeKoreanPhoneLookupKey(record.receiver) === activeSelectedClientPhoneKey)
                    .sort((left, right) => getClientMessageHistoryTime(right) - getClientMessageHistoryTime(left))
                : [],
        [activeSelectedClientPhoneKey, messageHistoryData]
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
        const nextDetailTab = CLIENT_DETAIL_TABS.find((tab) => tab.key === nextTab)?.key;

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
	                                            "flex min-h-[calc(94px*var(--v3-ui-scale,1))] cursor-pointer items-center gap-[calc(12px*var(--v3-ui-scale,1))] rounded-[18px] border-2 border-transparent bg-white p-[calc(16px*var(--v3-ui-scale,1))] transition-all duration-200",
	                                            !isLoading &&
                                                item &&
                                                (activeSelectedClient?.id === item.id
	                                                    ? "border-v3-primary bg-v3-primary-light"
	                                                    : "hover:bg-v3-primary-light/50 hover:border-v3-primary/30")
	                                        )
	                                    }
	                                    onSlotClick={(client) => handleSelectClient(client)}
	                                    render={({ item, isLoading }) => {
	                                        const client = item;
	                                        return (
	                                            <>
	                                                {isLoading ? (
	                                                    <div data-component="clients-list-item-avatar-skeleton" className="flex h-[calc(44px*var(--v3-ui-scale,1))] w-[calc(44px*var(--v3-ui-scale,1))] shrink-0 items-center justify-center rounded-[14px] bg-v3-dim-white shadow-md">
	                                                        <Skeleton className="h-[calc(20px*var(--v3-ui-scale,1))] w-[calc(20px*var(--v3-ui-scale,1))] rounded-md bg-white/70" />
	                                                    </div>
	                                                ) : (
	                                                    client && (
                                                        <div
                                                            data-component="clients-list-item-avatar"
                                                            className={cn(
                                                                "flex h-[calc(44px*var(--v3-ui-scale,1))] w-[calc(44px*var(--v3-ui-scale,1))] shrink-0 items-center justify-center rounded-[14px] shadow-md",
                                                                getAvatarGradient(client.name)
                                                            )}
                                                        >
                                                            <Users className="h-[calc(20px*var(--v3-ui-scale,1))] w-[calc(20px*var(--v3-ui-scale,1))] shrink-0 transition-colors text-white" aria-hidden="true" />
                                                        </div>
	                                                    )
	                                                )}

	                                                <div data-component="clients-list-item-info" className="flex-1 min-w-0">
	                                                    <div data-component="clients-list-item-name-row" className="mb-[calc(2px*var(--v3-ui-scale,1))] flex items-center gap-[calc(8px*var(--v3-ui-scale,1))]">
	                                                        {isLoading ? (
	                                                            <>
	                                                                <Skeleton className="h-[calc(16px*var(--v3-ui-scale,1))] w-[calc(112px*var(--v3-ui-scale,1))] bg-v3-dim-white" />
	                                                            </>
	                                                        ) : (
	                                                            <>
	                                                                <span className="truncate text-[calc(16px*var(--v3-ui-scale,1))] font-bold text-v3-dark">
	                                                                    {client?.name}
	                                                                </span>
                                                            </>
                                                        )}
                                                    </div>

	                                                    {isLoading ? (
	                                                        <Skeleton className="h-[calc(12px*var(--v3-ui-scale,1))] w-[calc(192px*var(--v3-ui-scale,1))] bg-v3-dim-white" />
	                                                    ) : (
	                                                        <div data-component="clients-list-item-meta-row" className="flex items-center gap-[calc(8px*var(--v3-ui-scale,1))] truncate text-[calc(14px*var(--v3-ui-scale,1))] text-v3-text-muted">
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
	                                                        <Skeleton className="h-[calc(24px*var(--v3-ui-scale,1))] w-[calc(56px*var(--v3-ui-scale,1))] rounded-full bg-v3-dim-white" />
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
                                    tabs={[...CLIENT_DETAIL_TABS]}
                                    activeTab={activeDetailTab}
                                    onTabChange={handleDetailTabChange}
                                />
                            }
                        >
                            <div
                                data-component="clients-detail-content"
                                data-active-tab={activeDetailTab}
                                className="overflow-hidden"
                            >
                                <div
                                    data-component="clients-detail-content-track"
                                    className="flex transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none"
                                    style={{ transform: `translateX(-${activeDetailTabIndex * 100}%)` }}
                                >
                                    <section
                                        data-component="clients-detail-content-panel"
                                        data-panel="basic"
                                        aria-hidden={activeDetailTab !== "basic"}
                                        className={cn(
                                            "w-full min-w-0 shrink-0",
                                            activeDetailTab !== "basic" && "pointer-events-none",
                                            !visibleDetailTabs.includes("basic") && "max-h-0 overflow-hidden"
                                        )}
                                    >
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
                                    </section>

                                    <section
                                        data-component="clients-detail-content-panel"
                                        data-panel="contracts"
                                        aria-hidden={activeDetailTab !== "contracts"}
                                        className={cn(
                                            "w-full min-w-0 shrink-0",
                                            activeDetailTab !== "contracts" && "pointer-events-none",
                                            !visibleDetailTabs.includes("contracts") && "max-h-0 overflow-hidden"
                                        )}
                                    >
                                        <div data-component="clients-detail-contracts-empty" className="text-center py-12 text-v3-text-muted text-[0.85rem]">
                                            계약서 정보가 없습니다
                                        </div>
                                    </section>

                                    <section
                                        data-component="clients-detail-content-panel"
                                        data-panel="alimtalk"
                                        aria-hidden={activeDetailTab !== "alimtalk"}
                                        className={cn(
                                            "w-full min-w-0 shrink-0",
                                            activeDetailTab !== "alimtalk" && "pointer-events-none",
                                            !visibleDetailTabs.includes("alimtalk") && "max-h-0 overflow-hidden"
                                        )}
                                    >
                                        <ClientMessageHistoryList
                                            records={activeClientMessageHistory}
                                            hasClientPhone={activeSelectedClientPhoneKey.length > 0}
                                            isLoading={isMessageHistoryLoading}
                                            isError={isMessageHistoryError}
                                            clientName={activeSelectedClient.name}
                                            selectedRecordId={selectedMessageHistoryId}
                                            onSelectRecord={handleSelectClientMessageHistoryRecord}
                                        />
                                    </section>
                                </div>
                            </div>
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
