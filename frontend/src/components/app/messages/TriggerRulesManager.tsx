"use client";
import { getUserErrorMessage } from "@babyjamjam/shared";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  CalendarClock,
  CalendarRange,
  Plus,
  UserPlus,
  Users,
} from "lucide-react";
import {
  SplitLayout,
  ListPanel,
  DetailPanel,
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  HeaderActionButton,
  ListEmptyState,
  SteppedWizardPanelContent,
  DetailTabs,
  DetailTabPanels,
  InfoCard,
  InfoRow,
  type SplitLayoutMode,
} from "@/components/app/v3";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TitleSelectMolecule } from "@/components/ui/title-select-molecule";
import { TitleTextInputMolecule } from "@/components/ui/title-text-input-molecule";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import {
  settingsApi,
  type ClientRegistrationPolicy,
  type ClientRegistrationPolicyPatch,
  type MessageAutomationPoliciesResponse,
} from "@/services/api";
import { useToast } from "@/hooks/use-toast";
import {
  useMessageTriggerRules,
  useMessageTriggerTemplates,
  useCreateMessageTriggerRule,
  useUpdateMessageTriggerRule,
  useUpdateMessageTriggerRuleBranchActivation,
  useActivateMessageTriggerRuleWithParent,
  useDeleteMessageTriggerRule,
} from "@/features/message-triggers/hooks/use-message-triggers";
import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import {
  CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS,
  MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS,
  deriveEventTypesFromTemplates,
  deriveRecipientTypesFromTemplates,
  getChannelTemplates,
  isTriggerRuleInChannel,
  isTriggerTemplateInChannel,
  SMS_TRIGGER_TO_SYSTEM_TEMPLATE,
  type TriggerMessageChannel,
} from "@/features/message-triggers/channel";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { serviceInfoMsgTemplate } from "@/components/app/messages/templates/messageTemplate/serviceInfoMsg";
import { MessageApprovalRequiredNotice } from "@/components/app/messages/MessageApprovalRequiredNotice";
import { MessagePhonePreview } from "./MessagePhonePreview";
import type {
  MessageTriggerRule,
  CreateMessageTriggerRuleDto,
  TriggerEventType,
  TriggerOffsetType,
  TriggerRecipientType,
  TriggerTemplateCatalogItem,
  TriggerTemplateKey,
} from "@/features/message-triggers/types";

type RuleSelection = string | "new" | null;
type RuleStatusFilter = "active" | "inactive";
type TriggerRuleDetailTab = "settings" | "preview";

type RuleFormState = CreateMessageTriggerRuleDto;

type TriggerRuleListItem = {
  kind: "trigger-rule";
  id: string;
  title: string;
  subtitle: string;
  active: boolean;
  icon: typeof BellRing;
  rule: MessageTriggerRule;
};

type RuleListItem = TriggerRuleListItem;

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

function getDefaultFormState(isActive = true): RuleFormState {
  return {
    name: "",
    isActive,
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    offsetDays: 7,
    sendTime: "09:00",
    recipientType: "CLIENT",
    templateKey: "SERVICE_INFO",
  };
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
  }
> = {
  sms: {
    listTitle: "자동 전송 루틴",
    listSubtitle: "메시지 템플릿을 자동으로 보내는 루틴만 관리합니다.",
    detailSubtitle: "메시지 발송 시점, 수신자, 메시지 템플릿을 설정해서 자동 전송을 설정할 수 있어요.",
    emptySelection: "왼쪽 목록에서 SMS 규칙을 선택하거나 새 규칙을 만들어 주세요.",
  },
};

const TRIGGER_RULE_DETAIL_TABS = [
  { key: "settings", label: "규칙 설정" },
  { key: "preview", label: "미리보기" },
] satisfies Array<{ key: TriggerRuleDetailTab; label: string }>;

const TRIGGER_RULE_APPROVAL_MESSAGE =
  "메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요.";
const CLIENT_REGISTRATION_POLICY_QUERY_KEY = ["settings", "client-registration-policy"] as const;
const MANUAL_ONLY_TRIGGER_TEMPLATE_KEY = "SERVICE_END_NOTICE";
const TRIGGER_TEMPLATE_OPTION_SUFFIXES = {
  serviceRecordLink: " · 제공기록지 전용 자동화에서 관리",
  manualOnly: " · 수동 발송 전용",
  eventAndRecipientMismatch: " · 선택한 이벤트·수신 대상과 맞지 않음",
  eventMismatch: " · 선택한 이벤트와 맞지 않음",
  recipientMismatch: " · 선택한 수신 대상과 맞지 않음",
} as const;

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
  SERVICE_RECORD_LINK: `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

{{employeeName}} 관리사님, {{clientName}} 산모님의 서비스 제공기록지 작성 링크입니다.
매일 서비스 제공 완료 직전에 서비스 세부사항 기록 후에, 산모님께 승인을 받으시면 됩니다.

최초 접속 시에 관리사님의 전화번호 인증이 필요합니다. 링크 접속 후 휴대폰 번호로 본인확인하고, 방문일마다 기록을 남겨주세요.

감사합니다.

제공기록지 링크
{{serviceRecordUrl}}`,
  CLIENT_GREETING: `[아이미래 인천]
#{고객명}님, 안녕하세요.

저희 아이미래에 등록해 주셔서 감사합니다.
앞으로 잘 부탁드립니다.

문의사항이 있으시면 언제든지 연락주세요.`,
  PRICE_INFO: `[아이미래 인천]
비용 안내드립니다. 자세한 내용은 담당자에게 문의해 주세요.`,
  REMINDER: `[아이미래 인천]
#{고객명}님, 일정 리마인드 안내드립니다.`,
  THANKS: `[아이미래 인천]
#{고객명}님, 예약이 완료되었습니다. 감사합니다.`,
  SURVEY: `[아이미래 인천]
#{고객명}님, 모니터링 설문 부탁드립니다.`,
  INFO: `[아이미래 인천]
안내드립니다.`,
  SERVICE_END_NOTICE: `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

{{name}}산모님~♡

본인부담금 환급신청을 위한 영수증 다운로드 방법 안내 드립니다 :)

아래의 URL로 접속하시면 본인부담금 영수증 다운로드가 가능하십니다. 환급 신청은 관할지 보건소 방문 또는 인터넷 정부24에서 가능하시고, 다운로드 받으신 영수증 이미지를 첨부하시면 환급 신청 가능 하십니다^^

{{receiptUrl}}

추가 문의사항이 있으시면 상세히 답변 드리도록 하겠습니다.

감사합니다 :)`,
};

