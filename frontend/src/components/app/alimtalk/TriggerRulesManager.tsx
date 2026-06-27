"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BellRing,
  CalendarClock,
  CalendarRange,
  Plus,
  Save,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import {
  SplitLayout,
  ListPanel,
  DetailPanel,
  DetailSkeleton,
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  HeaderActionButton,
  ListEmptyState,
  SteppedWizardPanelContent,
  SteppedWizardPanelFooter,
  DetailTabs,
  DetailTabPanels,
  type SplitLayoutMode,
} from "@/components/app/v3";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { TitleSelectMolecule } from "@/components/ui/title-select-molecule";
import { TitleTextInputMolecule } from "@/components/ui/title-text-input-molecule";
import { cn } from "@/lib/utils";
import { settingsApi, type AlimtalkProvider } from "@/services/api";
import { useToast } from "@/hooks/use-toast";
import {
  useAlimtalkTriggerRules,
  useAlimtalkTriggerTemplates,
  useCreateAlimtalkTriggerRule,
  useUpdateAlimtalkTriggerRule,
  useDeleteAlimtalkTriggerRule,
} from "@/features/alimtalk-triggers/hooks/use-alimtalk-triggers";
import {
  deriveAvailableTemplates,
  deriveEventTypesFromTemplates,
  deriveRecipientTypesFromTemplates,
  getChannelTemplates,
  isTriggerRuleInChannel,
  type TriggerMessageChannel,
} from "@/features/alimtalk-triggers/channel";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { serviceInfoMsgTemplate } from "@/components/app/messages/templates/messageTemplate/serviceInfoMsg";
import { AlimtalkPhonePreview } from "./AlimtalkPhonePreview";
import type {
  AlimtalkTriggerRule,
  CreateAlimtalkTriggerRuleDto,
  TriggerEventType,
  TriggerOffsetType,
  TriggerRecipientType,
  TriggerTemplateKey,
} from "@/features/alimtalk-triggers/types";

const RETRY_POLICY_SELECTION_ID = "retry-policy";

type RuleSelection = string | "new" | null;
type RuleStatusFilter = "active" | "inactive";
type TriggerRuleDetailTab = "settings" | "preview";

type RuleFormState = CreateAlimtalkTriggerRuleDto;

type TriggerRuleListItem = {
  kind: "trigger-rule";
  id: string;
  title: string;
  subtitle: string;
  active: boolean;
  icon: typeof BellRing;
  rule: AlimtalkTriggerRule;
};

type RetryPolicyListItem = {
  kind: "retry-policy";
  id: typeof RETRY_POLICY_SELECTION_ID;
  title: string;
  subtitle: string;
  active: boolean;
  icon: typeof CalendarClock;
};

type RuleListItem = TriggerRuleListItem | RetryPolicyListItem;

const EVENT_OPTIONS: Array<{ value: TriggerEventType; label: string; icon: typeof BellRing }> = [
  { value: "CLIENT_CREATED", label: "고객 등록", icon: UserPlus },
  { value: "SERVICE_START", label: "서비스 시작", icon: CalendarClock },
  { value: "SERVICE_END", label: "서비스 종료", icon: CalendarRange },
  { value: "EMPLOYEE_ASSIGNED", label: "직원 배정", icon: Users },
];

const OFFSET_OPTIONS: Record<TriggerEventType, Array<{ value: TriggerOffsetType; label: string }>> = {
  CLIENT_CREATED: [
    { value: "IMMEDIATE", label: "즉시 발송" },
    { value: "AFTER_DAYS", label: "등록 후 N일" },
  ],
  SERVICE_START: [
    { value: "SAME_DAY", label: "시작 당일" },
    { value: "BEFORE_DAYS", label: "시작 N일 전" },
    { value: "AFTER_DAYS", label: "시작 N일 후" },
  ],
  SERVICE_END: [
    { value: "SAME_DAY", label: "종료 당일" },
    { value: "BEFORE_DAYS", label: "종료 N일 전" },
    { value: "AFTER_DAYS", label: "종료 N일 후" },
  ],
  EMPLOYEE_ASSIGNED: [{ value: "IMMEDIATE", label: "즉시 발송" }],
};

// Recipient labels are presentation-only (the catalog carries recipient *types*, not Korean
// labels). Which recipients are valid for an event is derived from the template catalog.
const RECIPIENT_LABELS: Record<TriggerRecipientType, string> = {
  CLIENT: "고객",
  PRIMARY_EMPLOYEE: "주 담당 직원",
  SECONDARY_EMPLOYEE: "보조 직원",
};

const RECIPIENT_TYPE_ORDER = Object.keys(RECIPIENT_LABELS) as TriggerRecipientType[];

