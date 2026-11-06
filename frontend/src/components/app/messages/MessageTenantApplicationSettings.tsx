"use client";


import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getUserErrorMessage } from "@babyjamjam/shared";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  CheckCircle2,
  Clock3,
  ExternalLink,
  History,
  Repeat2,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useActiveBranchId, isBranchContextAligned } from "@/features/system-templates/branch-context";
import { FormSection, FormGrid, FormField, FormTextInput, FormSwitchRow, FormChip } from "@/components/app/ui/form-section";
import { messagePolicyApi, type MessageAutomationPolicyConfiguration, type MessageAutomationPolicyConfigResponse, type MessageAutomationPolicyPreviewResponse } from "@/services/settings";
import { mergeRuleOrder } from "@babyjamjam/shared/utils/rule-order";
import {
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  DetailEmptyState,
  DetailPanel,
  InfoCard,
  InfoRow,
  ListEmptyState,
  ListPanel,
} from "@/components/app/v3";
import { SelectableItemFrame } from "@/components/ui/selectable-item";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { QueryErrorState } from "@/components/app/ui/QueryErrorState";
import { isTriggerRuleInChannel } from "@/features/message-triggers/channel";
import { useMessageTriggerRules } from "@/features/message-triggers/hooks/use-message-triggers";
import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import type {
  MessageTriggerRule,
  TriggerEventType,
  TriggerOffsetType,
  TriggerRecipientType,
} from "@/features/message-triggers/types";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { useToast } from "@/hooks/use-toast";
import {
  settingsApi,
  type MessagePolicyActivationResponse,
  type MessageAutomationPoliciesResponse,
  type MessageAutomationPolicy,
} from "@/services/api";

const UNIFIED_SENDER_PHONE = "010-9641-1878";
const DUPLICATE_SEND_POLICY_ITEM_ID = "duplicate-send-confirmation";
const SERVICE_RECORD_LINK_POLICY_ID = "service-feedback-link";
// Branchless system rule anchoring manual receipt-link sends; not an automatic routine.
const MANUAL_SERVICE_END_NOTICE_RULE_ID = "system:service_end_notice";
const SMS_RETRY_POLICY_ID = "sms-retry";
const PAST_TRIGGER_POLICY_ID = "past-trigger";
const TRIGGER_DISPATCH_POLICY_ID = "trigger-dispatch";
const MESSAGE_AUTOMATION_POLICIES_QUERY_KEY = [
  "settings",
  "message-automation-policies",
] as const;
const TRIGGER_DISPATCH_SCOPE_COPY =
  "현재 지점의 메시지 자동 발송을 관리합니다. 끄면 이 지점의 자동 전송 규칙이 모두 비활성화됩니다.";
const TRIGGER_EVENT_LABELS: Record<TriggerEventType, string> = {
  CLIENT_CREATED: "고객 등록",
  SERVICE_START: "서비스 시작",
  SERVICE_END: "서비스 종료",
  EMPLOYEE_ASSIGNED: "제공인력 배정",
};

const TRIGGER_RECIPIENT_LABELS: Record<TriggerRecipientType, string> = {
  CLIENT: "고객",
  PRIMARY_EMPLOYEE: "주 담당 제공인력",
  SECONDARY_EMPLOYEE: "보조 제공인력",
};

const TRIGGER_OFFSET_LABELS: Record<TriggerEventType, Record<TriggerOffsetType, string>> = {
  CLIENT_CREATED: {
    IMMEDIATE: "즉시 발송",
    SAME_DAY: "등록 당일",
    BEFORE_DAYS: "등록 N일 전",
    AFTER_DAYS: "등록 N일 후",
  },
  SERVICE_START: {
    IMMEDIATE: "즉시 발송",
    SAME_DAY: "시작 당일",
    BEFORE_DAYS: "시작 N일 전",
    AFTER_DAYS: "시작 N일 후",
  },
  SERVICE_END: {
    IMMEDIATE: "즉시 발송",
    SAME_DAY: "종료 당일",
    BEFORE_DAYS: "종료 N일 전",
    AFTER_DAYS: "종료 N일 후",
  },
  EMPLOYEE_ASSIGNED: {
    IMMEDIATE: "즉시 발송",
    SAME_DAY: "배정 당일",
    BEFORE_DAYS: "배정 N일 전",
    AFTER_DAYS: "배정 N일 후",
  },
};

const ALIGO_POLICY_ITEMS = [
  {
    id: "aligo-terms",
    text: "알리고 문자 서비스 이용약관에 동의합니다.",
    sourceLabel: "알리고 회원가입",
    sourceHref: "https://smartsms.aligo.in/join.html",
  },
  {
    id: "aligo-privacy-third-party",
    text: "메시지 발송 기능 제공을 위해 필요한 개인정보를 제3자에게 제공하는 데 동의합니다.",
    sourceLabel: "알리고 회원가입",
    sourceHref: "https://smartsms.aligo.in/join.html",
  },
  {
    id: "sender-number",
    text: "발신번호는 사이트 내에 사전 등록된 번호만 사용할 수 있음을 확인했습니다.",
    sourceLabel: "알리고 API SPEC",
    sourceHref: "https://smartsms.aligo.in/admin/api/spec.html",
  },
] as const;

const CURRENT_TENANT_ITEM_ID = "current-tenant";

type TenantApplicationListItem = {
  id: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  icon: typeof Building2;
  kind: "tenant-application" | "automation-policy" | "duplicate-send-policy";
  active: boolean;
  requiresApproval: boolean;
  activationUnavailable?: boolean;
  rows?: MessageAutomationPolicy["rows"];
};

const DUPLICATE_SEND_POLICY_ITEM: TenantApplicationListItem = {
  id: DUPLICATE_SEND_POLICY_ITEM_ID,
  title: "중복 전송 확인",
  subtitle: "72시간 내 같은 번호와 같은 메시지는 전송 전 확인합니다.",
  statusLabel: "활성",
  icon: Repeat2,
  kind: "duplicate-send-policy",
  active: true,
  requiresApproval: true,
};