function toFormState(rule: MessageTriggerRule | null, isActiveOverride?: boolean): RuleFormState {
  if (!rule) return getDefaultFormState();
  return {
    name: rule.name,
    isActive: isActiveOverride ?? rule.isActive,
    eventType: rule.eventType,
    offsetType: rule.offsetType,
    offsetDays: rule.offsetDays,
    sendTime: rule.sendTime ?? "09:00",
    recipientType: rule.recipientType,
    templateKey: rule.templateKey,
  };
}

function normalizeDto(dto: RuleFormState): CreateMessageTriggerRuleDto {
  return {
    ...dto,
    sendTime: dto.offsetType === "IMMEDIATE" ? "09:00" : dto.sendTime,
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

  const timeLabel = rule.offsetType === "IMMEDIATE" ? "" : ` ${rule.sendTime ?? "09:00"} (한국 시간)`;
  return `${eventLabel} · ${timingLabel}${timeLabel} · ${recipientLabel}`;
}

function getRuleIcon(eventType: TriggerEventType) {
  return EVENT_OPTIONS.find((option) => option.value === eventType)?.icon ?? BellRing;
}

const MESSAGE_AUTOMATION_POLICIES_QUERY_KEY = [
  "settings",
  "message-automation-policies",
] as const;
const PARENT_DISABLED_RETRY_MESSAGE =
  "이 지점의 메시지 자동 발송이 꺼져 있어요. 설정을 새로고침한 뒤 다시 시도해 주세요.";

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return undefined;
  }

  const status = (error as { response?: { status?: unknown } }).response?.status;
  return typeof status === "number" ? status : undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("response" in error)) {
    return undefined;
  }

  const payload = (error as { response?: { data?: unknown } }).response?.data;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const code = (payload as { code?: unknown }).code;
  if (typeof code === "string") return code;

  const nestedError = (payload as { error?: unknown }).error;
  if (nestedError && typeof nestedError === "object" && !Array.isArray(nestedError)) {
    const nestedCode = (nestedError as { code?: unknown }).code;
    if (typeof nestedCode === "string") return nestedCode;
  }

  return undefined;
}

function isParentDisabledConflict(error: unknown): boolean {
  return getErrorStatus(error) === 409 && getErrorCode(error) === "MESSAGE_AUTOMATION_PARENT_DISABLED";
}

function getTemplateOptionPresentation(
  template: TriggerTemplateCatalogItem,
  eventType: TriggerEventType,
  recipientType: TriggerRecipientType,
) {
  if (template.key === "SERVICE_RECORD_LINK") {
    return {
      label: `${template.name}${TRIGGER_TEMPLATE_OPTION_SUFFIXES.serviceRecordLink}`,
      disabled: true,
    };
  }

  if (template.key === MANUAL_ONLY_TRIGGER_TEMPLATE_KEY) {
    return {
      label: `${template.name}${TRIGGER_TEMPLATE_OPTION_SUFFIXES.manualOnly}`,
      disabled: true,
    };
  }

  const matchesEvent = template.allowedEventTypes.includes(eventType);
  const matchesRecipient = template.allowedRecipientTypes.includes(recipientType);

  if (!matchesEvent && !matchesRecipient) {
    return {
      label: `${template.name}${TRIGGER_TEMPLATE_OPTION_SUFFIXES.eventAndRecipientMismatch}`,
      disabled: true,
    };
  }

  if (!matchesEvent) {
    return {
      label: `${template.name}${TRIGGER_TEMPLATE_OPTION_SUFFIXES.eventMismatch}`,
      disabled: true,
    };
  }

  if (!matchesRecipient) {
    return {
      label: `${template.name}${TRIGGER_TEMPLATE_OPTION_SUFFIXES.recipientMismatch}`,
      disabled: true,
    };
  }

  return {
    label: template.name,
    disabled: false,
  };
}

