"use client";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import { normalizeApiError } from "@babyjamjam/shared";
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
    RotateCcw,
    Trash2,
    FileSignature,
    Send,
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveBranchId } from "@/features/system-templates/branch-context";
import {
    useClientDirectory,
    useClientListSummary,
    useDeleteClient,
    useClient,
} from "@/features/clients/hooks/use-clients";
import { useSendClientReceipt } from "@/features/clients/hooks/use-send-client-receipt";
import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { getScheduleChangeErrorMessage } from "@/features/service-records/utils/schedule-change-error";
import { useToast } from "@/hooks/use-toast";
import type { Client } from "@/lib/client/types";
import type { ClientListTab } from "@/features/clients/types";
import {
    getClientBadgeAvatarClassName,
    getClientBadges,
    getPrimaryClientBadge,
    prioritizeClientBadges,
} from "@/lib/client/badges";
import {
    CLIENT_FORM_STEPPER_STEPS,
    ClientFormDialog,
    ClientFormPanel,
} from "@/components/app/clients/ClientFormDialog";
import { MaternityContractDialog } from "@/components/app/clients/MaternityContractDialog";
import { canCreateNewContractDocument } from "@/components/app/contracts/ContractClientSelector";
import { ClientDetailPanel } from "@/components/app/clients/ClientDetailPanel";
import { getClientDisplayLabel } from "@/components/app/clients/client-display";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { AutomationStatusNotice } from "@/components/app/ui/automation-status-notice";
import { NotificationOneButtonModal } from "@/components/app/ui/NotificationOneButtonModal";
import { ClientDetailModal } from "@/components/app/clients/ClientDetailModal";
import { ServiceRecordLinkResetResultModal } from "@/components/app/clients/ServiceRecordLinkResetResultModal";
import { ServiceScheduleChangeModal } from "@/components/app/clients/ServiceScheduleChangeModal";
import { useLocale } from "@/providers/LocaleProvider";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { canManageBranchFromAuthQuery } from "@/lib/auth/branch-role-policy";
import { t } from "@/lib/i18n/translations";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
    StatsBar,
    SplitLayout,
    ListPanel,
    DetailPanel,
    InfoCard,
    StatusBadge,
    AnimatedSlotList,
    AnimatedSlotListItemContent,
    HeaderActionButton,
    EmptyState,
    PageSection,
    ListEmptyState,
    SectionNav,
    SteppedWizardStepper,
} from "@/components/app/v3";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { settingsApi, type ClientRegistrationPolicy } from "@/services/api";

