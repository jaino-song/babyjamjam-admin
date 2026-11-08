"use client";

import {
  getUserErrorMessage,
  MESSAGE_SETTINGS_POLICY_IDS,
  SERVICE_RECORD_LINK_RULE_ID,
  STORED_MESSAGE_SETTINGS_POLICY_IDS,
  type MessageAutomationPoliciesResponse,
  type MessageAutomationPolicyConfigResponse,
  type MessageAutomationPolicyConfiguration,
  type MessageSettingsPolicyId,
  type StoredMessageSettingsPolicyId,
} from "@babyjamjam/shared";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";

import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { SlidingCard } from "@/components/app/mobile-redesign/sliding-card";
import { ClientRegistrationPolicyDetail } from "@/components/app/mobile-redesign/settings/ClientRegistrationPolicyDetail";
import { useClientRegistrationPolicy } from "@/components/app/mobile-redesign/settings/use-client-registration-policy";
import { PastTriggerPolicyDetail, configurationError } from "@/components/app/mobile-redesign/settings/PastTriggerPolicyDetail";
import { PolicyInfoRows } from "@/components/app/mobile-redesign/settings/PolicyInfoRows";
import { SenderApprovalDetail } from "@/components/app/mobile-redesign/settings/SenderApprovalDetail";
import { SettingsList } from "@/components/app/mobile-redesign/settings/SettingsList";
import {
  buildSettingsListItems,
  CLIENT_REGISTRATION_POLICY_ITEM_ID,
  type SettingsListItem,
} from "@/components/app/mobile-redesign/settings/settings-items";
import { StatusPill } from "@/components/app/ui/status-badge";
import {
  useMessageTriggerRules,
  useUpdateMessageTriggerRuleBranchActivation,
} from "@/features/message-triggers/hooks/use-message-triggers";
import { useToast } from "@/hooks/use-toast";
import { settingsApi } from "@/services/api";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { isAxiosError } from "axios";

import "@/components/app/mobile-redesign/redesign.css";

const SETTINGS_PAGE_BASE = "mobile_messages_settings_page";
const SLIDING_CARD_BASE = `${SETTINGS_PAGE_BASE}_screen_content_sliding-card`;
const SETTINGS_LIST_BASE = `${SLIDING_CARD_BASE}_stage_list-pane_settings-list`;
const DETAIL_BODY_BASE = `${SLIDING_CARD_BASE}_stage_detail-pane_body`;
const PAST_TRIGGER_POLICY_ID = "past-trigger";
const MESSAGE_SENDER_APPROVAL_QUERY_KEY = [
  "settings",
  "message-sender-approval",
] as const;
const MESSAGE_AUTOMATION_POLICIES_QUERY_KEY = [
  "settings",
  "message-automation-policies",
] as const;

interface DetailContentProps {
  "data-component": string;
  item: SettingsListItem;
}

interface PolicyActivationMutationContext {
  previous: MessageAutomationPoliciesResponse | undefined;
}

function isMessageSettingsPolicyId(id: string): id is MessageSettingsPolicyId {
  return (MESSAGE_SETTINGS_POLICY_IDS as readonly string[]).includes(id);
}

function isStoredMessageSettingsPolicyId(id: string): id is StoredMessageSettingsPolicyId {
  return (STORED_MESSAGE_SETTINGS_POLICY_IDS as readonly string[]).includes(id);
}

function withPolicyActivation(
  current: MessageAutomationPoliciesResponse | undefined,
  policyId: MessageSettingsPolicyId,
  enabled: boolean,
): MessageAutomationPoliciesResponse | undefined {
  if (!current) return current;

  return {
    ...current,
    policies: current.policies.map((policy) =>
      policy.id === policyId ? { ...policy, active: enabled } : policy,
    ),
    policyActivations: {
      ...current.policyActivations,
      [policyId]: enabled,
    } as Partial<Record<MessageSettingsPolicyId, boolean>>,
  };
}