function formatRequestedAt(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getAutomationPolicyIcon(policyId: string) {
  if (policyId === PAST_TRIGGER_POLICY_ID) {
    return History;
  }

  if (policyId === SMS_RETRY_POLICY_ID) {
    return Repeat2;
  }

  return ShieldCheck;
}

function getPolicyStatusLabel(active: boolean) {
  return active ? "활성" : "비활성";
}

function getAutomationPolicyDataComponent(policyId: string) {
  return `desktop_messages_sections_split-layout_detail-panel-2_${policyId}-policy`;
}

function formatTriggerOffset(rule: MessageTriggerRule) {
  const offsetLabel = TRIGGER_OFFSET_LABELS[rule.eventType]?.[rule.offsetType] ?? rule.offsetType;

  if (rule.offsetType === "BEFORE_DAYS" || rule.offsetType === "AFTER_DAYS") {
    return offsetLabel.replace("N", String(rule.offsetDays || 0));
  }

  return offsetLabel;
}

function getTriggerRuleSummary(rule: MessageTriggerRule) {
  const eventLabel = TRIGGER_EVENT_LABELS[rule.eventType] ?? rule.eventType;
  const recipientLabel = TRIGGER_RECIPIENT_LABELS[rule.recipientType] ?? rule.recipientType;

  const timeLabel = rule.offsetType === "IMMEDIATE" ? "" : ` ${rule.sendTime ?? "09:00"} (한국 시간)`;
  return `${eventLabel} · ${formatTriggerOffset(rule)}${timeLabel} · ${recipientLabel}`;
}

function getOrderedTriggerRules(rules: MessageTriggerRule[], orderIds: string[]) {
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
  const ordered = orderIds
    .map((id) => rulesById.get(id))
    .filter((rule): rule is MessageTriggerRule => Boolean(rule));
  const orderedIds = new Set(ordered.map((rule) => rule.id));
  const missing = rules.filter((rule) => !orderedIds.has(rule.id));

  return [...ordered, ...missing];
}

function withTriggerDispatchActivation(
  current: MessageAutomationPoliciesResponse | undefined,
  enabled: boolean,
): MessageAutomationPoliciesResponse | undefined {
  if (!current) return current;

  return {
    ...current,
    policies: current.policies.map((policy) =>
      policy.id === TRIGGER_DISPATCH_POLICY_ID ? { ...policy, active: enabled } : policy,
    ),
    policyActivations: {
      ...current.policyActivations,
      [TRIGGER_DISPATCH_POLICY_ID]: enabled,
    },
  };
}

async function invalidateMessageAutomationCaches(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: MESSAGE_AUTOMATION_POLICIES_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all }),
    queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() }),
    queryClient.invalidateQueries({ queryKey: messageTriggerKeys.history() }),
  ]);
}

const POLICY_FIELDS = {
  "trigger-dispatch": [["dispatchCheckIntervalMinutes", "자동 작업 확인 간격", 1, 1440, "분"], ["defaultRuleSendTime", "새 규칙 기본 발송 시각", 0, 0, "한국 시간"]],
  "trigger-job-retry": [["triggerRetryIntervalMinutes", "자동 작업 재시도 간격", 1, 1440, "분"], ["processingReclaimMinutes", "처리 중 작업 회수 시간", 10, 1440, "분"]],
  "sms-retry": [["smsRetryIntervalMinutes", "문자 재시도 간격", 1, 1440, "분"]],
  "past-trigger": [["pastExpiryHours", "지난 자동 전송 유효 시간", 1, 720, "시간"], ["pastSendIntervalMinutes", "늦은 등록 자동 전송 간격", 1, 1440, "분"]],
  "duplicate-send-confirmation": [["duplicateWindowHours", "중복 확인 범위", 1, 720, "시간"]],
} as const;
const QUIET_POLICY_ID = "quiet-hours";
const RECIPIENT_GROUP_LABELS = { CLIENT: "고객", CAREGIVER: "제공인력", STAFF: "직원" } as const;
const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
function configurationErrors(config: MessageAutomationPolicyConfiguration): string[] {
  const errors: string[] = [];
  for (const fields of Object.values(POLICY_FIELDS)) for (const [key, label, min, max] of fields) {
    const value = config[key];
    if (key === "defaultRuleSendTime") { if (!validTime(String(value))) errors.push(`${label}을 입력해 주세요.`); }
    else if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) errors.push(`${label}은 ${min}~${max} 사이의 정수로 입력해 주세요.`);
  }
  if (!validTime(config.quietHours.start) || !validTime(config.quietHours.end)) errors.push("심야 시작·종료 시각을 입력해 주세요.");
  if (config.quietHours.start === config.quietHours.end) errors.push("심야 시작과 종료 시각은 달라야 해요.");
  if (config.quietHours.enabled && config.quietHours.recipientGroups.length === 0) errors.push("전송 금지 대상을 한 개 이상 선택해 주세요.");
  return errors;
}