const DEFAULT_FORM_STATE: RuleFormState = {
  name: "",
  isActive: true,
  eventType: "CLIENT_CREATED",
  offsetType: "IMMEDIATE",
  offsetDays: 0,
  recipientType: "CLIENT",
  templateKey: "CLIENT_WELCOME",
};

function getDefaultFormState(channel: TriggerMessageChannel): RuleFormState {
  if (channel === "sms") {
    return {
      name: "",
      isActive: true,
      eventType: "SERVICE_START",
      offsetType: "BEFORE_DAYS",
      offsetDays: 7,
      recipientType: "CLIENT",
      templateKey: "SERVICE_INFO",
    };
  }

  return DEFAULT_FORM_STATE;
}

const RULE_STATUS_TABS = [
  { label: "활성화", value: "active" },
  { label: "비활성화", value: "inactive" },
] as const;

const CHANNEL_COPY: Record<
  TriggerMessageChannel,
  {
    listTitle: string;
    listSubtitle: string;
    detailSubtitle: string;
    emptySelection: string;
    retryTitle: string;
    retryDescription: string;
  }
> = {
  sms: {
    listTitle: "SMS 발송 규칙",
    listSubtitle: "SMS 자동 발송 규칙을 설정할 수 있어요",
    detailSubtitle: "이벤트 시점, 수신자, SMS 템플릿을 조합해 자동 발송 동작을 정의합니다.",
    emptySelection: "왼쪽 목록에서 SMS 규칙을 선택하거나 새 규칙을 만들어 주세요.",
    retryTitle: "SMS 재시도 규칙",
    retryDescription: "SMS 전송 실패 시 5분 후 자동 재시도하며, 최초 발송 이후 최대 2번까지 다시 시도합니다.",
  },
  alimtalk: {
    listTitle: "알림톡 발송 규칙",
    listSubtitle: "알림톡 자동 발송 규칙을 설정할 수 있어요",
    detailSubtitle: "이벤트 시점, 수신자, 알림톡 템플릿을 조합해 자동 발송 동작을 정의합니다.",
    emptySelection: "왼쪽 목록에서 알림톡 규칙을 선택하거나 새 규칙을 만들어 주세요.",
    retryTitle: "알림톡 재시도 규칙",
    retryDescription: "알림톡 전송 실패 시 5분 후 자동 재시도하며, 최초 발송 이후 최대 2번까지 다시 시도합니다.",
  },
};

const TRIGGER_RULE_DETAIL_TABS = [
  { key: "settings", label: "규칙 설정" },
  { key: "preview", label: "미리보기" },
] satisfies Array<{ key: TriggerRuleDetailTab; label: string }>;

const TRIGGER_RULE_APPROVAL_MESSAGE =
  "메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요.";

const TRIGGER_TEMPLATE_MESSAGE_FALLBACKS: Record<TriggerTemplateKey, string> = {
  CLIENT_WELCOME: `[아이미래 인천]
#{고객명}님, 등록이 완료되었습니다.

등록일: #{등록일}
서비스: #{서비스타입}

문의사항은 채널톡으로 연락주세요.`,
  SERVICE_START_REMINDER: `[아이미래 인천]
#{고객명}님, #{발송기준}입니다.

서비스 시작일: #{서비스시작일}

준비사항이나 문의사항이 있으시면 연락주세요.`,
  SERVICE_INFO: serviceInfoMsgTemplate({ name: "{{name}}" }),
  SERVICE_END_REMINDER: `[아이미래 인천]
#{고객명}님, #{발송기준}입니다.

서비스 종료일: #{서비스종료일}

필요한 사항이 있으면 언제든지 연락주세요.`,
  EMPLOYEE_ASSIGNED: `[아이미래 인천]
#{직원명}님, 새로운 배정이 등록되었습니다.

고객명: #{고객명}
서비스 시작일: #{서비스시작일}

세부 내용을 확인해 주세요.`,
  CLIENT_GREETING: `[아이미래 인천]
#{고객명}님, 안녕하세요.

저희 아이미래에 등록해 주셔서 감사합니다.
앞으로 잘 부탁드립니다.

문의사항이 있으시면 언제든지 연락주세요.`,
};

function toFormState(rule: AlimtalkTriggerRule | null, channel: TriggerMessageChannel = "alimtalk"): RuleFormState {
  if (!rule) return getDefaultFormState(channel);
  return {
    name: rule.name,
    isActive: rule.isActive,
    eventType: rule.eventType,
    offsetType: rule.offsetType,
    offsetDays: rule.offsetDays,
    recipientType: rule.recipientType,
    templateKey: rule.templateKey,
  };
}