function DetailContent({
  "data-component": dataComponent,
  item,
}: DetailContentProps): ReactElement {
  const ItemIcon = item.icon;

  return (
    <div
      data-component={dataComponent}
      data-source-component="DetailContent"
      className="flex flex-col gap-[calc(18px*var(--glint-ui-scale,1))]"
    >
      <section
        data-component={`${dataComponent}_hero`}
        className="flex items-center gap-[calc(12px*var(--glint-ui-scale,1))]"
      >
        <span
          data-component={`${dataComponent}_hero_icon`}
          className="flex h-[calc(46px*var(--glint-ui-scale,1))] w-[calc(46px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[calc(14px*var(--glint-ui-scale,1))] bg-v3-primary-light text-v3-primary"
          aria-hidden="true"
        >
          <ItemIcon
            className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]"
            strokeWidth={2.25}
          />
        </span>
        <span
          data-component={`${dataComponent}_hero_copy`}
          className="flex min-w-0 flex-1 flex-col gap-[calc(4px*var(--glint-ui-scale,1))]"
        >
          <h2
            data-component={`${dataComponent}_hero_copy_title`}
            className="text-[calc(0.94rem*var(--glint-ui-scale,1))] font-bold leading-[calc(1.25rem*var(--glint-ui-scale,1))] text-v3-dark"
          >
            {item.title}
          </h2>
          <p
            data-component={`${dataComponent}_hero_copy_description`}
            className="text-[calc(0.7rem*var(--glint-ui-scale,1))] leading-[calc(1.05rem*var(--glint-ui-scale,1))] text-v3-text-muted"
          >
            {item.subtitle}
          </p>
        </span>
      </section>

      <PolicyInfoRows
        data-component={`${dataComponent}_policy-info-rows`}
        rows={item.rows ?? []}
      />
    </div>
  );
}