export function MessageTenantApplicationSettings() {
  const branchId = useActiveBranchId();
  const branchRef = useRef(branchId);
  branchRef.current = branchId;
  const configKey = ["settings", "message-automation-config", branchId] as const;
  const configQuery = useQuery({ queryKey: configKey, queryFn: () => messagePolicyApi.getConfiguration(branchId!), enabled: !!branchId });
  const [draft, setDraft] = useState<{ branchId: string; configuration: MessageAutomationPolicyConfiguration } | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [impact, setImpact] = useState<MessageAutomationPolicyPreviewResponse | null>(null);
  const persisted = configQuery.data;
  const configuration = draft?.branchId === branchId ? draft.configuration : persisted?.configuration;
  const configurationRef = useRef(configuration); configurationRef.current = configuration;
  const dirty = !!configuration && JSON.stringify(configuration) !== JSON.stringify(persisted?.configuration);
  const errors = configuration ? configurationErrors(configuration) : [];
  const editable = !!branchId && !!persisted?.permissions.canWrite && !configQuery.isError;
  const editConfiguration = (update: (current: MessageAutomationPolicyConfiguration) => MessageAutomationPolicyConfiguration) => {
    if (!editable || !configuration || !branchId) return;
    setDraft({ branchId, configuration: update(configuration) });
    setImpact(null); setConfigError(null);
  };
  useEffect(() => {
    setDraft(null); setConfigError(null); setImpact(null);
  }, [branchId]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.("a[href]");
      if (anchor && !window.confirm("저장하지 않은 변경 내용을 버리고 이동할까요?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty]);
  const { data: authUser } = useGetAuthUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const {
    data: messageSenderApproval,
    isLoading: isMessageSenderApprovalQueryLoading,
    isPaused: isMessageSenderApprovalPaused,
    isError: isMessageSenderApprovalError,
    isFetching: isMessageSenderApprovalFetching,
    refetch: refetchMessageSenderApproval,
  } = useQuery({
    queryKey: ["settings", "message-sender-approval"],
    queryFn: settingsApi.getMessageSenderApproval,
  });
  // A paused load with no data has not started: it reads as loading, never as an answer.
  const isMessageSenderApprovalLoading =
    isMessageSenderApprovalQueryLoading ||
    (isMessageSenderApprovalPaused && messageSenderApproval === undefined);
  const {
    data: messageAutomationPolicies,
    isLoading: isMessageAutomationPoliciesQueryLoading,
    isPaused: isMessageAutomationPoliciesPaused,
    isError: isMessageAutomationPoliciesError,
    refetch: refetchMessageAutomationPolicies,
  } = useQuery({
    queryKey: MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
    queryFn: settingsApi.getMessageAutomationPolicies,
  });
  const isMessageAutomationPoliciesLoading =
    isMessageAutomationPoliciesQueryLoading ||
    (isMessageAutomationPoliciesPaused && messageAutomationPolicies === undefined);
  const {
    data: triggerRulesData,
    isLoading: isTriggerRulesQueryLoading,
    isPaused: isTriggerRulesPaused,
    isError: isTriggerRulesError,
    isFetching: isTriggerRulesFetching,
    refetch: refetchTriggerRules,
  } = useMessageTriggerRules();
  const isTriggerRulesLoading =
    isTriggerRulesQueryLoading || (isTriggerRulesPaused && triggerRulesData === undefined);
  const isTriggerRulesLoadFailed = isTriggerRulesError && triggerRulesData === undefined;
  const isTriggerRulesRefreshFailed = isTriggerRulesError && triggerRulesData !== undefined;
  const [agreements, setAgreements] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ALIGO_POLICY_ITEMS.map((item) => [item.id, false])),
  );
  const [requestedAt, setRequestedAt] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);


  const tenantName = authUser?.branchName?.trim() || "현재 선택된 지점";
  const allAgreed = ALIGO_POLICY_ITEMS.every((item) => agreements[item.id]);
  const canSubmit = allAgreed;
  const isMessageSenderApproved = messageSenderApproval?.isApproved === true;
  // A failed approval load with no earlier answer is neither "approved" nor "not approved".
  const isMessageSenderApprovalUnknown =
    messageSenderApproval === undefined && isMessageSenderApprovalError;
  const isMessageSettingsListLoading =
    isMessageSenderApprovalLoading || isMessageAutomationPoliciesLoading;
  const isAdminOrOwner = messageAutomationPolicies?.canManageActivation === true;
  const triggerDispatchPolicy = messageAutomationPolicies?.policies?.find(
    (policy) => policy.id === TRIGGER_DISPATCH_POLICY_ID,
  );
  const triggerDispatchActive =
    isMessageAutomationPoliciesLoading || isMessageAutomationPoliciesError
      ? null
      : typeof triggerDispatchPolicy?.active === "boolean"
      ? triggerDispatchPolicy.active
      : typeof messageAutomationPolicies?.policyActivations?.[TRIGGER_DISPATCH_POLICY_ID] === "boolean"
        ? messageAutomationPolicies.policyActivations[TRIGGER_DISPATCH_POLICY_ID]
        : null;
  const isTriggerDispatchAvailable =
    !isMessageAutomationPoliciesLoading &&
    !isMessageAutomationPoliciesError &&
    triggerDispatchPolicy !== undefined &&
    triggerDispatchActive !== null;
  const isTriggerDispatchUnavailable = !isTriggerDispatchAvailable;
  const listItems = useMemo<TenantApplicationListItem[]>(
    () => {
      if (isMessageSettingsListLoading) {
        return [];
      }

      const items: TenantApplicationListItem[] = [];

      if (!isMessageSenderApproved && !isMessageSenderApprovalUnknown) {
        items.push({
          id: CURRENT_TENANT_ITEM_ID,
          title: "메시지 발송 기능 신청",
          subtitle: requestedAt
            ? `신청 접수 ${requestedAt}`
            : "알리고 정책 동의 후 신청해 주세요.",
          statusLabel: requestedAt ? "접수됨" : canSubmit ? "준비 완료" : "작성 중",
          icon: Building2,
          kind: "tenant-application",
          active: true,
          requiresApproval: true,
        });
      }

      const automationPolicyItems = (messageAutomationPolicies?.policies ?? [])
        .filter((policy) => policy.id !== SERVICE_RECORD_LINK_POLICY_ID)
        .map<TenantApplicationListItem>(
          (policy) => {
            const isTriggerDispatch = policy.id === TRIGGER_DISPATCH_POLICY_ID;
            const active = isTriggerDispatch
              ? triggerDispatchActive === true
              : policy.active;

            return {
              id: policy.id,
              title: policy.title,
              subtitle: isTriggerDispatch
                ? `${policy.description} ${TRIGGER_DISPATCH_SCOPE_COPY}`
                : policy.description,
              statusLabel: isTriggerDispatch && isTriggerDispatchUnavailable
                ? "확인 필요"
                : getPolicyStatusLabel(active),
              icon: getAutomationPolicyIcon(policy.id),
              kind: "automation-policy",
              active,
              requiresApproval: policy.requiresApproval,
              activationUnavailable: isTriggerDispatch && isTriggerDispatchUnavailable,
              rows: policy.rows,
            };
          },
        );

      items.push(...automationPolicyItems.filter((item) => item.id !== DUPLICATE_SEND_POLICY_ITEM_ID), {
        ...DUPLICATE_SEND_POLICY_ITEM,
        subtitle: configuration ? `${configuration.duplicateWindowHours}시간 내 같은 번호와 같은 메시지는 전송 전 확인합니다.` : "중복 확인 정책을 불러옵니다.",
      }, {
        id: QUIET_POLICY_ID, title: "심야 시간 메세지 전송 금지", subtitle: "지정한 한국 시간 동안 SMS/LMS 전송을 제한합니다.",
        statusLabel: !configuration || configQuery.isError ? "확인 필요" : configuration.quietHours.enabled ? "활성" : "비활성", icon: Clock3, kind: "automation-policy", active: configuration?.quietHours.enabled === true, requiresApproval: false, activationUnavailable: !configuration || configQuery.isError,
      });

      return items;
    },
    [
      configuration,
      configQuery.isError,
      canSubmit,
      isTriggerDispatchUnavailable,
      isMessageSettingsListLoading,
      isMessageSenderApproved,
      isMessageSenderApprovalUnknown,
      messageAutomationPolicies?.policies,
      requestedAt,
      triggerDispatchActive,
    ],
  );
  const fallbackSelectedItemId = isMessageSenderApproved || isMessageSenderApprovalUnknown
    ? (listItems.find((item) => item.kind === "automation-policy")?.id ?? DUPLICATE_SEND_POLICY_ITEM_ID)
    : CURRENT_TENANT_ITEM_ID;
  const selectedItem = listItems.find((item) => item.id === (selectedItemId ?? fallbackSelectedItemId))
    ?? listItems[0]
    ?? null;
  const SelectedItemIcon = selectedItem?.icon ?? ShieldCheck;
  const activeSmsTriggerRules = useMemo(
    () => (Array.isArray(triggerRulesData) ? triggerRulesData : [])
      .filter((rule) =>
        (isTriggerDispatchAvailable && triggerDispatchActive === false ? false : rule.isActive) &&
        rule.id !== MANUAL_SERVICE_END_NOTICE_RULE_ID &&
        isTriggerRuleInChannel(rule, "sms"),
      ),
    [isTriggerDispatchAvailable, triggerDispatchActive, triggerRulesData],
  );
  const retroactiveRuleOrderIds = configuration?.pastRuleOrder ?? [];
  const retroactiveTriggerOrderItems = useMemo(
    () => getOrderedTriggerRules(activeSmsTriggerRules, retroactiveRuleOrderIds),
    [activeSmsTriggerRules, retroactiveRuleOrderIds],
  );
  const moveRetroactiveRuleOrder = (ruleId: string, direction: -1 | 1) => {
    const ids = retroactiveTriggerOrderItems.map((item) => item.id);
    const index = ids.indexOf(ruleId); const next = index + direction;
    if (index < 0 || next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    editConfiguration((current) => ({ ...current, pastRuleOrder: mergeRuleOrder(current.pastRuleOrder, ids) }));
  };

  const toggleAgreement = (id: string, checked: boolean) => {
    setAgreements((previous) => ({
      ...previous,
      [id]: checked,
    }));
  };

  const requestApprovalMutation = useMutation({
    mutationFn: settingsApi.requestMessageSenderApproval,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings", "message-sender-approval"] });
      setRequestedAt(formatRequestedAt(new Date()));
      toast({ variant: "success", description: `${tenantName} 메시지 발송 신청을 접수했어요` });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "메시지 발송을 신청하지 못했어요. 잠시 후 다시 시도해 주세요",
      });
    },
  });

  const triggerDispatchMutation = useMutation<
    MessagePolicyActivationResponse,
    Error,
    boolean,
    { previous?: MessageAutomationPoliciesResponse }
  >({
    mutationFn: settingsApi.updateMessagePolicyActivation,
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: MESSAGE_AUTOMATION_POLICIES_QUERY_KEY });
      const previous = queryClient.getQueryData<MessageAutomationPoliciesResponse>(
        MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
      );
      queryClient.setQueryData<MessageAutomationPoliciesResponse>(
        MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
        (current) => withTriggerDispatchActivation(current, enabled),
      );
      return { previous };
    },
    onError: (error, _enabled, context) => {
      if (context?.previous) {
        queryClient.setQueryData(MESSAGE_AUTOMATION_POLICIES_QUERY_KEY, context.previous);
      }
      toast({
        variant: "destructive",
        description: getUserErrorMessage(error, "이 지점의 메시지 자동 발송 설정을 저장하지 못했어요"),
      });
    },
    onSuccess: (savedActivation) => {
      queryClient.setQueryData<MessageAutomationPoliciesResponse>(
        MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
        (current) => withTriggerDispatchActivation(current, savedActivation.enabled),
      );
      toast({
        variant: "success",
        description: savedActivation.enabled
          ? "이 지점의 메시지 자동 발송을 켰어요"
          : "이 지점의 메시지 자동 발송을 껐어요",
      });
    },
    onSettled: async () => {
      await invalidateMessageAutomationCaches(queryClient);
    },
  });

  const handleTriggerDispatchToggle = (enabled: boolean) => {
    if (!isAdminOrOwner) return;
    if (isTriggerDispatchUnavailable) {
      void refetchMessageAutomationPolicies();
      toast({
        variant: "destructive",
        description: "이 지점의 메시지 자동 발송 설정을 확인한 뒤 다시 시도해 주세요.",
      });
      return;
    }
    triggerDispatchMutation.mutate(enabled);
  };

  const saveConfiguration = useMutation({
    mutationFn: async (input: { branchId: string; expectedVersion: string | null; configuration: MessageAutomationPolicyConfiguration }) => {
      if (!isBranchContextAligned(input.branchId)) throw new Error("지점이 변경되어 저장할 수 없어요.");
      return messagePolicyApi.saveConfiguration({ expectedVersion: input.expectedVersion, configuration: input.configuration }, input.branchId);
    },
    onSuccess: (saved, submitted) => {
      queryClient.setQueryData<MessageAutomationPolicyConfigResponse>(["settings", "message-automation-config", submitted.branchId], saved);
      if (branchRef.current !== submitted.branchId) return;
      setDraft((current) => current?.branchId === submitted.branchId && JSON.stringify(current.configuration) === JSON.stringify(submitted.configuration) ? null : current);
      setConfigError(null); setImpact(null);
      void queryClient.invalidateQueries({ queryKey: MESSAGE_AUTOMATION_POLICIES_QUERY_KEY });
    },
    onError: (error, submitted) => {
      if (branchRef.current !== submitted.branchId) return;
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status !== 409) setDraft((current) => current?.branchId === submitted.branchId && JSON.stringify(current.configuration) === JSON.stringify(submitted.configuration) ? null : current);
      setConfigError(status === 409 ? "다른 곳에서 설정이 변경됐어요. 변경 내용을 확인하고 새로고침해 주세요." : "설정을 저장하지 못했어요. 다시 시도해 주세요.");
    },
  });
  const previewConfiguration = useMutation({
    mutationFn: async (input: { branchId: string; expectedVersion: string | null; configuration: MessageAutomationPolicyConfiguration }) => messagePolicyApi.previewConfiguration({ expectedVersion: input.expectedVersion, configuration: input.configuration }, input.branchId),
    onSuccess: (value, submitted) => { if (branchRef.current === submitted.branchId && JSON.stringify(configurationRef.current) === JSON.stringify(submitted.configuration)) setImpact(value); },
    onError: (_error, submitted) => { if (branchRef.current === submitted.branchId && JSON.stringify(configurationRef.current) === JSON.stringify(submitted.configuration)) setConfigError("설정 영향을 확인하지 못했어요. 다시 시도해 주세요."); },
  });
  const footerBase = selectedItem?.kind === "duplicate-send-policy" ? "desktop_messages_sections_split-layout_detail-panel-4_actions" : "desktop_messages_sections_split-layout_detail-panel-2_actions";
  const configFooter = <div data-component={footerBase} className="ml-auto flex gap-3">
    <Button data-component={`${footerBase}_cancel`} type="button" variant="neutral" disabled={!dirty} onClick={() => { setDraft(null); setConfigError(null); setImpact(null); }}>변경 취소</Button>
    <Button data-component={`${footerBase}_save`} type="button" variant="positive" disabled={!editable || !dirty || errors.length > 0 || saveConfiguration.isPending || (selectedItem?.id === PAST_TRIGGER_POLICY_ID && isTriggerRulesLoadFailed)} onClick={() => {
      if (configuration && persisted && branchId && errors.length === 0) saveConfiguration.mutate({ branchId, expectedVersion: persisted.version, configuration: JSON.parse(JSON.stringify(configuration)) as MessageAutomationPolicyConfiguration });
    }}>{saveConfiguration.isPending ? "저장 중..." : "저장"}</Button>
  </div>;
  const renderConfigFields = (policyId: string) => {
    const base = policyId === DUPLICATE_SEND_POLICY_ITEM_ID ? "desktop_messages_sections_split-layout_detail-panel-4_duplicate-send-policy_form" : `${getAutomationPolicyDataComponent(policyId)}_form`;
    if (!configuration && !configQuery.isError) return <InfoRow data-component={`${base}_loading`} label="상태" value="설정을 불러오는 중입니다." />;
    if (!configuration || configQuery.isError) return <QueryErrorState dataComponent={`${base}_error`} title="설정을 불러오지 못했습니다" onRetry={() => void configQuery.refetch()} />;
    return <FormSection title="설정" data-component={base}>
      <FormGrid data-component={`${base}_fields`}>
        {(POLICY_FIELDS[policyId as keyof typeof POLICY_FIELDS] ?? []).map(([key, label, min, max, unit]) => <FormField key={key} label={`${label} (${unit})`} htmlFor={`policy-${key}`} data-component={`${base}_${key}`}>
          <FormTextInput id={`policy-${key}`} aria-label={label} type={key === "defaultRuleSendTime" ? "time" : "number"} min={min || undefined} max={max || undefined} step={key === "defaultRuleSendTime" ? undefined : 1} disabled={!editable} value={key === "defaultRuleSendTime" ? configuration[key] : Number.isFinite(configuration[key]) ? configuration[key] : ""} onChange={(event) => { const value = event.target.value; editConfiguration((current) => ({ ...current, [key]: key === "defaultRuleSendTime" ? value : value === "" ? NaN : Number(value), ...(key === "pastSendIntervalMinutes" ? { pastRuleOrder: mergeRuleOrder(current.pastRuleOrder, retroactiveTriggerOrderItems.map((rule) => rule.id)) } : {}) })); }} data-component={`${base}_${key}_input`} />
          <span>{key === "defaultRuleSendTime" ? `${configuration[key]} (한국 시간)` : `${configuration[key]}${unit}`}</span>
        </FormField>)}
      </FormGrid>
      {policyId === QUIET_POLICY_ID ? <>
        <FormSwitchRow title="심야 시간 메세지 전송 금지" buttonAriaLabel="심야 시간 메세지 전송 금지 활성화" checked={configuration.quietHours.enabled} disabled={!editable} onToggle={() => editConfiguration((current) => ({ ...current, quietHours: { ...current.quietHours, enabled: !current.quietHours.enabled } }))} data-component={`${base}_enabled`} />
        <FormGrid data-component={`${base}_time`}>
          {(["start", "end"] as const).map((key) => <FormField key={key} label={key === "start" ? "시작 시각 (한국 시간)" : "종료 시각 (한국 시간)"} htmlFor={`quiet-${key}`} data-component={`${base}_${key}`}><FormTextInput data-component={`${base}_${key}_input`} id={`quiet-${key}`} type="time" aria-label={key === "start" ? "심야 시작 시각" : "심야 종료 시각"} value={configuration.quietHours[key]} disabled={!editable} onChange={(event) => { const value = event.target.value; editConfiguration((current) => ({ ...current, quietHours: { ...current.quietHours, [key]: value } })); }} /></FormField>)}
        </FormGrid>
        <FormField label="전송 금지 대상 (여러 대상 선택 가능)" data-component={`${base}_targets`}><div className="flex flex-wrap gap-2">{(Object.keys(RECIPIENT_GROUP_LABELS) as Array<keyof typeof RECIPIENT_GROUP_LABELS>).map((group) => <FormChip data-component={`${base}_targets_${group}`} key={group} type="button" selected={configuration.quietHours.recipientGroups.includes(group)} aria-pressed={configuration.quietHours.recipientGroups.includes(group)} disabled={!editable} onClick={() => editConfiguration((current) => ({ ...current, quietHours: { ...current.quietHours, recipientGroups: current.quietHours.recipientGroups.includes(group) ? current.quietHours.recipientGroups.filter((item) => item !== group) : [...current.quietHours.recipientGroups, group] } }))}>{RECIPIENT_GROUP_LABELS[group]}</FormChip>)}</div></FormField>
        <FormField label="금지 시간에 발생한 메시지" data-component={`${base}_action`}><div className="flex gap-2">{(["DEFER", "CANCEL"] as const).map((action) => <FormChip data-component={`${base}_action_${action}`} type="button" key={action} selected={configuration.quietHours.action === action} aria-pressed={configuration.quietHours.action === action} disabled={!editable} onClick={() => editConfiguration((current) => ({ ...current, quietHours: { ...current.quietHours, action } }))}>{action === "DEFER" ? "금지 종료 후 순서대로 전송" : "발송 취소"}</FormChip>)}</div></FormField>
        <InfoRow data-component={`${base}_summary`} label="적용" value={configuration.quietHours.enabled ? `매일 ${configuration.quietHours.start}~${configuration.quietHours.end} (한국 시간), ${configuration.quietHours.recipientGroups.map((group) => RECIPIENT_GROUP_LABELS[group]).join("·")} SMS/LMS ${configuration.quietHours.action === "DEFER" ? "종료 후 순서대로 전송" : "발송 취소"}` : "심야 전송 제한 꺼짐"} />
        <p>SMS/LMS에만 적용합니다. 직원은 이 지점 소속 사용자입니다. 기존 보류 건은 설정을 끄거나 대상을 해제해도 바로 발송되지 않으며 다시 평가합니다.</p>
        <Button data-component={`${base}_preview`} type="button" variant="neutral" disabled={!branchId || errors.length > 0 || previewConfiguration.isPending} onClick={() => { if (branchId && persisted) previewConfiguration.mutate({ branchId, expectedVersion: persisted.version, configuration: JSON.parse(JSON.stringify(configuration)) as MessageAutomationPolicyConfiguration }); }}>영향 미리보기</Button>
        {impact ? <InfoCard title="설정 영향" data-component={`${base}_impact`}><InfoRow label="보류" value={`${impact.deferredCount}건`} /><InfoRow label="취소" value={`${impact.canceledCount}건`} /><InfoRow label="재평가 시각" value={impact.reevaluateAt ?? "없음"} /><InfoRow label="예약된 공급자 전송" value={`${impact.futureProviderReservations}건`} /></InfoCard> : null}
      </> : null}
      {errors.map((error) => <p role="alert" key={error}>{error}</p>)}
      {configError ? <p role="alert">{configError}</p> : null}
    </FormSection>;
  };

  const handleSubmit = () => {
    if (!allAgreed) {
      toast({ variant: "destructive", description: "알리고 정책 동의 항목을 모두 확인해 주세요" });
      return;
    }

    requestApprovalMutation.mutate();
  };
  const emptyListMessage = isMessageSettingsListLoading
    ? "설정 정보를 불러오는 중입니다."
    : "표시할 설정 항목이 없습니다.";
  const emptyDetailMessage = isMessageSettingsListLoading
    ? "설정 정보를 불러오는 중입니다."
    : "설정 항목을 선택해 주세요.";

  if (isMessageSettingsListLoading) {
    return (
      <div
        data-component="desktop_messages_sections_settings-layout"
        className="grid min-h-[560px] flex-1 gap-6 lg:grid-cols-[380px_1fr]"
      >
        <ListPanel data-component="desktop_messages_sections_split-layout_list-panel"
          title="설정"
          subtitle="메시지에 관련된 설정들을 정할 수 있어요"
        >
          <ListEmptyState
            message={emptyListMessage}
          />
        </ListPanel>

        <DetailPanel data-component="desktop_messages_sections_split-layout_detail-panel"
          title="설정"
          subtitle="메시지에 관련된 설정들을 정할 수 있어요"
        >
          <DetailEmptyState
            message={emptyDetailMessage}
          />
        </DetailPanel>
      </div>
    );
  }

  return (
    <div
      data-component="desktop_messages_sections_settings-tenant-application"
      className="grid min-h-[560px] flex-1 gap-6 lg:grid-cols-[380px_1fr]"
    >
      <ListPanel data-component="desktop_messages_sections_split-layout_list-panel-2"
        title="설정"
        subtitle="메시지에 관련된 설정들을 정할 수 있어요"
        headerActions={
          <span className="inline-flex items-center whitespace-nowrap rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
            {listItems.length}개
          </span>
        }
      >
        {isMessageSenderApprovalUnknown ? (
          <QueryErrorState
            dataComponent="desktop_messages_sections_settings-sender-approval-error"
            size="inline"
            title="발신 승인 상태를 불러오지 못했습니다"
            onRetry={() => void refetchMessageSenderApproval()}
            isRetrying={isMessageSenderApprovalFetching}
          />
        ) : null}
        {isTriggerDispatchUnavailable ? (
          <InfoCard
            title="메시지 자동 발송 상태"
            description="현재 지점의 메시지 자동 발송 설정을 확인할 수 없어요."
            data-component="desktop_messages_sections_settings-trigger-dispatch-error"
          >
            <InfoRow
              data-component="desktop_messages_sections_settings-trigger-dispatch-error_status"
              label="상태"
              value="설정을 불러오지 못했어요."
            />
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                variant="neutral"
                size="sm"
                onClick={() => void refetchMessageAutomationPolicies()}
                data-component="desktop_messages_sections_settings-trigger-dispatch-error_retry"
              >
                다시 시도
              </Button>
            </div>
          </InfoCard>
        ) : null}
        <AnimatedSlotList<TenantApplicationListItem>
          items={listItems}
          isLoading={false}
          className="space-y-2"
          getSlotState={({ item }) => ({
            isActive: item?.id === selectedItem?.id,
            isInteractive: Boolean(item),
          })}
          onSlotClick={(item) => { if (item.id === selectedItem?.id || !dirty || window.confirm("저장하지 않은 변경 내용을 버리고 이동할까요?")) { if (item.id !== selectedItem?.id) { setDraft(null); setConfigError(null); setImpact(null); } setSelectedItemId(item.id); } }}
          render={({ item }) => {
            if (!item) return null;

            return (
              <AnimatedSlotListItemContent
                dataComponent="desktop_messages_sections_settings-tenant-list"
                icon={item.icon}
                iconContainerClassName="bg-white text-v3-primary"
                title={item.title}
                subtitle={item.subtitle}
                status={
                  item.kind === "tenant-application" ? (
                    <span className="inline-flex items-center rounded-full bg-white/85 px-2 py-0.5 text-[0.68rem] font-semibold text-v3-primary">
                      {item.statusLabel}
                    </span>
                  ) : item.id === QUIET_POLICY_ID && item.activationUnavailable ? <span>확인 필요</span> : item.requiresApproval &&
                    item.id !== TRIGGER_DISPATCH_POLICY_ID &&
                    isMessageSenderApprovalUnknown ? (
                    // An "off" switch derived from an unknown approval would be a definite value.
                    undefined
                  ) : (
                    <Switch
                      aria-label={`${item.title} 활성화`}
                      checked={item.id === QUIET_POLICY_ID ? configuration?.quietHours.enabled === true : item.id === TRIGGER_DISPATCH_POLICY_ID
                        ? item.active
                        : item.requiresApproval ? (isMessageSenderApproved && item.active) : item.active}
                      disabled={item.id === QUIET_POLICY_ID ? !editable : item.id === TRIGGER_DISPATCH_POLICY_ID
                        ? !isAdminOrOwner || item.activationUnavailable === true || triggerDispatchMutation.isPending
                        : true}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
                      onCheckedChange={item.id === QUIET_POLICY_ID ? (enabled) => editConfiguration((current) => ({ ...current, quietHours: { ...current.quietHours, enabled } })) : item.id === TRIGGER_DISPATCH_POLICY_ID
                        ? (checked) => handleTriggerDispatchToggle(checked)
                        : undefined}
                      className="ml-auto shrink-0"
                    />
                  )
                }
              />
            );
          }}
        />
      </ListPanel>

      {selectedItem?.kind === "automation-policy" ? (
        <DetailPanel data-component="desktop_messages_sections_split-layout_detail-panel-2"
          avatar={
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
              <SelectedItemIcon className="h-5 w-5" />
            </div>
          }
          title={selectedItem.title}
          subtitle={selectedItem.subtitle}
          trailing={
            <span className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
              {selectedItem.statusLabel}
            </span>
          }
          footer={configFooter}
        >
          <div data-component={getAutomationPolicyDataComponent(selectedItem.id)} className="space-y-4">
            {renderConfigFields(selectedItem.id)}
            <InfoCard
              data-component={`${getAutomationPolicyDataComponent(selectedItem.id)}-card`}
              title="규칙"
            >
              <div className="-mt-1">
                {(selectedItem.rows ?? []).map((item) => (
                  <InfoRow
                    key={item.id}
                    data-component={`${getAutomationPolicyDataComponent(selectedItem.id)}-${item.id}`}
                    label={item.label}
                    value={item.value}
                  />
                ))}

              </div>
            </InfoCard>

            {selectedItem.id === PAST_TRIGGER_POLICY_ID ? (
              <InfoCard
                data-component="desktop_messages_sections_settings-past-trigger-policy-order-card"
                title="늦은 등록 자동 전송 순서"
              >
                <div
                  data-component="desktop_messages_sections_settings-past-trigger-policy-order-card_form"
                  className="-mt-1"
                >
                  {isTriggerRulesRefreshFailed ? (
                    <QueryErrorState
                      dataComponent="desktop_messages_sections_settings-past-trigger-policy-order-card_form_refresh-error"
                      size="inline"
                      title="최신 정보를 불러오지 못했습니다"
                      onRetry={() => void refetchTriggerRules()}
                      isRetrying={isTriggerRulesFetching}
                    />
                  ) : null}
                  {isTriggerRulesLoading ? (
                    <InfoRow
                      data-component="desktop_messages_sections_settings-past-trigger-policy-order-card_form_loading"
                      label="상태"
                      value="자동 전송 루틴을 불러오는 중"
                    />
                  ) : isTriggerRulesLoadFailed ? (
                    <QueryErrorState
                      dataComponent="desktop_messages_sections_settings-past-trigger-policy-order-card_form_load-error"
                      size="inline"
                      title="자동 전송 루틴을 불러오지 못했습니다"
                      onRetry={() => void refetchTriggerRules()}
                      isRetrying={isTriggerRulesFetching}
                    />
                  ) : retroactiveTriggerOrderItems.length > 0 ? retroactiveTriggerOrderItems.map((item, index) => (
                    <InfoRow
                      key={item.id}
                      data-component={`desktop_messages_sections_settings-past-trigger-policy-order-card_form_${item.id}`}
                      label={`${index + 1}순위`}
                      value={
                        <div className="flex min-w-0 items-center justify-end gap-2">
                          <div className="min-w-0 text-right">
                            <span className="block truncate">{item.name}</span>
                            <span className="block truncate text-[0.7rem] font-medium text-v3-text-muted">
                              {getTriggerRuleSummary(item)}
                            </span>
                          </div>
                          <Input
                            aria-label={`${item.name} 순서`}
                            readOnly
                            type="number"
                            value={index + 1}
                            variant="v3"
                            className="h-9 w-14 shrink-0 text-center"
                          />
                          <Button
                            aria-label={`${item.name} 위로 이동`}
                            disabled={!editable || index === 0}
                            onClick={() => moveRetroactiveRuleOrder(item.id, -1)}
                            type="button"
                            variant="neutral"
                            size="icon"
                            className="h-9 w-9 shrink-0"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label={`${item.name} 아래로 이동`}
                            disabled={!editable || index === retroactiveTriggerOrderItems.length - 1}
                            onClick={() => moveRetroactiveRuleOrder(item.id, 1)}
                            type="button"
                            variant="neutral"
                            size="icon"
                            className="h-9 w-9 shrink-0"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                        </div>
                      }
                    />
                  )) : (
                    <InfoRow
                      data-component="desktop_messages_sections_settings-past-trigger-policy-order-card_form_empty"
                      label="루틴"
                      value="등록된 자동 전송 루틴 없음"
                    />
                  )}
                </div>
              </InfoCard>
            ) : null}
          </div>
        </DetailPanel>
      ) : selectedItem?.kind === "duplicate-send-policy" ? (
        <DetailPanel data-component="desktop_messages_sections_split-layout_detail-panel-4"
          avatar={
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
              <Repeat2 className="h-5 w-5" />
            </div>
          }
          footer={configFooter}
          title="중복 전송 확인"
          subtitle="같은 번호에 같은 메시지를 짧은 시간 안에 다시 보낼 때 재확인합니다."
          trailing={
            <span className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
              활성
            </span>
          }
        >
          <div data-component="desktop_messages_sections_split-layout_detail-panel-4_duplicate-send-policy" className="space-y-4">
            {renderConfigFields(DUPLICATE_SEND_POLICY_ITEM_ID)}
            <InfoCard
              data-component="desktop_messages_sections_split-layout_detail-panel-4_duplicate-send-policy_card"
              title="규칙"
            >
              <div className="-mt-1">
                <InfoRow
                  data-component="desktop_messages_sections_split-layout_detail-panel-4_duplicate-send-policy_card_condition"
                  label="조건"
                  value="같은 번호 · 같은 메시지"
                />
                <InfoRow
                  data-component="desktop_messages_sections_split-layout_detail-panel-4_duplicate-send-policy_card_window"
                  label="확인 범위"
                  value={configuration ? `최근 ${configuration.duplicateWindowHours}시간` : "확인 중"}
                />
                <InfoRow
                  data-component="desktop_messages_sections_split-layout_detail-panel-4_duplicate-send-policy_card_action"
                  label="동작"
                  value="전송 전 확인 모달"
                />
              </div>
            </InfoCard>

            <div
              data-component="desktop_messages_sections_split-layout_detail-panel-4_duplicate-send-policy_preview"
              className="rounded-[18px] border border-v3-border bg-white p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-v3-primary-light text-v3-primary">
                  <Clock3 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.82rem] font-semibold text-v3-dark">중복 전송 확인</p>
                  <p className="mt-1 text-[0.74rem] leading-5 text-v3-text-muted">
                    최근 같은 내용의 메시지를 보낸 기록이 있으면, 발송 버튼을 누른 뒤 최근 전송 시각과 함께 재전송 여부를 확인합니다.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </DetailPanel>
      ) : (
        <DetailPanel data-component="desktop_messages_sections_split-layout_detail-panel-5"
          avatar={
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
          }
          title="메시지 발송 기능 신청"
          subtitle="메시지 발송 기능 사용을 위해 아래의 항목들을 확인 및 동의해 주세요."
          trailing={
            requestedAt ? (
              <span className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
                접수 {requestedAt}
              </span>
            ) : undefined
          }
        >
          <div data-component="desktop_messages_sections_split-layout_detail-panel-5_tenant-form" className="space-y-5 pb-2">
            <div
              data-component="desktop_messages_sections_split-layout_detail-panel-5_tenant-form_card"
              className="rounded-[18px] border border-v3-border bg-v3-dim-white/35 p-4"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-white text-v3-primary shadow-sm">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex h-11 items-center">
                  <p className="text-[0.92rem] font-semibold leading-none text-v3-dark">{tenantName}</p>
                </div>
              </div>
            </div>

            <div
              data-component="desktop_messages_sections_split-layout_detail-panel-5_tenant-form_sender-info"
              className="rounded-[18px] border border-v3-border bg-v3-dim-white/35 p-4"
            >
              <p className="text-[0.76rem] font-semibold text-v3-dark">발신번호</p>
              <p className="mt-1 text-[1rem] font-semibold text-v3-primary">{UNIFIED_SENDER_PHONE}</p>
              <p className="mt-1 text-[0.72rem] leading-5 text-v3-text-muted">
                모든 메시지는 사전 등록된 대표 발신번호 {UNIFIED_SENDER_PHONE} 으로 발송됩니다. 별도의 발신번호 입력이 필요하지 않습니다.
              </p>
            </div>

            <div data-component="desktop_messages_sections_split-layout_detail-panel-5_tenant-form_agreements" className="space-y-3">
              {ALIGO_POLICY_ITEMS.map((policy) => {
                const checked = agreements[policy.id];

                return (
                  <SelectableItemFrame key={policy.id} asChild isSelected={checked}>
                    <label
                      data-component={`desktop_messages_sections_split-layout_detail-panel-5_tenant-form_agreements_${policy.id}`}
                      data-selected={checked}
                      htmlFor={policy.id}
                      className="block cursor-pointer rounded-[18px] px-4 py-3"
                    >
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id={policy.id}
                          checked={checked}
                          onCheckedChange={(value) => toggleAgreement(policy.id, value === true)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[0.76rem] leading-5 text-v3-dark">{policy.text}</p>
                          <a
                            href={policy.sourceHref}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-[0.7rem] font-semibold text-v3-primary hover:underline"
                          >
                            {policy.sourceLabel}
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </div>
                    </label>
                  </SelectableItemFrame>
                );
              })}
            </div>

            <Button
              data-component="desktop_messages_sections_split-layout_detail-panel-5_tenant-form_submit"
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="h-11 w-full rounded-[14px]"
            >
              <Send className="h-4 w-4" />
              메시지 발송 신청하기
            </Button>

            {requestedAt ? (
              <div
                data-component="desktop_messages_sections_split-layout_detail-panel-5_tenant-form_success"
                className="rounded-[18px] border border-emerald-200 bg-emerald-50 px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 text-emerald-600" />
                  <div>
                    <p className="text-[0.78rem] font-semibold text-emerald-700">신청 접수 완료</p>
                    <p className="mt-1 text-[0.72rem] leading-5 text-emerald-700/90">
                      {tenantName} 기준 신청이 접수되었습니다. 접수 시각: {requestedAt}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </DetailPanel>
      )}
    </div>
  );
}