const FILTER_CHIPS: Array<{ label: string; value: ClientListTab }> = [
    { label: "전체", value: "all" },
    { label: "예약 전", value: "pre_booking" },
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

type PendingCreateDiscardAction =
    | { type: "filter"; filter: ClientListTab }
    | { type: "select"; client: Client }
    | { type: "back" }
    | { type: "close" }
    | { type: "section"; section: ClientSectionId };

type ClientAutomationItem = {
    id: "eformsign-auto-client-registration";
    title: string;
    subtitle: string;
    icon: typeof FileSignature;
};

const CLIENT_AUTOMATION_ITEMS: readonly ClientAutomationItem[] = [
    {
        id: "eformsign-auto-client-registration",
        title: "전자문서 자동 고객 등록",
        subtitle: "eformsign 계약서가 도착하면 고객 정보가 자동으로 등록됩니다.",
        icon: FileSignature,
    },
];

const getTodayIsoDate = (): string => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

interface ServiceScheduleChangeTarget {
    scheduleId: number;
    sessionIndex: number;
    currentDate: string;
    minimumDate: string;
}

function ClientAutomationSection() {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { data: policy, isLoading } = useQuery({
        queryKey: ["settings", "client-registration-policy"],
        queryFn: settingsApi.getClientRegistrationPolicy,
    });
    const [selectedAutomationId, setSelectedAutomationId] = useState<ClientAutomationItem["id"] | null>(null);
    const updatePolicy = useMutation({
        mutationFn: settingsApi.updateClientRegistrationPolicy,
        onMutate: async ({ clientAutoRegistration }: { clientAutoRegistration?: boolean }) => {
            await queryClient.cancelQueries({ queryKey: ["settings", "client-registration-policy"] });
            const previous = queryClient.getQueryData<ClientRegistrationPolicy>(["settings", "client-registration-policy"]);
            queryClient.setQueryData<ClientRegistrationPolicy>(["settings", "client-registration-policy"], (current) =>
                current && clientAutoRegistration !== undefined ? { ...current, clientAutoRegistration } : current,
            );
            return { previous };
        },
        onError: (_error, _variables, context) => {
            if (context?.previous) queryClient.setQueryData(["settings", "client-registration-policy"], context.previous);
            // Registered problem message (verified) or locally authored copy — the
            // mutation outcome is surfaced, never silently swallowed.
            const normalized = normalizeApiError(_error, { locale: "ko-KR", operation: "mutation" });
            toast({ variant: "destructive", description: normalized.verified ? normalized.message : "고객 자동 등록 설정을 저장하지 못했어요" });
        },
        onSuccess: (saved) => queryClient.setQueryData(["settings", "client-registration-policy"], saved),
        onSettled: async () => { await queryClient.invalidateQueries({ queryKey: ["settings", "client-registration-policy"] }); },
    });
    const selectedAutomation =
        CLIENT_AUTOMATION_ITEMS.find((item) => item.id === selectedAutomationId) ?? null;
    const selectedAutomationEnabled = selectedAutomation ? policy?.clientAutoRegistration === true : false;

    return (
        <section
            data-component="desktop_clients_sections_section-content_automation-section"
            className="flex h-full min-h-0 flex-1 flex-col"
        >
            <SplitLayout data-component="desktop_clients_sections_section-content_automation-section_split-layout"
                hasSelection={selectedAutomation !== null}
                onBack={() => setSelectedAutomationId(null)}
            >
                <ListPanel data-component="desktop_clients_sections_section-content_automation-section_split-layout_list-panel"
                    title="고객 자동화"
                    subtitle="고객 등록과 문서 흐름을 자동화합니다."
                >
                    <div
                        data-component="desktop_clients_sections_section-content_automation-section_split-layout_list-panel_content"
                        className="space-y-2"
                    >
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
                                        data-component="desktop_clients_sections_section-content_automation-section_split-layout_list-panel_content_item"
                                        icon={item.icon}
                                        iconContainerClassName="text-v3-primary"
                                        title={item.title}
                                        subtitle={item.subtitle}
                                        status={(
                                            <Switch
                                                data-component="desktop_clients_sections_section-content_automation-section_split-layout_list-panel_content_item_toggle"
                                                aria-label={`${item.title} 사용`}
                                                checked={policy?.clientAutoRegistration === true}
                                                disabled={isLoading || updatePolicy.isPending}
                                                onClick={(event) => event.stopPropagation()}
                                                onCheckedChange={(checked) => updatePolicy.mutate({ clientAutoRegistration: checked })}
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
                    <DetailPanel data-component="desktop_clients_sections_section-content_automation-section_split-layout_detail-panel"
                        compactBackLabel="자동화 목록으로 돌아가기"
                        title={selectedAutomation.title}
                        subtitle={selectedAutomation.subtitle}
                    >
                        <InfoCard
                            data-component="desktop_clients_sections_section-content_automation-section_split-layout_detail-panel_info-card"
                            title="자동화 안내"
                        >
                            <AutomationStatusNotice
                                data-component="desktop_clients_sections_section-content_automation-section_split-layout_detail-panel_info-card_notice"
                                enabled={selectedAutomationEnabled}
                                automation={policy?.automation}
                            />
                        </InfoCard>
                    </DetailPanel>
                ) : (
                    <DetailPanel data-component="desktop_clients_sections_section-content_automation-section_split-layout_detail-panel-empty"
                        overlay={(
                            <ListEmptyState
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
    const authUserQuery = useGetAuthUser();
    const canManageBranchFeatures = canManageBranchFromAuthQuery(authUserQuery);
    const router = useRouter();
    const searchParams = useSearchParams();
    const activeBranchId = useActiveBranchId();
    const clientIdParam = searchParams.get("id");
    const shouldOpenClientFormFromUrl = searchParams.get("openClientForm") === "1";

    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [isCreatingClient, setIsCreatingClient] = useState(false);
    const [isCreateFormDirty, setIsCreateFormDirty] = useState(false);
    const [pendingCreateDiscard, setPendingCreateDiscard] = useState<PendingCreateDiscardAction | null>(null);
    const [urlSelectionSuppressed, setUrlSelectionSuppressed] = useState(false);
    const [formDialogOpen, setFormDialogOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [maternityContractClient, setMaternityContractClient] = useState<Client | null>(null);
    const [deleteTargetClientId, setDeleteTargetClientId] = useState<number | null>(null);
    const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
    const [resetLinkTargetClientId, setResetLinkTargetClientId] = useState<number | null>(null);
    const [resetServiceRecordUrl, setResetServiceRecordUrl] = useState<string | null>(null);
    const [isResettingLink, setIsResettingLink] = useState(false);
    const [scheduleChangeTarget, setScheduleChangeTarget] = useState<ServiceScheduleChangeTarget | null>(null);
    const [selectedScheduleChangeDate, setSelectedScheduleChangeDate] = useState("");
    const [isPreparingScheduleChange, setIsPreparingScheduleChange] = useState(false);
    const [isApplyingScheduleChange, setIsApplyingScheduleChange] = useState(false);
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState<ClientListTab>("all");
    const [activeSection, setActiveSection] = useState<ClientSectionId>("list");
    const [clientFormActiveStep, setClientFormActiveStep] = useState(0);
    const [detailModalOpen, setDetailModalOpen] = useState(false);

    const [debouncedSearchQuery] = useDebounce(searchQuery.trim(), 300);
    const isSearchSettled = searchQuery.trim() === debouncedSearchQuery;
    const directory = useClientDirectory({
        search: debouncedSearchQuery || undefined,
        tab: activeFilter,
        limit: 20,
    });
    const listSummary = useClientListSummary({
        search: debouncedSearchQuery || undefined,
    });
    const deleteClient = useDeleteClient();
    const { isSending: isSendingReceipt, sendReceipt } = useSendClientReceipt();
    const previousBranchIdRef = useRef<string | null | undefined>(undefined);
    const createdClientSelectionRef = useRef<Client | null>(null);

    const effectiveClientIdParam = urlSelectionSuppressed ? null : clientIdParam;
    const effectiveOpenClientForm = urlSelectionSuppressed ? false : shouldOpenClientFormFromUrl;

    const {
        data: clientFromParam,
        isBranchContextReady: isClientDetailBranchContextReady,
    } = useClient(
        effectiveClientIdParam ? Number(effectiveClientIdParam) : 0
    );

    const clients = useMemo(
        () => isSearchSettled && directory.isBranchContextReady ? directory.clients : [],
        [directory.clients, directory.isBranchContextReady, isSearchSettled],
    );
    const summary = isSearchSettled && listSummary.isBranchContextReady
        ? listSummary.data
        : undefined;
    const selectedClientFromList = useMemo(
        () =>
            selectedClient
                ? clients.find((client) => client.id === selectedClient.id) ?? selectedClient
                : null,
        [clients, selectedClient]
    );
    const clientFromParamList = useMemo(() => {
        if (!effectiveClientIdParam) return null;

        const parsedClientId = Number(effectiveClientIdParam);
        if (!Number.isFinite(parsedClientId)) return null;

        return clients.find((client) => client.id === parsedClientId) ?? null;
    }, [clients, effectiveClientIdParam]);
    const isBranchScopeStable = previousBranchIdRef.current === undefined
        || previousBranchIdRef.current === activeBranchId;
    const activeSelectedClient = directory.isBranchContextReady
        && isClientDetailBranchContextReady
        && isBranchScopeStable
        ? selectedClientFromList ?? (effectiveClientIdParam ? clientFromParamList ?? clientFromParam ?? null : null)
        : null;
    const panelFormClient = null;
    const shouldShowClientFormPanel = isCreatingClient || effectiveOpenClientForm;

    const summaryScopeLabel = searchQuery.trim()
        ? `현재 검색 범위: ${searchQuery.trim()}`
        : "현재 지점 전체";
    const isDirectoryInitialLoading = !isSearchSettled || directory.isInitialLoading;
    const isSummaryInitialLoading = !isSearchSettled || listSummary.isInitialLoading;
    const stats = {
        thisMonthCount: summary?.dueDate.thisMonth ?? "—",
        nextMonthCount: summary?.dueDate.nextMonth ?? "—",
        activeCount: summary?.byTab.active ?? "—",
        pendingCount: summary?.byTab.waiting ?? "—",
        endingSoonCount: summary?.serviceEnd.count ?? "—",
    };
    const clearClientSelectionSources = useCallback(() => {
        createdClientSelectionRef.current = null;
        setSelectedClient(null);
        setIsCreatingClient(false);
        setClientFormActiveStep(0);
        if (clientIdParam || shouldOpenClientFormFromUrl) {
            setUrlSelectionSuppressed(true);
            router.replace("/clients");
        }
    }, [clientIdParam, router, shouldOpenClientFormFromUrl]);
    useEffect(() => {
        if (urlSelectionSuppressed && !clientIdParam && !shouldOpenClientFormFromUrl) {
            setUrlSelectionSuppressed(false);
        }
    }, [clientIdParam, shouldOpenClientFormFromUrl, urlSelectionSuppressed]);
    useEffect(() => {
        const previousBranchId = previousBranchIdRef.current;
        if (previousBranchId !== undefined && previousBranchId !== null && previousBranchId !== activeBranchId) {
            clearClientSelectionSources();
            setIsCreateFormDirty(false);
            setPendingCreateDiscard(null);
        }
        previousBranchIdRef.current = activeBranchId;
    }, [activeBranchId, clearClientSelectionSources]);

    const applySectionChange = (nextSection: ClientSectionId) => {
        setActiveSection(nextSection);
        if (nextSection === "automation") {
            clearClientSelectionSources();
            setIsCreateFormDirty(false);
            setPendingCreateDiscard(null);
        }
    };

    const handleSectionSelect = (sectionId: string) => {
        if (formDialogOpen || pendingCreateDiscard !== null) return;

        const nextSection = CLIENT_SECTIONS.find((section) => section.id === sectionId)?.id;
        if (!nextSection || nextSection === activeSection) return;

        if (shouldShowClientFormPanel && isCreateFormDirty) {
            setPendingCreateDiscard({ type: "section", section: nextSection });
            return;
        }

        applySectionChange(nextSection);
    };

    const handleAddNew = () => {
        if (formDialogOpen || pendingCreateDiscard !== null) return;
        if (shouldShowClientFormPanel) return;

        setActiveSection("list");
        clearClientSelectionSources();
        setEditingClient(null);
        setIsCreateFormDirty(false);
        setPendingCreateDiscard(null);
        setIsCreatingClient(true);
    };

    const applyClientSelection = (client: Client) => {
        setActiveSection("list");
        clearClientSelectionSources();
        setSelectedClient(client);
        setIsCreateFormDirty(false);
        setPendingCreateDiscard(null);
    };

    const handleSelectClient = (client: Client) => {
        if (formDialogOpen || pendingCreateDiscard !== null) return;

        if (shouldShowClientFormPanel && isCreateFormDirty) {
            setPendingCreateDiscard({ type: "select", client });
            return;
        }

        applyClientSelection(client);
    };

    const handleEdit = (client: Client) => {
        setEditingClient(client);
        setFormDialogOpen(true);
    };

    const handleDeleteRequest = (id: number) => {
        setDeleteTargetClientId(id);
    };

    const handleResetServiceRecordLinkConfirm = async () => {
        if (resetLinkTargetClientId === null) return;

        setIsResettingLink(true);
        try {
            const overview = await serviceRecordsApi.getClientOverview(resetLinkTargetClientId);
            const assignments = overview.data.assignments ?? [];
            const activeAssignment = assignments.find((assignment) => !assignment.replaced)
                ?? assignments[0]
                ?? null;
            if (!activeAssignment) {
                toast({
                    description: "관리사 배정이 없어 링크를 재설정할 수 없어요",
                    variant: "destructive",
                });
                return;
            }

            const reset = await serviceRecordsApi.resetLink(activeAssignment.scheduleId);
            setResetLinkTargetClientId(null);
            setResetServiceRecordUrl(reset.data.serviceRecordUrl);
        } catch {
            toast({
                description: "제공기록지 링크를 재설정하지 못했어요. 잠시 후 다시 시도해 주세요",
                variant: "destructive",
            });
        } finally {
            setIsResettingLink(false);
        }
    };

    const handleOpenServiceScheduleChange = async (clientId: number) => {
        setIsPreparingScheduleChange(true);
        try {
            const overview = await serviceRecordsApi.getClientOverview(clientId);
            const assignments = overview.data.assignments ?? [];
            const activeAssignment = assignments.find((assignment) => !assignment.replaced)
                ?? assignments[0]
                ?? null;
            if (!activeAssignment) {
                toast({
                    description: "관리사 배정이 없어 서비스 일정을 변경할 수 없어요",
                    variant: "destructive",
                });
                return;
            }

            const preview = await serviceRecordsApi.previewScheduleChange(activeAssignment.scheduleId);
            const today = getTodayIsoDate();
            const minimumDate = preview.data.minimumDate > today
                ? preview.data.minimumDate
                : today;
            setSelectedScheduleChangeDate(minimumDate);
            setScheduleChangeTarget({
                scheduleId: activeAssignment.scheduleId,
                sessionIndex: preview.data.sessionIndex,
                currentDate: preview.data.fromDate,
                minimumDate,
            });
        } catch {
            toast({
                description: "변경할 수 있는 다음 서비스 일정을 불러오지 못했어요",
                variant: "destructive",
            });
        } finally {
            setIsPreparingScheduleChange(false);
        }
    };

    const handleApplyServiceScheduleChange = async () => {
        if (!scheduleChangeTarget) return;

        setIsApplyingScheduleChange(true);
        try {
            const changed = await serviceRecordsApi.applyScheduleChange(scheduleChangeTarget.scheduleId, {
                toDate: selectedScheduleChangeDate,
            });
            setSelectedClient((currentClient) => {
                if (!currentClient || currentClient.id !== changed.data.clientId) return currentClient;
                return {
                    ...currentClient,
                    endDate: changed.data.newEndDate,
                    pendingScheduleChange: null,
                };
            });
            setScheduleChangeTarget(null);
            setSelectedScheduleChangeDate("");
            await queryClient.invalidateQueries({ queryKey: ["clients"] });
            toast({
              variant: "success",
                description: `서비스 일정과 종료일(${changed.data.newEndDate})을 변경했어요`,
            });
        } catch (error) {
            toast({
                // Registered-code mapper output is policy-safe copy.
                description: getScheduleChangeErrorMessage(error),
                variant: "destructive",
            });
        } finally {
            setIsApplyingScheduleChange(false);
        }
    };

    const handleCopyResetServiceRecordLink = async (serviceRecordUrl: string) => {
        try {
            await navigator.clipboard.writeText(serviceRecordUrl);
            toast({ variant: "success", description: "제공기록지 링크를 복사했어요" });
        } catch {
            toast({
                description: "링크를 복사하지 못했어요. 링크를 직접 선택해 복사해 주세요",
                variant: "destructive",
            });
        }
    };

    const handleDeleteConfirm = async () => {
        if (deleteTargetClientId === null) return;

        const clientId = deleteTargetClientId;
        setDeleteTargetClientId(null);

        try {
            await deleteClient.mutateAsync(clientId);
            setSelectedClient((currentClient) => (
                currentClient?.id === clientId ? null : currentClient
            ));
        } catch (err) {
            console.error("Failed to delete client:", err);
            // Registered problem message (verified) or locally authored copy —
            // upstream body messages are never rendered.
            const normalized = normalizeApiError(err, { locale: "ko-KR", operation: "mutation" });
            setDeleteErrorMessage(
                normalized.verified ? normalized.message : "고객 삭제에 실패했어요. 다시 시도해 주세요.",
            );
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

    const applyFilterChange = (nextFilter: ClientListTab) => {
        setActiveFilter(nextFilter);
        clearClientSelectionSources();
        setIsCreateFormDirty(false);
        setPendingCreateDiscard(null);
    };

    const handleFilterChange = (nextFilter: string) => {
        if (formDialogOpen || pendingCreateDiscard !== null) return;

        const normalizedFilter = FILTER_CHIPS.find((item) => item.value === nextFilter)?.value;
        if (!normalizedFilter || normalizedFilter === activeFilter) return;

        if (shouldShowClientFormPanel && isCreateFormDirty) {
            setPendingCreateDiscard({ type: "filter", filter: normalizedFilter });
            return;
        }

        applyFilterChange(normalizedFilter);
    };

    const handleCompactBack = () => {
        if (formDialogOpen || pendingCreateDiscard !== null) return;

        if (shouldShowClientFormPanel) {
            if (isCreateFormDirty) {
                setPendingCreateDiscard({ type: "back" });
                return;
            }

            handleClientFormPanelClose();
            return;
        }

        clearClientSelectionSources();
    };

    const handleFormDialogClose = () => {
        setFormDialogOpen(false);
        setEditingClient(null);

        if (shouldOpenClientFormFromUrl) {
            router.replace("/clients");
        }
    };

    const handleClientFormDialogSuccess = (client: Client) => {
        setSelectedClient((currentClient) => {
            if (!currentClient || currentClient.id === client.id) {
                return client;
            }

            return currentClient;
        });
        setEditingClient((currentClient) => (
            currentClient?.id === client.id ? client : currentClient
        ));
    };

    const handleMaternityContractSuccess = async () => {
        await queryClient.invalidateQueries({ queryKey: ["clients"] });
    };

    const handleCreateFormDirtyChange = useCallback((dirty: boolean) => {
        setIsCreateFormDirty(dirty);
    }, []);

    const handleFormPanelBeforeClose = useCallback(() => {
        if (!isCreateFormDirty) return true;

        setPendingCreateDiscard({ type: "close" });
        return false;
    }, [isCreateFormDirty]);

    const handleClientFormPanelClose = () => {
        const createdClient = createdClientSelectionRef.current;
        createdClientSelectionRef.current = null;
        setIsCreatingClient(false);
        setClientFormActiveStep(0);
        setIsCreateFormDirty(false);
        setPendingCreateDiscard(null);

        if (createdClient) {
            setSelectedClient(createdClient);
            if (clientIdParam || shouldOpenClientFormFromUrl) {
                setUrlSelectionSuppressed(true);
                router.replace("/clients");
            }
            return;
        }

        clearClientSelectionSources();
    };

    const handleClientFormPanelSuccess = (client: Client) => {
        createdClientSelectionRef.current = client;
        setIsCreatingClient(false);
        setSelectedClient(client);
        setClientFormActiveStep(0);
        setIsCreateFormDirty(false);
        setPendingCreateDiscard(null);
    };

    const handleDiscardCreateDraft = () => {
        if (pendingCreateDiscard === null) return;

        const action = pendingCreateDiscard;
        setPendingCreateDiscard(null);
        setIsCreateFormDirty(false);

        if (action.type === "filter") {
            applyFilterChange(action.filter);
            return;
        }
        if (action.type === "section") {
            applySectionChange(action.section);
            return;
        }

        setIsCreatingClient(false);
        setClientFormActiveStep(0);
        if (action.type === "select") {
            setActiveSection("list");
            clearClientSelectionSources();
            setSelectedClient(action.client);
            return;
        }

        clearClientSelectionSources();
    };

    const handleDetailModalClose = () => {
        setDetailModalOpen(false);
        if (clientIdParam) {
            router.replace("/clients");
        }
    };

    const isDirectoryUnavailable = !directory.isBranchContextReady;
    const isDirectoryInitialError = isSearchSettled && directory.isInitialError;
    const isDirectoryRefreshError = isSearchSettled && directory.hasStaleData;
    const listSubHeader = isDirectoryRefreshError ? (
        <Alert variant="warning" data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_cached-data-error">
            <AlertTitle>고객 목록을 새로 불러오지 못했어요</AlertTitle>
            <AlertDescription>
                최근에 확인된 목록을 표시하고 있어요.
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_cached-data-error_retry"
                    className="mt-3"
                    aria-label="고객 목록 다시 시도"
                    onClick={() => void directory.refetch()}
                >
                    다시 시도
                </Button>
            </AlertDescription>
        </Alert>
    ) : undefined;

    return (
        <PageSection name="clients">
            {listSummary.isInitialError && isSearchSettled ? (
                <Alert variant="destructive" data-component="desktop_clients_summary_error">
                    <AlertTitle>고객 요약을 불러오지 못했어요</AlertTitle>
                    <AlertDescription>
                        현재 범위의 출산 예정일과 서비스 종료 수치를 확인할 수 없어요.
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-component="desktop_clients_summary_error_retry"
                            className="mt-3"
                            onClick={() => void listSummary.refetch()}
                        >
                            다시 시도
                        </Button>
                    </AlertDescription>
                </Alert>
            ) : null}
            {listSummary.isRefreshError && summary && isSearchSettled ? (
                <Alert variant="warning" data-component="desktop_clients_summary_stale">
                    <AlertTitle>고객 요약을 새로 불러오지 못했어요</AlertTitle>
                    <AlertDescription>
                        최근에 확인된 {summaryScopeLabel} 수치를 표시하고 있어요.
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-component="desktop_clients_summary_stale_retry"
                            className="mt-3"
                            onClick={() => void listSummary.refetch()}
                        >
                            다시 시도
                        </Button>
                    </AlertDescription>
                </Alert>
            ) : null}
            <StatsBar
                name="clients" density="responsive-square"
                isLoading={isSummaryInitialLoading}
                items={[
                    { icon: Calendar, value: stats.thisMonthCount, label: "이번 달 출산 예정", counter: "명" },
                    { icon: CalendarDays, value: stats.nextMonthCount, label: "다음 달 출산 예정", counter: "명", colorIndex: 1 },
                    { icon: UserCheck, value: stats.activeCount, label: "서비스 진행중", counter: "명", colorIndex: 2 },
                    { icon: Clock, value: stats.pendingCount, label: "서비스 대기중", counter: "명", colorIndex: 1 },
                    { icon: AlertTriangle, value: stats.endingSoonCount, label: "서비스 종료 예정", counter: "명", colorIndex: 3 },
                ]}
            />

            <div
                data-component="desktop_clients_sections"
                data-slot="clients-sections"
                className="flex flex-1 min-h-0 flex-col gap-4 lg:flex-row lg:items-stretch"
            >
                <SectionNav
                    data-component="desktop_clients_sections_section-nav"
                    items={CLIENT_SECTIONS}
                    activeId={activeSection}
                    onSelect={handleSectionSelect}
                />

                <div
                    data-component="desktop_clients_sections_section-content"
                    className="flex min-h-0 min-w-0 flex-1 flex-col"
                >
                    {activeSection === "list" ? (
                        <section
                            data-component="desktop_clients_sections_section-content_list-section"
                            className="flex min-h-0 flex-1 flex-col"
                        >
                            <SplitLayout data-component="desktop_clients_sections_section-content_list-section_split-layout"
                                hasSelection={shouldShowClientFormPanel || !!activeSelectedClient}
                                onBack={handleCompactBack}
                            >
                <ListPanel data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel"
                    title="고객 목록"
                    tabs={FILTER_CHIPS}
                    activeTab={activeFilter}
                    onTabChange={handleFilterChange}
                    searchValue={searchQuery}
                    onSearchChange={setSearchQuery}
                    searchPlaceholder={t(locale, "clients.search-placeholder")}
                    isLoading={isDirectoryInitialLoading}
                    subHeader={!isDirectoryUnavailable && !isDirectoryInitialError ? listSubHeader : undefined}
                    headerActions={
                        <HeaderActionButton
                            icon={Plus}
                            label={t(locale, "clients.add")}
                            onClick={handleAddNew}
                            data-testid="add-client-button"
                            data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_header_add"
                            className={
                                shouldShowClientFormPanel
                                    ? "max-w-full shrink-0 whitespace-nowrap bg-v3-primary px-[calc(10px*var(--glint-ui-scale,1))] text-white hover:bg-v3-primary"
                                    : undefined
                            }
                        />
                    }
                    emptyState={!isDirectoryInitialLoading && !isDirectoryUnavailable && directory.isSuccessfulEmpty ? (
                        <ListEmptyState icon={Users} message={t(locale, "clients.no-data")} />
                    ) : undefined}
                >
                    <div
                        data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_content"
                        className="space-y-2"
                    >
	                        {isDirectoryUnavailable ? (
	                            <Alert variant="info" data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_unavailable">
	                                <AlertTitle>고객 목록을 확인할 수 없어요</AlertTitle>
	                                <AlertDescription>현재 지점 정보를 확인한 뒤 다시 시도해 주세요.</AlertDescription>
	                            </Alert>
	                        ) : isDirectoryInitialError ? (
	                            <Alert
	                                variant="destructive"
	                                data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_error"
	                            >
	                                <AlertTitle>고객 목록을 불러오지 못했어요</AlertTitle>
	                                <AlertDescription>
	                                    잠시 후 다시 시도해 주세요.
	                                    <Button
	                                        type="button"
	                                        variant="outline"
	                                        size="sm"
	                                        data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_error_retry"
	                                        className="mt-3"
	                                        aria-label="고객 목록 다시 시도"
	                                        onClick={() => void directory.refetch()}
	                                    >
	                                        다시 시도
	                                    </Button>
	                                </AlertDescription>
	                            </Alert>
	                        ) : (
	                        <AnimatedSlotList<Client>
	                                    items={clients}
	                                    isLoading={isDirectoryInitialLoading}
	                                    loadingCount={10}
	                                    fetchingMoreCount={3}
	                                    className="space-y-2"
	                                    itemVariant="card"
	                                    getSlotState={({ item, isLoading }) => ({
	                                        isActive: !isLoading && item?.id === activeSelectedClient?.id,
	                                        isInteractive: !isLoading && Boolean(item),
	                                    })}
	                                    onSlotClick={(client) => handleSelectClient(client)}
	                                    hasMore={Boolean(directory.hasNextPage && !directory.isNextPageError)}
	                                    onLoadMore={() => void directory.fetchNextPage()}
	                                    isFetchingMore={directory.isFetchingNextPage}
	                                    render={({ item, isLoading }) => {
	                                        const client = item;
	                                        if (isLoading) {
	                                            return (
	                                                <>
	                                                    <div data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_content_item_avatar-skeleton" className="flex h-[calc(44px*var(--glint-ui-scale,1))] w-[calc(44px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[14px] bg-v3-dim-white shadow-md">
	                                                        <Skeleton className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))] rounded-md bg-white/70" />
	                                                    </div>
	                                                    <div data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_content_item_info-skeleton" className="flex-1 min-w-0">
	                                                        <Skeleton className="h-[calc(16px*var(--glint-ui-scale,1))] w-[calc(112px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
	                                                        <Skeleton className="mt-[calc(6px*var(--glint-ui-scale,1))] h-[calc(12px*var(--glint-ui-scale,1))] w-[calc(192px*var(--glint-ui-scale,1))] bg-v3-dim-white" />
	                                                    </div>
	                                                    <Skeleton className="h-[calc(24px*var(--glint-ui-scale,1))] w-[calc(56px*var(--glint-ui-scale,1))] rounded-full bg-v3-dim-white" />
	                                                </>
	                                            );
	                                        }

	                                        if (!client) return null;
	                                        const clientBadges = getClientBadges(client);
	                                        const sortedClientBadges = prioritizeClientBadges(clientBadges);
	                                        const primaryClientBadge = getPrimaryClientBadge(clientBadges);
                                            const [firstClientBadge, ...remainingClientBadges] = sortedClientBadges;

	                                        return (
	                                            <AnimatedSlotListItemContent
	                                                data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_content_item"
	                                                icon={Users}
	                                                iconContainerClassName={getClientBadgeAvatarClassName(primaryClientBadge)}
	                                                title={client.name}
	                                                subtitle={
	                                                    <>
	                                                        {client.phone ? <span>{formatKoreanPhoneNumber(client.phone)}</span> : null}
	                                                        {client.address ? (
	                                                            <span className="truncate">
	                                                                {client.address.split(" ")[1] || client.address}
	                                                            </span>
	                                                        ) : null}
	                                                    </>
	                                                }
                                                    status={firstClientBadge ? (
                                                        <div className="flex items-center gap-[calc(4px*var(--glint-ui-scale,1))]">
                                                            <StatusBadge
                                                                status={firstClientBadge.status}
                                                                label={
                                                                    firstClientBadge.label
                                                                        ? getClientDisplayLabel(firstClientBadge.label)
                                                                        : undefined
                                                                }
                                                            />
                                                            {remainingClientBadges.length > 0 ? (
                                                                <span
                                                                    data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_content_item_status-more"
                                                                    className="shrink-0 text-[calc(10.4px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted"
                                                                >
                                                                    +{remainingClientBadges.length}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                    ) : undefined}
			                                            />
	                                        );
	                                    }}
	                                />
                        )}
                        {directory.isNextPageError ? (
                            <Alert variant="warning" data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_next-page-error">
                                <AlertTitle>고객 목록을 더 불러오지 못했어요</AlertTitle>
                                <AlertDescription>
                                    현재 {clients.length}명까지 표시하고 있어요. 마지막 페이지인지 확인하지 못했어요.
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_next-page-error_retry"
                                        className="mt-3"
                                        aria-label="고객 목록 더 불러오기 다시 시도"
                                        onClick={() => void directory.fetchNextPage()}
                                    >
                                        다시 시도
                                    </Button>
                                </AlertDescription>
                            </Alert>
                        ) : null}
                        {directory.isEndOfList && clients.length > 0 ? (
                            <span data-component="desktop_clients_sections_section-content_list-section_split-layout_list-panel_end-of-list">
                                모든 검색 결과를 불러왔어요.
                            </span>
                        ) : null}
	                        </div>
	                </ListPanel>

                {shouldShowClientFormPanel ? (
                    <ClientFormPanel
                        data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-panel_form-panel"
                        client={panelFormClient}
                        onClose={handleClientFormPanelClose}
                        onBeforeClose={handleFormPanelBeforeClose}
                        onDirtyChange={handleCreateFormDirtyChange}
                        onSuccess={handleClientFormPanelSuccess}
                        activeStep={clientFormActiveStep}
                        onActiveStepChange={setClientFormActiveStep}
                        renderLayout={({ content, footer }) => (
                            <DetailPanel data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-panel-form"
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
                        data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection"
                        className="h-full min-h-0 animate-v3-slide-up"
                    >
                        <ClientDetailPanel
                            client={activeSelectedClient}
                            dataComponentPrefix="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel"
                            messageHistoryDataComponentPrefix="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_message-history"
                            compactBackLabel="고객 목록으로 돌아가기"
                            onScheduleChangeDecided={clearSelectedClientScheduleChange}
                            trailing={
                                // Avoid overlapping Radix modal layers when an action opens a dialog.
                                <DropdownMenu modal={false}>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            aria-label="고객 작업 메뉴 열기"
                                            className="focus-visible:ring-0 focus-visible:ring-offset-0"
                                        >
                                            <MoreVertical className="h-5 w-5 text-v3-text-muted" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="min-w-[140px]">
                                        <DropdownMenuItem onClick={() => handleEdit(activeSelectedClient)} className="gap-2">
                                            <Pencil className="w-4 h-4" />
                                            {t(locale, "common.edit")}
                                        </DropdownMenuItem>
                                        {canCreateNewContractDocument(activeSelectedClient) && (
                                            <DropdownMenuItem
                                                data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_header_menu_create-maternity-contract"
                                                onClick={() => setMaternityContractClient(activeSelectedClient)}
                                                className="gap-2"
                                            >
                                                <FileSignature className="w-4 h-4" />
                                                산모 계약서 생성
                                            </DropdownMenuItem>
                                        )}
                                        {canManageBranchFeatures && (
                                            <DropdownMenuItem
                                                asChild
                                                data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_header_menu_view-service-record"
                                            >
                                                <a
                                                    href={`/service-record-admin/${encodeURIComponent(String(activeSelectedClient.id))}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="w-full"
                                                >
                                                    <FileSignature className="w-4 h-4" />
                                                    제공기록지 보기
                                                </a>
                                            </DropdownMenuItem>
                                        )}
                                        <DropdownMenuItem
                                            data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_header_menu_send-copayment-receipt"
                                            disabled={isSendingReceipt}
                                            onClick={() => void sendReceipt(activeSelectedClient.id)}
                                            className="gap-2"
                                        >
                                            <Send className="w-4 h-4" />
                                            {isSendingReceipt ? "영수증 발송 중..." : "본인부담금 영수증 발송"}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_header_menu_change-service-schedule"
                                            disabled={isPreparingScheduleChange}
                                            onClick={() => void handleOpenServiceScheduleChange(activeSelectedClient.id)}
                                            className="gap-2"
                                        >
                                            <CalendarDays className="w-4 h-4" />
                                            서비스 일정 변경
                                        </DropdownMenuItem>
                                        {canManageBranchFeatures && (
                                            <DropdownMenuItem
                                                data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_header_menu_reset-service-record-link"
                                                onClick={() => setResetLinkTargetClientId(activeSelectedClient.id)}
                                                className="gap-2"
                                            >
                                                <RotateCcw className="w-4 h-4" />
                                                제공기록지 링크 재설정
                                            </DropdownMenuItem>
                                        )}
                                        <DropdownMenuItem
                                            data-component="desktop_clients_sections_section-content_list-section_split-layout_detail-selection_detail-panel_header_menu_delete"
                                            onClick={() => handleDeleteRequest(activeSelectedClient.id)}
                                            variant="destructive"
                                            className="gap-2"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                            {t(locale, "common.delete")}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            }
                        />
                    </div>
                ) : (
                    <EmptyState
                        icon={Users}
                        message="고객을 선택하면 상세 정보가 표시됩니다"
                    />
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
                    onDelete={handleDeleteRequest}
                />

            <ClientFormDialog
                data-component="desktop_clients_form-dialog"
                open={formDialogOpen}
                onClose={handleFormDialogClose}
                client={editingClient ?? null}
                onSuccess={handleClientFormDialogSuccess}
            />

            {maternityContractClient ? (
                <MaternityContractDialog
                    open
                    client={maternityContractClient}
                    onClose={() => setMaternityContractClient(null)}
                    onSuccess={() => void handleMaternityContractSuccess()}
                />
            ) : null}

            <TwoButtonModal
                open={resetLinkTargetClientId !== null}
                onOpenChange={(open) => {
                    if (!open && !isResettingLink) setResetLinkTargetClientId(null);
                }}
                data-component="desktop_clients_modals_reset-service-record-link-approval"
                title="제공기록지 링크를 재설정하시겠습니까?"
                description="기존 링크는 만료되고 새 링크가 생성돼요. 메시지는 발송되지 않아요."
                isDescriptionVisuallyHidden={false}
                approvalLabel="링크 재설정"
                pendingLabel="재설정 중..."
                isPending={isResettingLink}
                onApprove={() => void handleResetServiceRecordLinkConfirm()}
            />

            <ServiceRecordLinkResetResultModal
                open={resetServiceRecordUrl !== null}
                serviceRecordUrl={resetServiceRecordUrl ?? ""}
                onClose={() => setResetServiceRecordUrl(null)}
                onCopy={(serviceRecordUrl) => void handleCopyResetServiceRecordLink(serviceRecordUrl)}
            />

            {scheduleChangeTarget ? (
                <ServiceScheduleChangeModal
                    open
                    sessionIndex={scheduleChangeTarget.sessionIndex}
                    currentDate={scheduleChangeTarget.currentDate}
                    minimumDate={scheduleChangeTarget.minimumDate}
                    selectedDate={selectedScheduleChangeDate}
                    isPending={isApplyingScheduleChange}
                    onDateChange={setSelectedScheduleChangeDate}
                    onClose={() => {
                        setScheduleChangeTarget(null);
                        setSelectedScheduleChangeDate("");
                    }}
                    onSubmit={() => void handleApplyServiceScheduleChange()}
                />
            ) : null}

            <TwoButtonModal
                open={deleteTargetClientId !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTargetClientId(null);
                }}
                data-component="desktop_clients_modals_delete-approval"
                title={t(locale, "clients.delete-confirm")}
                description="삭제한 고객 정보는 복구할 수 없어요."
                approvalLabel={t(locale, "common.delete")}
                pendingLabel="삭제 중..."
                approvalVariant="destructive"
                isPending={deleteClient.isPending}
                onApprove={() => void handleDeleteConfirm()}
            />

            <TwoButtonModal
                open={pendingCreateDiscard !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingCreateDiscard(null);
                }}
                data-component="desktop_clients_modals_create-discard-approval"
                title="작성 중인 고객 정보를 버리시겠습니까?"
                description="입력한 내용은 저장되지 않습니다."
                approvalLabel="버리기"
                onApprove={handleDiscardCreateDraft}
            />

            <NotificationOneButtonModal
                open={deleteErrorMessage !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteErrorMessage(null);
                }}
                data-component="desktop_clients_modals_delete-error-notification"
                title="고객을 삭제하지 못했습니다."
                description={deleteErrorMessage ?? ""}
                isDescriptionVisuallyHidden={false}
                onAcknowledge={() => setDeleteErrorMessage(null)}
            />
        </PageSection>
    );
}