export function MessagesSettingsPage(): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const selectedItemId = useSearchParams().get("item");
  const branchId = useGetAuthUser().data?.branchId ?? null;
  const configKey = ["settings", "message-automation-config", branchId] as const;
  const configQuery = useQuery({ queryKey: configKey, queryFn: () => settingsApi.getMessageAutomationConfig(branchId!), enabled: Boolean(branchId) });
  const [draftState, setDraftState] = useState<{ branchId: string; expectedVersion: string | null; configuration: MessageAutomationPolicyConfiguration } | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveAction = useRef<(() => void) | null>(null);
  const branchRef = useRef(branchId);
  useEffect(() => { branchRef.current = branchId; }, [branchId]);
  const persisted = configQuery.data;
  const configuration = draftState?.branchId === branchId ? draftState.configuration : persisted?.configuration;
  const dirty = Boolean(configuration && persisted && JSON.stringify(configuration) !== JSON.stringify(persisted.configuration));
  const canWriteConfig = Boolean(branchId && persisted?.permissions.canRead && persisted.permissions.canWrite && !configQuery.isError);
  const changeConfig = (next: MessageAutomationPolicyConfiguration) => { if (branchId && canWriteConfig) { setDraftState((current) => ({ branchId, expectedVersion: current?.branchId === branchId ? current.expectedVersion : persisted!.version, configuration: next })); setConfigError(null); } };
  const cancelConfig = () => { setDraftState(null); setConfigError(null); };
  const saveConfig = useMutation({
    mutationFn: (captured: { branchId: string; expectedVersion: string | null; configuration: MessageAutomationPolicyConfiguration; fingerprint: string }) => settingsApi.updateMessageAutomationConfig({ expectedVersion: captured.expectedVersion, configuration: captured.configuration }, captured.branchId),
    onSuccess: (response, captured) => {
      queryClient.setQueryData<MessageAutomationPolicyConfigResponse>(["settings", "message-automation-config", captured.branchId], response);
      if (branchRef.current !== captured.branchId) return;
      setDraftState((current) => current?.branchId === captured.branchId ? JSON.stringify(current.configuration) === captured.fingerprint ? null : { ...current, expectedVersion: response.version } : current);
      setConfigError(null);
    },
    onError: (error, captured) => {
      if (branchRef.current !== captured.branchId) return;
      const conflict = isAxiosError(error) && error.response?.status === 409;
      if (!conflict) setDraftState((current) => current?.branchId === captured.branchId && JSON.stringify(current.configuration) === captured.fingerprint ? null : current);
      setConfigError(conflict ? "설정이 다른 곳에서 변경되었습니다. 새로고침 후 변경 내용을 확인해 주세요." : getUserErrorMessage(error, "메시지 설정을 저장하지 못했어요"));
    },
  });
  const requestSaveConfig = () => {
    if (!branchId || !configuration || !persisted || !canWriteConfig || !dirty || saveConfig.isPending || configurationError(configuration)) return;
    saveConfig.mutate({ branchId, expectedVersion: draftState?.branchId === branchId ? draftState.expectedVersion : persisted.version, configuration: { ...configuration, pastRuleOrder: [...configuration.pastRuleOrder], quietHours: { ...configuration.quietHours, recipientGroups: [...configuration.quietHours.recipientGroups] } }, fingerprint: JSON.stringify(configuration) });
  };
  const guardNavigation = (action: () => void) => {
    if (dirty) { leaveAction.current = action; setLeaveOpen(true); } else action();
  };
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || event.ctrlKey || event.metaKey || anchor.href === window.location.href) return;
      if (anchor.origin !== window.location.origin) return;
      event.preventDefault(); event.stopPropagation();
      leaveAction.current = () => router.push(anchor.pathname + anchor.search + anchor.hash);
      setLeaveOpen(true);
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); };
  }, [dirty, router]);
  const didPushDetailRef = useRef(false);
  const approvalQuery = useQuery({
    queryKey: MESSAGE_SENDER_APPROVAL_QUERY_KEY,
    queryFn: settingsApi.getMessageSenderApproval,
  });
  const policiesQuery = useQuery({
    queryKey: MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
    queryFn: settingsApi.getMessageAutomationPolicies,
  });
  const clientRegistration = useClientRegistrationPolicy();
  const triggerRulesQuery = useMessageTriggerRules();
  const serviceRecordLinkMutation = useUpdateMessageTriggerRuleBranchActivation();
  const policyActivationMutation = useMutation<
    { policyId: StoredMessageSettingsPolicyId; enabled: boolean },
    Error,
    { policyId: StoredMessageSettingsPolicyId; enabled: boolean },
    PolicyActivationMutationContext
  >({
    mutationFn: ({ policyId, enabled }) =>
      settingsApi.updateMessageSettingsPolicyActivation(policyId, enabled),
    onMutate: async ({ policyId, enabled }) => {
      await queryClient.cancelQueries({
        queryKey: MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
      });
      const previous = queryClient.getQueryData<MessageAutomationPoliciesResponse>(
        MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
      );
      queryClient.setQueryData<MessageAutomationPoliciesResponse>(
        MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
        (current) => withPolicyActivation(current, policyId, enabled),
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(
        MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
        context?.previous,
      );
      toast({
        variant: "destructive",
        description: getUserErrorMessage(error, "메시지 설정을 저장하지 못했어요"),
      });
    },
    onSuccess: ({ policyId, enabled }) => {
      queryClient.setQueryData<MessageAutomationPoliciesResponse>(
        MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
        (current) => withPolicyActivation(current, policyId, enabled),
      );
    },
    onSettled: () => void queryClient.invalidateQueries({
      queryKey: MESSAGE_AUTOMATION_POLICIES_QUERY_KEY,
    }),
  });
  const displayConfiguration = configQuery.isError || !persisted?.permissions.canRead ? undefined : configuration;
  const items = useMemo(
    () =>
      buildSettingsListItems({
        approval: approvalQuery.data,
        policies: policiesQuery.data?.policies.map((policy) =>
          policy.id === "service-feedback-link"
            ? {
                ...policy,
                active: triggerRulesQuery.data?.find(
                  (rule) => rule.id === SERVICE_RECORD_LINK_RULE_ID,
                )?.isActive ?? policy.active,
              }
            : policy,
        ),
        clientAutoRegistration:
          clientRegistration.policy?.clientAutoRegistration ?? false,
        policyActivations: policiesQuery.data?.policyActivations,
        configuration: displayConfiguration,
        canWriteConfiguration: canWriteConfig,
      }),
    [
      approvalQuery.data,
      clientRegistration.policy?.clientAutoRegistration,
      policiesQuery.data?.policies,
      policiesQuery.data?.policyActivations,
      triggerRulesQuery.data,
      canWriteConfig,
      displayConfiguration,
    ],
  );
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId),
    [items, selectedItemId],
  );
  const isInitialLoading =
    approvalQuery.isLoading ||
    policiesQuery.isLoading ||
    clientRegistration.isLoading;

  const handleToggle = (id: string, enabled: boolean) => {
    if (id === "quiet-hours") {
      if (configuration) changeConfig({ ...configuration, quietHours: { ...configuration.quietHours, enabled } });
      return;
    }
    if (id === CLIENT_REGISTRATION_POLICY_ITEM_ID) {
      clientRegistration.updatePolicy.mutate({
        clientAutoRegistration: enabled,
      });
      return;
    }

    if (id === "service-feedback-link") {
      serviceRecordLinkMutation.mutate(
        { id: SERVICE_RECORD_LINK_RULE_ID, dto: { isActive: enabled } },
        {
          onError: (error) => toast({
            variant: "destructive",
            description: getUserErrorMessage(error, "메시지 설정을 저장하지 못했어요"),
          }),
        },
      );
      return;
    }

    if (!isMessageSettingsPolicyId(id) || !isStoredMessageSettingsPolicyId(id)) return;
    policyActivationMutation.mutate({ policyId: id, enabled });
  };

  useEffect(() => {
    if (selectedItemId === null) {
      didPushDetailRef.current = false;
    }
  }, [selectedItemId]);

  useEffect(() => {
    if (
      isInitialLoading ||
      approvalQuery.isError ||
      selectedItemId === null ||
      selectedItem !== undefined
    ) {
      return;
    }

    router.replace("/messages/settings", { scroll: false });
  }, [approvalQuery.isError, isInitialLoading, router, selectedItem, selectedItemId]);

  const handleSelect = (id: string) => {
    if (id === selectedItemId) {
      return;
    }

    guardNavigation(() => {
      router.push(`?item=${encodeURIComponent(id)}`, { scroll: false });
      didPushDetailRef.current = true;
    });
  };

  const handleBack = () => guardNavigation(() => {
    if (didPushDetailRef.current) {
      router.back();
      return;
    }

    router.replace("/messages/settings", { scroll: false });
  });

  const detail: ReactNode = (() => {
    if (!selectedItem) return null;

    const detailBase = `${DETAIL_BODY_BASE}_${selectedItem.kind}_${selectedItem.id}`;

    if (selectedItem.kind === "tenant-application") {
      return <SenderApprovalDetail data-component={detailBase} />;
    }

    if (selectedItem.kind === "client-registration-policy") {
      return <ClientRegistrationPolicyDetail data-component={detailBase} />;
    }

    if (["trigger-dispatch", "trigger-job-retry", "sms-retry", PAST_TRIGGER_POLICY_ID, "duplicate-send-confirmation", "quiet-hours"].includes(selectedItem.id)) {
      if (configQuery.isLoading) return <p role="status">메시지 설정을 불러오는 중</p>;
      if (!configuration || !persisted?.permissions.canRead || configQuery.isError || !branchId) return <p role="alert">메시지 설정을 불러올 수 없습니다. 다시 불러온 뒤 편집해 주세요.</p>;
      return <div data-component={`${detailBase}_configuration`} className="flex flex-col gap-3">
        <DetailContent data-component={`${detailBase}_detail-content`} item={selectedItem} />
        <PastTriggerPolicyDetail key={`${branchId}-${selectedItem.id}`} data-component={`${detailBase}_configuration_editor`} itemId={selectedItem.id} configuration={configuration} branchId={branchId} version={draftState?.branchId === branchId ? draftState.expectedVersion : persisted.version} canWrite={canWriteConfig} dirty={dirty} isPending={saveConfig.isPending} error={configError} onChange={changeConfig} onSave={requestSaveConfig} onCancel={cancelConfig} />
      </div>;
    }

    return (
      <DetailContent
        data-component={`${detailBase}_detail-content`}
        item={selectedItem}
      />
    );
  })();
  const detailStatusLabel =
    selectedItem?.kind === "tenant-application" ||
    selectedItem?.kind === "automation-policy" ||
    selectedItem?.kind === "duplicate-send-policy"
      ? selectedItem.statusLabel
      : null;

  return (
    <>
    <section
      data-component={SETTINGS_PAGE_BASE}
      data-slot="messages-page"
      data-page="messages-settings"
      className="messages-page flex min-h-0 w-full flex-1"
    >
      <div
        data-component={`${SETTINGS_PAGE_BASE}_screen`}
        className="relative flex min-h-0 w-full flex-1 overflow-hidden"
      >
        <div
          data-component={`${SETTINGS_PAGE_BASE}_screen_content`}
          data-slot="messages-content"
          className="shell-content relative min-h-0 flex-1 flex-col gap-[calc(8px*var(--glint-ui-scale,1))] !overflow-hidden"
        >
          <MessageSectionNav
            data-component={`${SETTINGS_PAGE_BASE}_screen_content_section-nav`}
            activeId="settings"
          />

          <SlidingCard
            data-component={SLIDING_CARD_BASE}
            open={
              selectedItemId !== null &&
              selectedItem !== undefined
            }
            onBack={handleBack}
            backLabel="설정"
            detailKey={selectedItemId}
            list={(
              <SettingsList
                data-component={SETTINGS_LIST_BASE}
                items={items}
                selectedId={selectedItemId}
                onSelect={handleSelect}
                onToggle={handleToggle}
                togglingItemId={
                  (policyActivationMutation.isPending
                    ? policyActivationMutation.variables?.policyId ?? null
                    : null) ??
                  (serviceRecordLinkMutation.isPending
                    ? "service-feedback-link"
                    : null) ??
                  (clientRegistration.updatePolicy.isPending
                    ? CLIENT_REGISTRATION_POLICY_ITEM_ID
                    : null)
                }
                isLoading={isInitialLoading}
                policiesError={policiesQuery.isError}
                onRetryPolicies={() => policiesQuery.refetch()}
                approvalError={approvalQuery.isError}
                onRetryApproval={() => approvalQuery.refetch()}
              />
            )}
            detail={detail}
            detailHeaderTrailing={
              detailStatusLabel ? (
                <StatusPill
                  data-component={`${SLIDING_CARD_BASE}_stage_detail-pane_header_status`}
                  variant="primary"
                  className="!gap-0 !rounded-[calc(999px*var(--glint-ui-scale,1))] !border-[calc(1px*var(--glint-ui-scale,1))] !border-v3-primary/15 !bg-v3-primary-light !px-[calc(8px*var(--glint-ui-scale,1))] !py-[calc(4px*var(--glint-ui-scale,1))] !text-[calc(0.62rem*var(--glint-ui-scale,1))] !text-v3-primary"
                >
                  {detailStatusLabel}
                </StatusPill>
              ) : null
            }
          />
        </div>
      </div>
    </section>
    <ApprovalTwoButtonModal data-component={`${SETTINGS_PAGE_BASE}_leave-modal`} open={leaveOpen} onOpenChange={setLeaveOpen} title="변경 내용을 취소할까요?" description="저장하지 않은 변경 내용은 취소됩니다." isDescriptionVisuallyHidden={false} approvalLabel="변경 취소" onApprove={() => { cancelConfig(); setLeaveOpen(false); const action = leaveAction.current; leaveAction.current = null; action?.(); }} />
    </>
  );
}