function normalizeDto(dto: RuleFormState): CreateAlimtalkTriggerRuleDto {
  return {
    ...dto,
    offsetDays:
      dto.offsetType === "BEFORE_DAYS" || dto.offsetType === "AFTER_DAYS"
        ? Number(dto.offsetDays || 0)
        : 0,
  };
}

function getRuleSummary(rule: RuleFormState) {
  const eventLabel = EVENT_OPTIONS.find((option) => option.value === rule.eventType)?.label ?? rule.eventType;
  const recipientLabel = RECIPIENT_LABELS[rule.recipientType] ?? rule.recipientType;

  let timingLabel = OFFSET_OPTIONS[rule.eventType].find((option) => option.value === rule.offsetType)?.label ?? rule.offsetType;
  if (rule.offsetType === "BEFORE_DAYS" || rule.offsetType === "AFTER_DAYS") {
    timingLabel = `${timingLabel.replace("N", String(rule.offsetDays || 0))}`;
  }

  return `${eventLabel} · ${timingLabel} · ${recipientLabel}`;
}

function getRuleIcon(eventType: TriggerEventType) {
  return EVENT_OPTIONS.find((option) => option.value === eventType)?.icon ?? BellRing;
}

function TriggerRulesDetailSkeleton({ dataComponentPrefix = "alimtalk" }: { dataComponentPrefix?: string }) {
  return (
    <DetailSkeleton
      name={`${dataComponentPrefix}-trigger-rules-detail-skeleton`}
      headerActions={1}
      headerBanner
      sections={[
        { titleWidth: "w-24", rows: ["w-2/3"] },
        { titleWidth: "w-20", rows: ["w-full", "w-full"] },
        { titleWidth: "w-20", rows: ["w-5/6", "w-2/3"] },
      ]}
    />
  );
}