export function TriggerRulesManager({
  dataComponent,
  channel = "sms",
}: {
  dataComponent: string;
  channel?: TriggerMessageChannel;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRuleId, setSelectedRuleId] = useState<RuleSelection>(null);
  const [isRuleDetailDismissed, setIsRuleDetailDismissed] = useState(false);
  const [splitLayoutMode, setSplitLayoutMode] = useState<SplitLayoutMode | null>(null);
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>("active");
  const [activeDetailTab, setActiveDetailTab] = useState<TriggerRuleDetailTab>("settings");
  const [formState, setFormState] = useState<RuleFormState>(() => getDefaultFormState());
  const [parentActivationRule, setParentActivationRule] = useState<MessageTriggerRule | null>(null);
  const [parentActivationError, setParentActivationError] = useState<string | null>(null);
  const [isParentActivationPending, setIsParentActivationPending] = useState(false);
  const parentActivationPendingRef = useRef(false);
  const newRuleDefaultIsActiveRef = useRef(true);
  const previousSelectedRuleRef = useRef<RuleSelection>(null);
  const component = (suffix: string) => `${dataComponent}_${suffix}`;
  const isCompactSplitLayout = splitLayoutMode === "compact";
  const copy = CHANNEL_COPY[channel];

  const {
    data: rulesData = [],
    isLoading,
    refetch: refetchMessageTriggerRules,
  } = useMessageTriggerRules();
  const createMutation = useCreateMessageTriggerRule();
  const updateMutation = useUpdateMessageTriggerRule();
  const branchActivationMutation = useUpdateMessageTriggerRuleBranchActivation();
  const parentActivationMutation = useActivateMessageTriggerRuleWithParent();
  const deleteMutation = useDeleteMessageTriggerRule();

  const rules = useMemo(() => (Array.isArray(rulesData) ? rulesData : []), [rulesData]);

  const { data: senderApproval, isLoading: isSenderApprovalLoading } = useQuery({
    queryKey: ["settings", "message-sender-approval"],
    queryFn: settingsApi.getMessageSenderApproval,
  });
  const {
    data: messageAutomationPolicies,
    isLoading: isMessageAutomationPoliciesLoading,
    isError: isMessageAutomationPoliciesError,
    refetch: refetchMessageAutomationPolicies,
  } = useQuery<MessageAutomationPoliciesResponse>({
    queryKey: MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
    queryFn: settingsApi.getMessageAutomationPolicies,
  });
  const {
    data: clientRegistrationPolicy,
    isLoading: isClientRegistrationPolicyLoading,
    isError: isClientRegistrationPolicyError,
    refetch: refetchClientRegistrationPolicy,
  } = useQuery<ClientRegistrationPolicy>({
    queryKey: CLIENT_REGISTRATION_POLICY_QUERY_KEY,
    queryFn: settingsApi.getClientRegistrationPolicy,
  });
  const updateClientRegistrationPolicyMutation = useMutation({
    mutationFn: settingsApi.updateClientRegistrationPolicy,
    onMutate: async (patch: ClientRegistrationPolicyPatch) => {
      await queryClient.cancelQueries({ queryKey: CLIENT_REGISTRATION_POLICY_QUERY_KEY });
      const previous = queryClient.getQueryData<ClientRegistrationPolicy>(CLIENT_REGISTRATION_POLICY_QUERY_KEY);
      queryClient.setQueryData<ClientRegistrationPolicy>(
        CLIENT_REGISTRATION_POLICY_QUERY_KEY,
        (current) => current ? { ...current, ...patch } : current,
      );
      return { previous };
    },
    onError: (error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(CLIENT_REGISTRATION_POLICY_QUERY_KEY, context.previous);
      }
      toast({
        variant: "destructive",
        description: getUserErrorMessage(error, "자동 등록 고객의 인사 문자 설정을 저장하지 못했어요"),
      });
    },
    onSuccess: (savedPolicy) => {
      queryClient.setQueryData(CLIENT_REGISTRATION_POLICY_QUERY_KEY, savedPolicy);
      toast({ variant: "success", description: "자동 등록 고객의 인사 문자 설정을 저장했어요" });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: CLIENT_REGISTRATION_POLICY_QUERY_KEY });
    },
  });
  const isTriggerRulesLocked = !isSenderApprovalLoading && senderApproval?.isApproved === false;
  const isAdminOrOwner = messageAutomationPolicies?.canManageActivation === true;
  const triggerDispatchPolicy = messageAutomationPolicies?.policies?.find(
    (policy) => policy.id === "trigger-dispatch",
  );
  const triggerDispatchActive =
    isMessageAutomationPoliciesLoading || isMessageAutomationPoliciesError
      ? null
      : typeof triggerDispatchPolicy?.active === "boolean"
      ? triggerDispatchPolicy.active
      : typeof messageAutomationPolicies?.policyActivations?.["trigger-dispatch"] === "boolean"
        ? messageAutomationPolicies.policyActivations["trigger-dispatch"]
        : null;
  const isTriggerDispatchAvailable =
    !isMessageAutomationPoliciesLoading &&
    !isMessageAutomationPoliciesError &&
    triggerDispatchPolicy !== undefined &&
    triggerDispatchActive !== null;
  const isTriggerDispatchOff = isTriggerDispatchAvailable && triggerDispatchActive === false;
  const effectiveSelectedRuleId = isTriggerRulesLocked ? null : selectedRuleId;

  const selectedRule =
    effectiveSelectedRuleId &&
    effectiveSelectedRuleId !== "new"
      ? rules.find((rule) => rule.id === effectiveSelectedRuleId) ?? null
      : null;
  const isSelectedDedicatedRule = Boolean(
    selectedRule
    && !CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS.includes(selectedRule.templateKey),
  );
  const isSelectedSystemRule = selectedRule?.branchId === null;

  // Fetch all SMS templates in one query (no event/recipient filter), then derive
  // the event / recipient / template dropdowns from the catalog so future templates surface
  // automatically.
  const templateQuery = useMessageTriggerTemplates({});
  const selectedSystemTemplateKey = SMS_TRIGGER_TO_SYSTEM_TEMPLATE[formState.templateKey] ?? "";
  const { data: selectedSystemTemplate } = useSystemTemplate(selectedSystemTemplateKey);

  const automaticChannelTemplates = useMemo(
    () => getChannelTemplates(templateQuery.data ?? [], channel)
      .filter((template) => template.key !== MANUAL_ONLY_TRIGGER_TEMPLATE_KEY),
    [channel, templateQuery.data],
  );
  const smsCatalogTemplates = useMemo(
    () => (templateQuery.data ?? []).filter((template) => isTriggerTemplateInChannel(template.key, channel)),
    [channel, templateQuery.data],
  );

  const eventOptions = useMemo(() => {
    const allowedEvents = new Set(deriveEventTypesFromTemplates(automaticChannelTemplates));
    return EVENT_OPTIONS.filter((option) => allowedEvents.has(option.value));
  }, [automaticChannelTemplates]);

  const getRecipientTypesForEvent = useCallback(
    (eventType: TriggerEventType): TriggerRecipientType[] => {
      const allowed = new Set(deriveRecipientTypesFromTemplates(automaticChannelTemplates, eventType));
      return RECIPIENT_TYPE_ORDER.filter((recipientType) => allowed.has(recipientType));
    },
    [automaticChannelTemplates],
  );

  const recipientOptions = useMemo(() => {
    const recipientTypes = isSelectedDedicatedRule && selectedRule
      ? [selectedRule.recipientType]
      : getRecipientTypesForEvent(formState.eventType);
    return recipientTypes.map((recipientType) => ({
        value: recipientType,
        label: RECIPIENT_LABELS[recipientType],
      }));
  }, [getRecipientTypesForEvent, formState.eventType, isSelectedDedicatedRule, selectedRule]);

  const availableTemplates = useMemo<TriggerTemplateCatalogItem[]>(() => {
    return smsCatalogTemplates;
  }, [
    smsCatalogTemplates,
  ]);
  const selectedTemplate = useMemo(() => {
    return availableTemplates.find((template) => template.key === formState.templateKey) ?? null;
  }, [availableTemplates, formState.templateKey]);
  const isClientGreetingRule = formState.templateKey === "CLIENT_GREETING";
  const requiredTemplateVariables = useMemo(() => {
    const variables = [...(selectedTemplate?.requiredVariables ?? [])];
    const knownKeys = new Set(variables.map((variable) => variable.key));

    for (const customVariable of selectedSystemTemplate?.customVariables ?? []) {
      if (customVariable.required && !knownKeys.has(customVariable.key)) {
        variables.push({ key: customVariable.key, label: customVariable.label });
        knownKeys.add(customVariable.key);
      }
    }

    return variables;
  }, [selectedSystemTemplate?.customVariables, selectedTemplate?.requiredVariables]);
  const unsupportedRequiredCustomVariables = useMemo(() => {
    const automaticallyAvailableKeys = new Set(
      MESSAGE_TRIGGER_AUTOMATIC_VARIABLE_KEYS[formState.templateKey] ?? [],
    );
    return (selectedSystemTemplate?.customVariables ?? []).filter(
      (variable) => variable.required && !automaticallyAvailableKeys.has(variable.key),
    );
  }, [formState.templateKey, selectedSystemTemplate?.customVariables]);
  const selectedTemplateMessage = selectedSystemTemplate?.content?.trim()
    ? selectedSystemTemplate.content
    : TRIGGER_TEMPLATE_MESSAGE_FALLBACKS[formState.templateKey];
  const filteredRules = useMemo(() => {
    return rules.filter((rule) =>
      (isTriggerDispatchOff ? false : rule.isActive) === (statusFilter === "active") &&
      rule.templateKey !== MANUAL_ONLY_TRIGGER_TEMPLATE_KEY &&
      isTriggerRuleInChannel(rule, channel)
    );
  }, [channel, isTriggerDispatchOff, rules, statusFilter]);

  useEffect(() => {
    if (isTriggerRulesLocked) return;

    if (selectedRuleId === "new") return;
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
    splitLayoutMode,
  ]);

  useEffect(() => {
    if (effectiveSelectedRuleId === "new") {
      setFormState((current) => {
        const isEnteringNewDraft = previousSelectedRuleRef.current !== "new";
        const next = isEnteringNewDraft
          ? getDefaultFormState(newRuleDefaultIsActiveRef.current)
          : current;
        return isTriggerDispatchAvailable && triggerDispatchActive === true
          ? next
          : { ...next, isActive: false };
      });
      previousSelectedRuleRef.current = effectiveSelectedRuleId;
      return;
    }
    previousSelectedRuleRef.current = effectiveSelectedRuleId;
    setFormState(toFormState(selectedRule, isTriggerDispatchOff ? false : undefined));
  }, [
    channel,
    effectiveSelectedRuleId,
    isTriggerDispatchAvailable,
    isTriggerDispatchOff,
    selectedRule,
    triggerDispatchActive,
  ]);

  useEffect(() => {
    // Wait until the catalog has loaded before reconciling the form against derived options.
    if (isSelectedDedicatedRule) return;
    if (eventOptions.length === 0) return;

    if (!eventOptions.some((option) => option.value === formState.eventType)) {
      setFormState(getDefaultFormState());
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
    isSelectedDedicatedRule,
  ]);

  useEffect(() => {
    if (isSelectedDedicatedRule) return;
    if (availableTemplates.length === 0) return;
    if (!availableTemplates.some((template) => template.key === formState.templateKey)) {
      setFormState((current) => ({
        ...current,
        templateKey: availableTemplates[0].key,
      }));
    }
  }, [availableTemplates, formState.templateKey, isSelectedDedicatedRule]);

  const listItems = useMemo<RuleListItem[]>(() => {
    return filteredRules.map((rule): TriggerRuleListItem => ({
      kind: "trigger-rule",
      id: rule.id,
      title: rule.name,
      subtitle: `${rule.branchId === null ? "시스템 자동화 · " : ""}${getRuleSummary(toFormState(rule))}`,
      active: isTriggerDispatchOff ? false : rule.isActive,
      icon: getRuleIcon(rule.eventType),
      rule,
    }));
  }, [filteredRules, isTriggerDispatchOff]);

  const hasChanges = useMemo(() => {
    if (effectiveSelectedRuleId === "new") {
      return !!formState.name.trim();
    }
    if (!selectedRule) return false;
    return JSON.stringify(normalizeDto(formState)) !== JSON.stringify(
      normalizeDto(toFormState(selectedRule, isTriggerDispatchOff ? false : undefined)),
    );
  }, [effectiveSelectedRuleId, formState, isTriggerDispatchOff, selectedRule]);

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isDetailPendingSelection =
    !isLoading &&
    effectiveSelectedRuleId === null &&
    splitLayoutMode === "desktop" &&
    !isRuleDetailDismissed &&
    filteredRules.length > 0;
  const isDetailLoading = isLoading || isDetailPendingSelection;
  const hasVisibleDetailPanel = isDetailLoading || effectiveSelectedRuleId !== null;

  const invalidateMessageAutomationCaches = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all }),
      queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() }),
      queryClient.invalidateQueries({ queryKey: messageTriggerKeys.history() }),
      queryClient.invalidateQueries({ queryKey: MESSAGE_AUTOMATION_POLICIES_QUERY_KEY }),
    ]);
  };

  const refreshMessageAutomationState = () => {
    return Promise.all([
      refetchMessageTriggerRules(),
      refetchMessageAutomationPolicies(),
    ]);
  };

  const showParentDisabledConflict = async () => {
    await invalidateMessageAutomationCaches();
    toast({ variant: "destructive", description: PARENT_DISABLED_RETRY_MESSAGE });
  };

  const handleCreateNew = () => {
    if (isTriggerRulesLocked) return;
    if (!isTriggerDispatchAvailable) {
      void refreshMessageAutomationState();
      toast({ variant: "destructive", description: PARENT_DISABLED_RETRY_MESSAGE });
      return;
    }
    setIsRuleDetailDismissed(false);
    const isActive = triggerDispatchActive === true;
    newRuleDefaultIsActiveRef.current = isActive;
    setStatusFilter(isActive ? "active" : "inactive");
    setSelectedRuleId("new");
    setFormState(getDefaultFormState(isActive));
  };

  const handleRuleSelect = (ruleId: string) => {
    setIsRuleDetailDismissed(false);
    setSelectedRuleId(ruleId);
  };

  const handleRuleActiveToggle = async (rule: MessageTriggerRule, checked: boolean) => {
    if (isTriggerRulesLocked || rule.isLockedByGlobal) return;

    if (checked && !isTriggerDispatchAvailable) {
      await refreshMessageAutomationState();
      toast({ variant: "destructive", description: PARENT_DISABLED_RETRY_MESSAGE });
      return;
    }

    if (checked && isTriggerDispatchOff) {
      if (!isAdminOrOwner) {
        toast({
          variant: "destructive",
          description: "이 지점의 메시지 자동 발송을 켤 권한이 없어요.",
        });
        return;
      }

      setParentActivationError(null);
      setParentActivationRule(rule);
      return;
    }

    try {
      if (rule.branchId === null) {
        await branchActivationMutation.mutateAsync({ id: rule.id, dto: { isActive: checked } });
      } else {
        const dto = normalizeDto({
          ...toFormState(rule),
          isActive: checked,
        });
        await updateMutation.mutateAsync({ id: rule.id, dto });
      }
      if (effectiveSelectedRuleId === rule.id) {
        setFormState((current) => ({ ...current, isActive: checked }));
      }
      toast({ variant: "success", description: checked ? "발송 규칙을 켰어요" : "발송 규칙을 껐어요" });
    } catch (error) {
      if (isParentDisabledConflict(error)) {
        await showParentDisabledConflict();
        return;
      }
      toast({ variant: "destructive", description: getUserErrorMessage("규칙 상태를 바꾸지 못했어요") });
    }
  };

  const handleConfirmParentActivation = async () => {
    const rule = parentActivationRule;
    if (!rule || parentActivationMutation.isPending || isParentActivationPending || parentActivationPendingRef.current) return;

    parentActivationPendingRef.current = true;
    setIsParentActivationPending(true);
    setParentActivationError(null);
    try {
      await parentActivationMutation.mutateAsync(rule.id);
      await invalidateMessageAutomationCaches();
      const [rulesResult, policiesResult] = await refreshMessageAutomationState();
      const refreshedRules = rulesResult?.data;
      const refreshedPolicies = policiesResult?.data;
      if (
        rulesResult?.isError === true ||
        policiesResult?.isError === true ||
        !Array.isArray(refreshedRules) ||
        !refreshedPolicies
      ) {
        setParentActivationError(PARENT_DISABLED_RETRY_MESSAGE);
        return;
      }

      const refreshedRule = refreshedRules.find((currentRule) => currentRule.id === rule.id);
      const refreshedTriggerDispatchPolicy = refreshedPolicies?.policies?.find(
        (policy) => policy.id === "trigger-dispatch",
      );
      const refreshedParentActive = typeof refreshedTriggerDispatchPolicy?.active === "boolean"
        ? refreshedTriggerDispatchPolicy.active
        : refreshedPolicies?.policyActivations?.["trigger-dispatch"];

      if (!refreshedRule || typeof refreshedParentActive !== "boolean") {
        setParentActivationError(PARENT_DISABLED_RETRY_MESSAGE);
        return;
      }

      setFormState(toFormState(refreshedRule, refreshedParentActive === false ? false : undefined));
      if (refreshedParentActive === true && refreshedRule.isActive === true) {
        setStatusFilter("active");
      } else if (refreshedParentActive === false) {
        setStatusFilter("inactive");
      }
      setSelectedRuleId(rule.id);
      setParentActivationRule(null);
      if (refreshedParentActive === false || refreshedRule?.isActive === false) {
        toast({ variant: "destructive", description: PARENT_DISABLED_RETRY_MESSAGE });
      } else {
        toast({ variant: "success", description: "메시지 자동 발송과 선택한 규칙을 켰어요" });
      }
    } catch (error) {
      if (isParentDisabledConflict(error)) {
        await showParentDisabledConflict();
      }
      const message = isParentDisabledConflict(error)
        ? PARENT_DISABLED_RETRY_MESSAGE
        : getUserErrorMessage(error, "규칙을 켜지 못했어요. 잠시 후 다시 시도해 주세요");
      setParentActivationError(message);
    } finally {
      parentActivationPendingRef.current = false;
      setIsParentActivationPending(false);
    }
  };

  const handleBackToRuleList = () => {
    setIsRuleDetailDismissed(true);
    setSelectedRuleId(null);
  };

  const handleSave = async () => {
    if (isTriggerRulesLocked || isSelectedSystemRule) return;
    if (!isTriggerDispatchAvailable) {
      await refreshMessageAutomationState();
      toast({ variant: "destructive", description: PARENT_DISABLED_RETRY_MESSAGE });
      return;
    }
    const dto = normalizeDto(formState);

    if (unsupportedRequiredCustomVariables.length > 0) {
      toast({
        variant: "destructive",
        description: getUserErrorMessage("자동 입력할 수 없는 필수 변수가 있어 규칙을 저장할 수 없어요"),
      });
      return;
    }

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dto.sendTime ?? "")) {
      toast({ variant: "destructive", description: "발송 시각을 입력해 주세요 (한국 시간)." });
      return;
    }

    if (!dto.name.trim()) {
      toast({ variant: "destructive", description: getUserErrorMessage("규칙 이름을 입력해 주세요") });
      return;
    }

    if ((dto.offsetType === "BEFORE_DAYS" || dto.offsetType === "AFTER_DAYS") && (!dto.offsetDays || dto.offsetDays < 1)) {
      toast({ variant: "destructive", description: getUserErrorMessage("일수는 1 이상이어야 해요") });
      return;
    }

    if (dto.isActive && isTriggerDispatchOff) {
      await refreshMessageAutomationState();
      toast({ variant: "destructive", description: PARENT_DISABLED_RETRY_MESSAGE });
      return;
    }

    try {
      if (selectedRuleId === "new" || !selectedRule) {
        const created = await createMutation.mutateAsync({
          ...dto,
          isActive: triggerDispatchActive === true ? dto.isActive : false,
        });
        if (!created.isActive) {
          setStatusFilter("inactive");
        }
        setSelectedRuleId(created.id);
        toast({ variant: "success", description: "발송 규칙을 만들었어요" });
      } else {
        await updateMutation.mutateAsync({ id: selectedRule.id, dto });
        toast({ variant: "success", description: "발송 규칙을 저장했어요" });
      }
    } catch (error) {
      if (isParentDisabledConflict(error)) {
        await showParentDisabledConflict();
        return;
      }
      toast({ variant: "destructive", description: getUserErrorMessage("발송 규칙을 저장하지 못했어요") });
    }
  };

  const handleDelete = async () => {
    if (isTriggerRulesLocked || isSelectedSystemRule) return;
    if (!selectedRule) return;
    try {
      await deleteMutation.mutateAsync(selectedRule.id);
      setSelectedRuleId(null);
      toast({ variant: "success", description: "발송 규칙을 삭제했어요" });
    } catch {
      toast({ variant: "destructive", description: getUserErrorMessage("발송 규칙을 삭제하지 못했어요") });
    }
  };
  return (
    <section
      data-component={dataComponent}
      data-slot="trigger-rules"
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <div
        data-component={component("layout")}
        data-slot="trigger-rules-layout"
        className="flex h-full min-h-0 flex-1 flex-col"
      >
        {isMessageAutomationPoliciesLoading ? (
          <InfoCard
            title="메시지 자동 발송 상태"
            description="이 지점의 메시지 자동 발송 설정을 불러오는 중이에요."
            data-component={component("trigger-dispatch-loading")}
          >
            <InfoRow label="상태" value="설정 정보를 불러오는 중이에요." />
          </InfoCard>
        ) : !isTriggerDispatchAvailable ? (
          <InfoCard
            title="메시지 자동 발송 상태"
            description="이 지점의 메시지 자동 발송 설정을 확인할 수 없어요."
            data-component={component("trigger-dispatch-error")}
          >
            <InfoRow label="상태" value="설정 정보를 불러오지 못했어요." />
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                variant="neutral"
                size="sm"
                onClick={() => void refreshMessageAutomationState()}
                data-component={component("trigger-dispatch-retry")}
              >
                다시 시도
              </Button>
            </div>
          </InfoCard>
        ) : null}
        <SplitLayout data-component="desktop_messages_sections_split-layout"
          hasSelection={hasVisibleDetailPanel}
          onBack={handleBackToRuleList}
          onModeChange={setSplitLayoutMode}
        >
          <ListPanel data-component="desktop_messages_sections_split-layout_list-panel"
            title={copy.listTitle}
            subtitle={copy.listSubtitle}
            tabs={RULE_STATUS_TABS.map((tab) => ({ ...tab }))}
            activeTab={statusFilter}
            onTabChange={isTriggerRulesLocked ? undefined : (value) => setStatusFilter(value as RuleStatusFilter)}
            disabled={isTriggerRulesLocked}
            disabledOverlay={isTriggerRulesLocked ? (
              <MessageApprovalRequiredNotice dataComponent={component("trigger-rules-disabled-copy")} />
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
                              disabled={
                                isTriggerRulesLocked ||
                                item.rule.isLockedByGlobal === true ||
                                updateMutation.isPending ||
                                branchActivationMutation.isPending ||
                                parentActivationMutation.isPending ||
                                isParentActivationPending ||
                                !isTriggerDispatchAvailable ||
                                (isTriggerDispatchOff && !isAdminOrOwner)
                              }
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

          {isTriggerRulesLocked ? (
            <DetailPanel data-component="desktop_messages_sections_split-layout_detail-panel"
              overlay={(
                <ListEmptyState
                  icon={BellRing}
                  message={TRIGGER_RULE_APPROVAL_MESSAGE}
                  className="flex-none min-h-0"
                />
              )}
            >
              {null}
            </DetailPanel>
          ) : effectiveSelectedRuleId === null && !isDetailLoading ? (
            <DetailPanel data-component="desktop_messages_sections_split-layout_detail-panel-2"
              overlay={(
                <ListEmptyState
                  icon={BellRing}
                  message={copy.emptySelection}
                  className="flex-none min-h-0"
                />
              )}
            >
              {null}
            </DetailPanel>
          ) : (
            <DetailPanel data-component="desktop_messages_sections_split-layout_detail-panel-3"
              isLoading={isDetailLoading}
              title={effectiveSelectedRuleId === "new" ? "새 발송 규칙" : selectedRule?.name ?? "발송 규칙"}
              subtitle={isSelectedSystemRule
                ? "내용은 고정되어 있지만 이 지점에서 발송 여부를 켜고 끌 수 있는 시스템 루틴입니다."
                : copy.detailSubtitle}
              tabs={
                <DetailTabs
                  tabs={TRIGGER_RULE_DETAIL_TABS}
                  activeTab={activeDetailTab}
                  onTabChange={(key) => setActiveDetailTab(key as TriggerRuleDetailTab)}
                />
              }
              footer={isSelectedSystemRule ? undefined : (
                <>
                  {isDetailLoading || selectedRule ? (
                    <Button
                      type="button"
                      variant="negative-outline"
                      size="sm"
                      width="sm"
                      onClick={handleDelete}
                      disabled={isDetailLoading || deleteMutation.isPending}
                      data-component={component("trigger-rules-delete")}
                    >
                      삭제
                    </Button>
                  ) : (
                    <span aria-hidden="true" className="w-1/4" />
                  )}
                  <Button
                    type="button"
                    variant="positive"
                    size="sm"
                    width="sm"
                    onClick={handleSave}
                    disabled={!hasChanges || isSaving || unsupportedRequiredCustomVariables.length > 0 || !isTriggerDispatchAvailable}
                    data-component={component("trigger-rules-save")}
                  >
                    {isSaving ? "저장 중..." : "저장"}
                  </Button>
                </>
              )}
            >
              <DetailTabPanels
                activeTab={activeDetailTab}
                dataComponent={component("trigger-rules-detail-tabpanes")}
                panelDataComponent={component("template-detail-pane")}
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
                          disabled={isSelectedSystemRule}
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
                          disabled={isSelectedDedicatedRule}
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
                          disabled={isSelectedDedicatedRule}
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

                        {formState.offsetType !== "IMMEDIATE" && (
                          <TitleTextInputMolecule
                            id="trigger-rule-send-time"
                            label="발송 시각 (한국 시간)"
                            type="time"
                            step={60}
                            value={formState.sendTime ?? "09:00"}
                            disabled={isSelectedSystemRule}
                            onValueChange={(sendTime) => setFormState((current) => ({ ...current, sendTime }))}
                            dataComponent={component("trigger-rules-send-time")}
                            inputDataComponent={component("trigger-rules-send-time_input")}
                          />
                        )}

                        <TitleSelectMolecule
                          id="trigger-rule-recipient"
                          label="수신 대상"
                          value={formState.recipientType}
                          options={recipientOptions}
                          disabled={isSelectedDedicatedRule}
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
                            ...getTemplateOptionPresentation(
                              template,
                              formState.eventType,
                              formState.recipientType,
                            ),
                            value: template.key,
                          }))}
                          disabled={isSelectedDedicatedRule}
                          onValueChange={(value) =>
                            setFormState((current) => ({
                              ...current,
                              templateKey: value as TriggerTemplateKey,
                            }))
                          }
                          dataComponent={component("trigger-rules-template")}
                          triggerDataComponent={component("trigger-rules-template-select")}
                        />

                        {isClientGreetingRule ? (
                          <InfoCard
                            title="추가 발송 조건"
                            description={isClientRegistrationPolicyLoading
                              ? "고객 자동 등록 설정을 불러오는 중이에요."
                              : isClientRegistrationPolicyError
                                ? "고객 자동 등록 설정을 불러오지 못했어요. 다시 시도해 주세요."
                                : clientRegistrationPolicy?.clientAutoRegistration
                                  ? "전자문서로 자동 등록된 고객에게 인사 문자를 보낼지 별도로 정합니다."
                                  : "고객 자동 등록이 꺼져 있어도 미리 설정할 수 있어요. 자동 등록을 켜면 이 조건이 적용됩니다."}
                            data-component={component("trigger-rules-client-registration-condition")}
                            className="md:col-span-2"
                          >
                            <div className="-mt-1">
                              {isClientRegistrationPolicyLoading ? (
                                <InfoRow
                                  data-component={component("trigger-rules-client-registration-condition-loading")}
                                  label="상태"
                                  value="설정 정보를 불러오는 중이에요."
                                />
                              ) : isClientRegistrationPolicyError ? (
                                <>
                                  <InfoRow
                                    data-component={component("trigger-rules-client-registration-condition-error")}
                                    label="상태"
                                    value="설정 정보를 불러오지 못했어요."
                                  />
                                  <div className="mt-3 flex justify-end">
                                    <Button
                                      type="button"
                                      variant="neutral"
                                      size="sm"
                                      onClick={() => void refetchClientRegistrationPolicy()}
                                      data-component={component("trigger-rules-client-registration-condition-retry")}
                                    >
                                      다시 시도
                                    </Button>
                                  </div>
                                </>
                              ) : (
                                <InfoRow
                                  data-component={component("trigger-rules-client-registration-condition-toggle")}
                                  label="전자문서 자동 등록 고객에게도 발송"
                                  value={(
                                    <Switch
                                      aria-label="전자문서 자동 등록 고객에게도 발송"
                                      checked={clientRegistrationPolicy?.greetingOnAutoRegistration === true}
                                      disabled={clientRegistrationPolicy === undefined || updateClientRegistrationPolicyMutation.isPending}
                                      onCheckedChange={(checked) => {
                                        updateClientRegistrationPolicyMutation.mutate({ greetingOnAutoRegistration: checked });
                                      }}
                                    />
                                  )}
                                />
                              )}
                            </div>
                          </InfoCard>
                        ) : null}

                        <InfoCard
                          title="필수 자동 입력 정보"
                          description={requiredTemplateVariables.length > 0
                            ? "발송 전에 아래 정보가 준비되어 있는지 확인해 주세요."
                            : "이 템플릿은 추가 정보 없이 발송할 수 있습니다."}
                          data-component={component("trigger-rules-required-variables")}
                          className="md:col-span-2"
                        >
                          <div
                            data-component={component("trigger-rules-required-variables-content")}
                            data-slot="required-variables-content"
                            className="grid gap-[calc(12px*var(--glint-ui-scale,1))]"
                          >
                            <p
                              data-component={component("trigger-rules-required-variables-guidance")}
                              data-slot="required-variables-guidance"
                              className="text-[calc(12px*var(--glint-ui-scale,1))] leading-relaxed text-v3-text-muted"
                            >
                              {requiredTemplateVariables.length > 0
                                ? "고객 정보에서 자동으로 입력되며, 필수값이 비어 있으면 잘못된 메시지 대신 발송이 안전하게 중단돼요."
                                : "추가 입력 없이 저장된 메시지 내용 그대로 발송됩니다."}
                              {formState.templateKey === "PRICE_INFO"
                                ? " 비용 안내는 고객의 관할 지역과 계좌 정보가 모두 필요합니다."
                                : ""}
                            </p>
                            {requiredTemplateVariables.length > 0 ? (
                              <div
                                data-component={component("trigger-rules-required-variable-list")}
                                data-slot="required-variable-list"
                                className="flex flex-wrap gap-[calc(8px*var(--glint-ui-scale,1))]"
                              >
                                {requiredTemplateVariables.map((variable) => (
                                  <Badge
                                    key={variable.key}
                                    variant="outline"
                                    data-component={component(`trigger-rules-required-variable-${variable.key}`)}
                                  >
                                    {variable.label}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                            {unsupportedRequiredCustomVariables.length > 0 ? (
                              <p
                                data-component={component("trigger-rules-required-custom-variable-warning")}
                                data-slot="required-custom-variable-warning"
                                className="text-[calc(12px*var(--glint-ui-scale,1))] leading-relaxed text-v3-burgundy"
                              >
                                자동 입력 출처가 없는 필수 변수(
                                {unsupportedRequiredCustomVariables.map((variable) => variable.label).join(", ")}
                                )가 있어 이 규칙을 저장할 수 없습니다. 템플릿 변수를 기본 고객 정보에 연결해 주세요.
                              </p>
                            ) : null}
                          </div>
                        </InfoCard>
                      </SteppedWizardPanelContent>
                    ),
                  },
                  {
                    key: "preview",
                    className: "flex min-h-0 justify-center",
                    children: (
                      <MessagePhonePreview
                        className="h-full min-h-0 overflow-hidden py-0"
                        content={selectedTemplateMessage}
                        templateName={selectedTemplate?.name ?? "발송 템플릿"}
                        headline={selectedTemplate?.name ?? "발송 템플릿"}
                        subtitle={
                          selectedTemplate?.description ??
                          selectedSystemTemplate?.description ??
                          "선택한 발송 템플릿 미리보기입니다."
                        }
                        dataComponentPrefix={component("phone-preview")}
                        panelDataComponent={component("template-preview-phone-panel")}
                      />
                    ),
                  },
                ]}
              />
            </DetailPanel>
          )}
        </SplitLayout>
        <TwoButtonModal
          open={parentActivationRule !== null}
          onOpenChange={(open) => {
            if (open || parentActivationMutation.isPending || isParentActivationPending || parentActivationPendingRef.current) return;
            setParentActivationRule(null);
            setParentActivationError(null);
          }}
          title="이 지점의 메시지 자동 발송을 켤까요?"
          description={parentActivationRule
            ? `메시지 자동 발송과 선택한 “${parentActivationRule.name}” 규칙을 함께 켭니다. 다른 꺼진 규칙은 그대로 유지됩니다.`
            : "메시지 자동 발송과 선택한 규칙을 함께 켭니다. 다른 꺼진 규칙은 그대로 유지됩니다."}
          isDescriptionVisuallyHidden={false}
          size="detail"
          cancelLabel="취소"
          approvalLabel="확인"
          pendingLabel="처리 중..."
          isPending={parentActivationMutation.isPending || isParentActivationPending}
          onApprove={() => void handleConfirmParentActivation()}
          dataComponent={component("trigger-rules-parent-activation-modal")}
        >
          {parentActivationError ? (
            <p
              role="alert"
              data-component={component("trigger-rules-parent-activation-modal-error")}
              className="text-sm text-v3-burgundy"
            >
              {parentActivationError}
            </p>
          ) : null}
        </TwoButtonModal>
      </div>
    </section>
  );
}