export function TriggerRulesManager({
  dataComponentPrefix = "alimtalk",
  channel = dataComponentPrefix === "message" ? "sms" : "alimtalk",
}: {
  dataComponentPrefix?: string;
  channel?: TriggerMessageChannel;
} = {}) {
  const { toast } = useToast();
  const [selectedRuleId, setSelectedRuleId] = useState<RuleSelection>(null);
  const [isRuleDetailDismissed, setIsRuleDetailDismissed] = useState(false);
  const [splitLayoutMode, setSplitLayoutMode] = useState<SplitLayoutMode | null>(null);
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>("active");
  const [activeDetailTab, setActiveDetailTab] = useState<TriggerRuleDetailTab>("settings");
  const [formState, setFormState] = useState<RuleFormState>(() => getDefaultFormState(channel));
  const [isRetryPolicyEnabled, setIsRetryPolicyEnabled] = useState(true);
  const component = (suffix: string) => `${dataComponentPrefix}-${suffix}`;
  const isCompactSplitLayout = splitLayoutMode === "compact";
  const copy = CHANNEL_COPY[channel];

  const { data: rulesData = [], isLoading } = useAlimtalkTriggerRules();
  const createMutation = useCreateAlimtalkTriggerRule();
  const updateMutation = useUpdateAlimtalkTriggerRule();
  const deleteMutation = useDeleteAlimtalkTriggerRule();

  const rules = useMemo(() => (Array.isArray(rulesData) ? rulesData : []), [rulesData]);

  const { data: providerSettings } = useQuery({
    queryKey: ["settings", "alimtalk-provider"],
    queryFn: settingsApi.getAlimtalkProvider,
  });
  const { data: senderApproval, isLoading: isSenderApprovalLoading } = useQuery({
    queryKey: ["settings", "message-sender-approval"],
    queryFn: settingsApi.getMessageSenderApproval,
  });
  const isTriggerRulesLocked = !isSenderApprovalLoading && senderApproval?.isApproved === false;
  const effectiveSelectedRuleId = isTriggerRulesLocked ? null : selectedRuleId;
  const isRetryPolicySelected = effectiveSelectedRuleId === RETRY_POLICY_SELECTION_ID;

  const resolvedProvider: Exclude<AlimtalkProvider, "none"> =
    providerSettings?.provider === "channeltalk" ? "channeltalk" : "aligo";

  const selectedRule =
    effectiveSelectedRuleId && effectiveSelectedRuleId !== "new" && effectiveSelectedRuleId !== RETRY_POLICY_SELECTION_ID
      ? rules.find((rule) => rule.id === effectiveSelectedRuleId) ?? null
      : null;

  // Fetch ALL templates for the provider in one query (no event/recipient filter), then derive
  // the event / recipient / template dropdowns from the catalog so future templates surface
  // automatically. Derivation is channel-generic — it works for both the SMS and 알림톡 forms.
  const templateQuery = useAlimtalkTriggerTemplates({ provider: resolvedProvider });
  const selectedSystemTemplateKey =
    formState.templateKey === "SERVICE_INFO"
      ? "SERVICE_INFO"
      : formState.templateKey === "CLIENT_GREETING"
      ? "GREETING"
      : "";
  const { data: selectedSystemTemplate } = useSystemTemplate(selectedSystemTemplateKey);

  const channelTemplates = useMemo(
    () => getChannelTemplates(templateQuery.data ?? [], channel),
    [channel, templateQuery.data],
  );

  const eventOptions = useMemo(() => {
    const allowedEvents = new Set(deriveEventTypesFromTemplates(channelTemplates));
    return EVENT_OPTIONS.filter((option) => allowedEvents.has(option.value));
  }, [channelTemplates]);

  const getRecipientTypesForEvent = useCallback(
    (eventType: TriggerEventType): TriggerRecipientType[] => {
      const allowed = new Set(deriveRecipientTypesFromTemplates(channelTemplates, eventType));
      return RECIPIENT_TYPE_ORDER.filter((recipientType) => allowed.has(recipientType));
    },
    [channelTemplates],
  );

  const recipientOptions = useMemo(
    () =>
      getRecipientTypesForEvent(formState.eventType).map((recipientType) => ({
        value: recipientType,
        label: RECIPIENT_LABELS[recipientType],
      })),
    [getRecipientTypesForEvent, formState.eventType],
  );

  const availableTemplates = useMemo(
    () => deriveAvailableTemplates(channelTemplates, formState.eventType, formState.recipientType),
    [channelTemplates, formState.eventType, formState.recipientType],
  );
  const selectedTemplate = useMemo(() => {
    return availableTemplates.find((template) => template.key === formState.templateKey) ?? null;
  }, [availableTemplates, formState.templateKey]);
  const selectedTemplateMessage = selectedSystemTemplate?.content?.trim()
    ? selectedSystemTemplate.content
    : TRIGGER_TEMPLATE_MESSAGE_FALLBACKS[formState.templateKey];
  const shouldShowRetryPolicy = isRetryPolicyEnabled === (statusFilter === "active");
  const filteredRules = useMemo(() => {
    return rules.filter((rule) =>
      rule.isActive === (statusFilter === "active") &&
      isTriggerRuleInChannel(rule, channel)
    );
  }, [channel, rules, statusFilter]);

  useEffect(() => {
    if (isTriggerRulesLocked) return;

    if (selectedRuleId === "new") return;
    if (selectedRuleId === RETRY_POLICY_SELECTION_ID) {
      if (shouldShowRetryPolicy) return;
      setSelectedRuleId(splitLayoutMode === "desktop" && !isRuleDetailDismissed ? (filteredRules[0]?.id ?? null) : null);
      return;
    }
    if (selectedRuleId === null && filteredRules.length > 0) {
      if (splitLayoutMode === null) return;
      if (isCompactSplitLayout) return;
      if (isRuleDetailDismissed) return;
      setSelectedRuleId(filteredRules[0].id);
      return;
    }
    if (!selectedRuleId) return;

    const existsInRules = rules.some((rule) => rule.id === selectedRuleId);
    if (!existsInRules) {
      setSelectedRuleId(splitLayoutMode === "desktop" && !isRuleDetailDismissed ? (filteredRules[0]?.id ?? null) : null);
      return;
    }

    const existsInFilteredRules = filteredRules.some((rule) => rule.id === selectedRuleId);
    if (!existsInFilteredRules) {
      setSelectedRuleId(splitLayoutMode === "desktop" && !isRuleDetailDismissed ? (filteredRules[0]?.id ?? null) : null);
    }
  }, [
    filteredRules,
    isCompactSplitLayout,
    isRuleDetailDismissed,
    isTriggerRulesLocked,
    rules,
    selectedRuleId,
    shouldShowRetryPolicy,
    splitLayoutMode,
  ]);

  useEffect(() => {
    if (effectiveSelectedRuleId === RETRY_POLICY_SELECTION_ID) return;
    if (effectiveSelectedRuleId === "new") {
      setFormState(getDefaultFormState(channel));
      return;
    }
    setFormState(toFormState(selectedRule, channel));
  }, [channel, effectiveSelectedRuleId, selectedRule]);

  useEffect(() => {
    // Wait until the catalog has loaded before reconciling the form against derived options.
    if (eventOptions.length === 0) return;

    if (!eventOptions.some((option) => option.value === formState.eventType)) {
      setFormState(getDefaultFormState(channel));
      return;
    }

    const allowedRecipients = getRecipientTypesForEvent(formState.eventType);
    if (allowedRecipients.length > 0 && !allowedRecipients.includes(formState.recipientType)) {
      const nextRecipient = allowedRecipients[0];
      setFormState((current) => ({
        ...current,
        recipientType: nextRecipient,
      }));
    }

    const allowedOffsets = OFFSET_OPTIONS[formState.eventType];
    if (!allowedOffsets.some((option) => option.value === formState.offsetType)) {
      setFormState((current) => ({
        ...current,
        offsetType: allowedOffsets[0].value,
        offsetDays: 0,
      }));
    }
  }, [
    channel,
    eventOptions,
    getRecipientTypesForEvent,
    formState.eventType,
    formState.recipientType,
    formState.offsetType,
  ]);

  useEffect(() => {
    if (availableTemplates.length === 0) return;
    if (!availableTemplates.some((template) => template.key === formState.templateKey)) {
      setFormState((current) => ({
        ...current,
        templateKey: availableTemplates[0].key,
      }));
    }
  }, [availableTemplates, formState.templateKey]);

  const listItems = useMemo<RuleListItem[]>(() => {
    const retryPolicyItem: RetryPolicyListItem = {
      kind: "retry-policy",
      id: RETRY_POLICY_SELECTION_ID,
      title: copy.retryTitle,
      subtitle: copy.retryDescription,
      active: isRetryPolicyEnabled,
      icon: CalendarClock,
    };

    return [
      ...(shouldShowRetryPolicy ? [retryPolicyItem] : []),
      ...filteredRules.map((rule): TriggerRuleListItem => ({
        kind: "trigger-rule",
        id: rule.id,
        title: rule.name,
        subtitle: getRuleSummary(toFormState(rule, channel)),
        active: rule.isActive,
        icon: getRuleIcon(rule.eventType),
        rule,
      })),
    ];
  }, [channel, copy.retryDescription, copy.retryTitle, filteredRules, isRetryPolicyEnabled, shouldShowRetryPolicy]);

  const hasChanges = useMemo(() => {
    if (effectiveSelectedRuleId === RETRY_POLICY_SELECTION_ID) return false;
    if (effectiveSelectedRuleId === "new") {
      return !!formState.name.trim();
    }
    if (!selectedRule) return false;
    return JSON.stringify(normalizeDto(formState)) !== JSON.stringify(normalizeDto(toFormState(selectedRule, channel)));
  }, [channel, effectiveSelectedRuleId, formState, selectedRule]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const handleCreateNew = () => {
    if (isTriggerRulesLocked) return;
    setIsRuleDetailDismissed(false);
    setStatusFilter("active");
    setSelectedRuleId("new");
    setFormState(getDefaultFormState(channel));
  };

  const handleRuleSelect = (ruleId: string) => {
    setIsRuleDetailDismissed(false);
    setSelectedRuleId(ruleId);
  };

  const handleRetryPolicySelect = () => {
    setIsRuleDetailDismissed(false);
    setSelectedRuleId(RETRY_POLICY_SELECTION_ID);
  };

  const handleRetryPolicyToggle = (checked: boolean) => {
    setIsRetryPolicyEnabled(checked);
  };

  const handleRuleActiveToggle = async (rule: AlimtalkTriggerRule, checked: boolean) => {
    if (isTriggerRulesLocked) return;

    const dto = normalizeDto({
      ...toFormState(rule, channel),
      isActive: checked,
    });

    try {
      await updateMutation.mutateAsync({ id: rule.id, dto });
      if (effectiveSelectedRuleId === rule.id) {
        setFormState((current) => ({ ...current, isActive: checked }));
      }
      toast({ description: checked ? "발송 규칙이 활성화되었습니다." : "발송 규칙이 비활성화되었습니다." });
    } catch {
      toast({ variant: "destructive", description: "규칙 상태 변경 중 오류가 발생했습니다." });
    }
  };

  const handleBackToRuleList = () => {
    setIsRuleDetailDismissed(true);
    setSelectedRuleId(null);
  };

  const handleSave = async () => {
    if (isTriggerRulesLocked) return;
    const dto = normalizeDto(formState);

    if (!dto.name.trim()) {
      toast({ variant: "destructive", description: "규칙 이름을 입력해 주세요." });
      return;
    }

    if ((dto.offsetType === "BEFORE_DAYS" || dto.offsetType === "AFTER_DAYS") && (!dto.offsetDays || dto.offsetDays < 1)) {
      toast({ variant: "destructive", description: "일수는 1 이상이어야 합니다." });
      return;
    }

    try {
      if (selectedRuleId === "new" || !selectedRule) {
        const created = await createMutation.mutateAsync(dto);
        setSelectedRuleId(created.id);
        toast({ description: "발송 규칙이 생성되었습니다." });
      } else {
        await updateMutation.mutateAsync({ id: selectedRule.id, dto });
        toast({ description: "발송 규칙이 저장되었습니다." });
      }
    } catch {
      toast({ variant: "destructive", description: "규칙 저장 중 오류가 발생했습니다." });
    }
  };

  const handleDelete = async () => {
    if (isTriggerRulesLocked) return;
    if (!selectedRule) return;
    try {
      await deleteMutation.mutateAsync(selectedRule.id);
      setSelectedRuleId(null);
      toast({ description: "발송 규칙이 삭제되었습니다." });
    } catch {
      toast({ variant: "destructive", description: "규칙 삭제 중 오류가 발생했습니다." });
    }
  };
  return (
    <section
      data-component={component("trigger-rules")}
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <div data-component={component("trigger-rules-layout")} className="flex h-full min-h-0 flex-1 flex-col">
        <SplitLayout
          hasSelection={effectiveSelectedRuleId !== null}
          onBack={handleBackToRuleList}
          onModeChange={setSplitLayoutMode}
        >
          <ListPanel
            title={isLoading ? "" : copy.listTitle}
            subtitle={isLoading ? undefined : copy.listSubtitle}
            tabs={RULE_STATUS_TABS.map((tab) => ({ ...tab }))}
            activeTab={statusFilter}
            onTabChange={isTriggerRulesLocked ? undefined : (value) => setStatusFilter(value as RuleStatusFilter)}
            disabled={isTriggerRulesLocked}
            disabledOverlay={isTriggerRulesLocked ? (
              <div
                data-component={component("trigger-rules-disabled-copy")}
                className="max-w-[240px] rounded-[18px] border border-v3-burgundy/15 bg-white/90 px-4 py-3 text-center text-[0.78rem] font-semibold leading-5 text-v3-burgundy shadow-sm"
              >
                {TRIGGER_RULE_APPROVAL_MESSAGE}
              </div>
            ) : undefined}
            headerActions={isLoading || isTriggerRulesLocked ? undefined : (
              <HeaderActionButton
                icon={Plus}
                label="새 규칙"
                onClick={handleCreateNew}
                data-component={component("trigger-rules-new")}
              />
            )}
          >
            <>
              {(isLoading || listItems.length > 0) ? (
                <div data-component={component("trigger-rules-list")} className="space-y-2 pb-2">
                  <AnimatedSlotList<RuleListItem>
                    items={listItems}
                    isLoading={isLoading}
                    loadingCount={5}
                    className="space-y-2"
                    getSlotState={({ item, isLoading: slotLoading }) => ({
                      isActive: !slotLoading && item?.id === effectiveSelectedRuleId,
                      isInteractive: !slotLoading && Boolean(item),
                    })}
                    onSlotClick={(item) => {
                      if (item.kind === "retry-policy") {
                        handleRetryPolicySelect();
                        return;
                      }

                      handleRuleSelect(item.id);
                    }}
                    getItemKey={(item) => item.id}
                    render={({ item, isLoading: slotLoading }) => {
                      if (slotLoading) {
                        return (
                          <>
                            <div data-component={component("trigger-rule-skeleton-icon")} className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-v3-dim-white">
                              <Skeleton className="h-4 w-4 rounded-md bg-white/70" />
                            </div>
                            <div data-component={component("trigger-rule-skeleton-text")} className="min-w-0 flex-1">
                              <Skeleton className="h-4 w-32 bg-v3-dim-white" />
                              <Skeleton className="mt-2 h-3 w-44 bg-v3-dim-white" />
                            </div>
                          </>
                        );
                      }

                      if (!item) return null;

                      if (item.kind === "retry-policy") {
                        return (
                          <AnimatedSlotListItemContent
                            dataComponent={component("trigger-rules-retry-policy")}
                            icon={item.icon}
                            title={item.title}
                            subtitle={item.subtitle}
                            status={
                              <Switch
                                aria-label={`${item.title} 활성화`}
                                checked={item.active}
                                onClick={(event) => event.stopPropagation()}
                                onCheckedChange={handleRetryPolicyToggle}
                                className="ml-auto shrink-0"
                              />
                            }
                          />
                        );
                      }

                      return (
                        <AnimatedSlotListItemContent
                          dataComponent={component("trigger-rule")}
                          icon={item.icon}
                          title={item.title}
                          subtitle={item.subtitle}
                          status={
                            <Switch
                              aria-label={`${item.title} 활성화`}
                              checked={item.active}
                              disabled={isTriggerRulesLocked || updateMutation.isPending}
                              onClick={(event) => event.stopPropagation()}
                              onCheckedChange={(checked) => {
                                void handleRuleActiveToggle(item.rule, checked);
                              }}
                              className="ml-auto shrink-0"
                            />
                          }
                        />
                      );
                    }}
                  />
                </div>
              ) : !isTriggerRulesLocked ? (
                <ListEmptyState
                  message={statusFilter === "active" ? "활성화된 발송 규칙이 없습니다." : "비활성화된 발송 규칙이 없습니다."}
                />
              ) : null}
            </>
          </ListPanel>

          {isLoading ? (
            <TriggerRulesDetailSkeleton />
          ) : isTriggerRulesLocked ? (
            <DetailPanel
              overlay={(
                <ListEmptyState
                  name={component("trigger-rules-locked")}
                  icon={BellRing}
                  message={TRIGGER_RULE_APPROVAL_MESSAGE}
                  className="flex-none min-h-0"
                />
              )}
            >
              {null}
            </DetailPanel>
          ) : effectiveSelectedRuleId === null ? (
            <DetailPanel
              overlay={(
                <ListEmptyState
                  name={component("trigger-rules-detail-empty")}
                  icon={BellRing}
                  message={copy.emptySelection}
                  className="flex-none min-h-0"
                />
              )}
            >
              {null}
            </DetailPanel>
          ) : isRetryPolicySelected ? (
            <DetailPanel
              title={copy.retryTitle}
              subtitle={copy.retryDescription}
            >
              <SteppedWizardPanelContent
                dataComponent={component("trigger-rules-retry-policy-form")}
                flattenStepContent
                className="py-0"
                stepContentClassName="justify-start gap-4"
              >
                <div
                  data-component={component("trigger-rules-retry-policy-toggle")}
                  className="flex items-center justify-between gap-4 rounded-[18px] bg-v3-dim-white p-4"
                >
                  <div className="min-w-0">
                    <p className="text-[0.84rem] font-bold text-v3-dark">재시도 활성화</p>
                    <p className="mt-1 text-[0.72rem] leading-5 text-v3-text-muted">
                      전송 실패 시 자동으로 다시 발송합니다.
                    </p>
                  </div>
                  <Switch
                    aria-label={`${copy.retryTitle} 상세 활성화`}
                    checked={isRetryPolicyEnabled}
                    onCheckedChange={handleRetryPolicyToggle}
                    className="shrink-0"
                  />
                </div>

                <div
                  data-component={component("trigger-rules-retry-policy-values")}
                  className="grid gap-4 sm:grid-cols-2"
                >
                  <div className="rounded-[18px] bg-v3-dim-white p-4">
                    <p className="text-[0.72rem] font-semibold text-v3-text-muted">재시도 횟수</p>
                    <p className="mt-1 text-[0.92rem] font-bold text-v3-dark">최대 2회</p>
                  </div>
                  <div className="rounded-[18px] bg-v3-dim-white p-4">
                    <p className="text-[0.72rem] font-semibold text-v3-text-muted">재시도 간격</p>
                    <p className="mt-1 text-[0.92rem] font-bold text-v3-dark">실패 후 5분</p>
                  </div>
                </div>
              </SteppedWizardPanelContent>
            </DetailPanel>
          ) : (
            <DetailPanel
              title={effectiveSelectedRuleId === "new" ? "새 발송 규칙" : selectedRule?.name ?? "발송 규칙"}
              subtitle={copy.detailSubtitle}
              tabs={
                <DetailTabs
                  tabs={TRIGGER_RULE_DETAIL_TABS}
                  activeTab={activeDetailTab}
                  onTabChange={(key) => setActiveDetailTab(key as TriggerRuleDetailTab)}
                />
              }
              footer={
                <SteppedWizardPanelFooter dataComponent={component("trigger-rules-actions")}>
                  {selectedRule ? (
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleteMutation.isPending}
                      data-component={component("trigger-rules-delete")}
                      className="inline-flex items-center gap-1 rounded-[12px] px-3 py-2 text-[0.75rem] font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      삭제
                    </button>
                  ) : (
                    <span aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!hasChanges || isSaving}
                    data-component={component("trigger-rules-save")}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-[12px] px-4 py-2 text-[0.78rem] font-semibold transition-colors",
                      hasChanges && !isSaving
                        ? "bg-v3-primary text-white hover:bg-v3-primary/90"
                        : "bg-v3-dim-white text-v3-text-muted cursor-not-allowed",
                    )}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {isSaving ? "저장 중..." : "저장"}
                  </button>
                </SteppedWizardPanelFooter>
              }
            >
              <DetailTabPanels
                activeTab={activeDetailTab}
                dataComponent={component("trigger-rules-detail-tabpanes")}
                panelDataComponent={
                  dataComponentPrefix === "message" ? "messages-template-detail-pane" : component("template-detail-pane")
                }
                className="flex min-h-0 flex-1"
                trackClassName="min-h-0 flex-1"
                panelClassName="h-full min-h-0"
                panels={[
                  {
                    key: "settings",
                    children: (
                      <SteppedWizardPanelContent
                        dataComponent={component("trigger-rules-form")}
                        flattenStepContent
                        className="py-0"
                        stepContentClassName="justify-start gap-4"
                      >
                        <TitleTextInputMolecule
                          id="trigger-rule-name"
                          label="규칙 이름"
                          value={formState.name}
                          onValueChange={(value) =>
                            setFormState((current) => ({ ...current, name: value }))
                          }
                          placeholder="예: 서비스 시작 7일 전 고객 안내"
                          dataComponent={component("trigger-rules-name")}
                        />

                        <TitleSelectMolecule
                          id="trigger-rule-event"
                          label="이벤트 기준"
                          value={formState.eventType}
                          options={eventOptions.map((option) => ({
                            label: option.label,
                            value: option.value,
                          }))}
                          onValueChange={(value) => {
                            const nextEventType = value as TriggerEventType;
                            const nextRecipient =
                              getRecipientTypesForEvent(nextEventType)[0] ?? formState.recipientType;
                            const nextOffset = OFFSET_OPTIONS[nextEventType][0].value;

                            setFormState((current) => ({
                              ...current,
                              eventType: nextEventType,
                              recipientType: nextRecipient,
                              offsetType: nextOffset,
                              offsetDays: nextOffset === "BEFORE_DAYS" || nextOffset === "AFTER_DAYS" ? 1 : 0,
                            }));
                          }}
                          dataComponent={component("trigger-rules-event")}
                          triggerDataComponent={component("trigger-rules-event-select")}
                        />

                        <TitleSelectMolecule
                          id="trigger-rule-offset"
                          label="발송 시점"
                          value={formState.offsetType}
                          options={OFFSET_OPTIONS[formState.eventType]}
                          onValueChange={(value) => {
                            const nextOffsetType = value as TriggerOffsetType;

                            setFormState((current) => ({
                              ...current,
                              offsetType: nextOffsetType,
                              offsetDays:
                                nextOffsetType === "BEFORE_DAYS" || nextOffsetType === "AFTER_DAYS"
                                  ? Math.max(current.offsetDays || 1, 1)
                                  : 0,
                            }));
                          }}
                          dataComponent={component("trigger-rules-offset")}
                          triggerDataComponent={component("trigger-rules-offset-select")}
                        />

                        <TitleSelectMolecule
                          id="trigger-rule-recipient"
                          label="수신 대상"
                          value={formState.recipientType}
                          options={recipientOptions}
                          onValueChange={(value) =>
                            setFormState((current) => ({
                              ...current,
                              recipientType: value as TriggerRecipientType,
                            }))
                          }
                          dataComponent={component("trigger-rules-recipient")}
                          triggerDataComponent={component("trigger-rules-recipient-select")}
                        />

                        {(formState.offsetType === "BEFORE_DAYS" ||
                          formState.offsetType === "AFTER_DAYS") && (
                          <TitleTextInputMolecule
                            id="trigger-rule-offset-days"
                            label="기준 일수"
                            type="number"
                            min={1}
                            value={formState.offsetDays || 1}
                            onValueChange={(value) =>
                              setFormState((current) => ({
                                ...current,
                                offsetDays: Math.max(Number(value || 1), 1),
                              }))
                            }
                            dataComponent={component("trigger-rules-offset-days")}
                          />
                        )}

                        <TitleSelectMolecule
                          id="trigger-rule-template"
                          label="발송 템플릿"
                          value={formState.templateKey}
                          options={availableTemplates.map((template) => ({
                            label: template.name,
                            value: template.key,
                          }))}
                          onValueChange={(value) =>
                            setFormState((current) => ({
                              ...current,
                              templateKey: value as TriggerTemplateKey,
                            }))
                          }
                          dataComponent={component("trigger-rules-template")}
                          triggerDataComponent={component("trigger-rules-template-select")}
                        />
                      </SteppedWizardPanelContent>
                    ),
                  },
                  {
                    key: "preview",
                    className: "flex min-h-0 justify-center",
                    children: (
                      <AlimtalkPhonePreview
                        className="h-full min-h-0 overflow-hidden py-0"
                        content={selectedTemplateMessage}
                        templateName={selectedTemplate?.name ?? "발송 템플릿"}
                        headline={selectedTemplate?.name ?? "발송 템플릿"}
                        subtitle={
                          selectedTemplate?.description ??
                          selectedSystemTemplate?.description ??
                          "선택한 발송 템플릿 미리보기입니다."
                        }
                        dataComponentPrefix={dataComponentPrefix === "message" ? "message" : dataComponentPrefix}
                        panelDataComponent={
                          dataComponentPrefix === "message"
                            ? "messages-template-preview-phone-panel"
                            : component("template-preview-phone-panel")
                        }
                      />
                    ),
                  },
                ]}
              />
            </DetailPanel>
          )}
        </SplitLayout>
      </div>
    </section>
  );
}
