"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ExternalLink,
  History,
  Repeat2,
  Send,
  ShieldCheck,
} from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { settingsApi } from "@/services/api";

const UNIFIED_SENDER_PHONE = "010-9641-1878";
const DUPLICATE_SEND_POLICY_ITEM_ID = "duplicate-send-confirmation";
const SERVICE_FEEDBACK_LINK_POLICY_ITEM_ID = "service-feedback-link-policy";
const SMS_RETRY_POLICY_ITEM_ID = "sms-retry-policy";
const PAST_TRIGGER_POLICY_ITEM_ID = "past-trigger-policy";
const SERVICE_FEEDBACK_LINK_POLICY_TITLE = "제공기록지 전송 자동화 규칙";
const SERVICE_FEEDBACK_LINK_POLICY_DESCRIPTION =
  "서비스 시작일 오후 3시에 주 담당 제공인력에게 작성 링크를 SMS로 발송합니다.";
const SMS_RETRY_POLICY_TITLE = "SMS 재시도 규칙";
const SMS_RETRY_POLICY_DESCRIPTION =
  "SMS 전송 실패 시 5분 후 자동 재시도하며, 최초 발송 이후 최대 2번까지 다시 시도합니다.";
const PAST_TRIGGER_POLICY_TITLE = "지난 자동 전송 처리 규칙";
const PAST_TRIGGER_POLICY_DESCRIPTION =
  "고객 추가 시점보다 이미 지난 자동 전송 루틴은 실행하지 않습니다.";

const SERVICE_FEEDBACK_LINK_POLICY_DETAIL_VALUES = [
  { id: "send-time", label: "발송 시점", value: "서비스 시작일 오후 3시" },
  { id: "recipient", label: "수신 대상", value: "주 담당 제공인력" },
  { id: "retry", label: "실패 재시도", value: "SMS 재시도 규칙 적용" },
  { id: "expiry", label: "토큰 만료", value: "서비스 종료일 오후 8시" },
] as const;

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
  kind:
    | "tenant-application"
    | "duplicate-send-policy"
    | "service-feedback-link-policy"
    | "sms-retry-policy"
    | "past-trigger-policy";
};

const DUPLICATE_SEND_POLICY_ITEM: TenantApplicationListItem = {
  id: DUPLICATE_SEND_POLICY_ITEM_ID,
  title: "중복 전송 확인",
  subtitle: "72시간 내 같은 번호와 같은 메시지는 전송 전 확인합니다.",
  statusLabel: "활성",
  icon: Repeat2,
  kind: "duplicate-send-policy",
};

const SERVICE_FEEDBACK_LINK_POLICY_ITEM: TenantApplicationListItem = {
  id: SERVICE_FEEDBACK_LINK_POLICY_ITEM_ID,
  title: SERVICE_FEEDBACK_LINK_POLICY_TITLE,
  subtitle: SERVICE_FEEDBACK_LINK_POLICY_DESCRIPTION,
  statusLabel: "활성",
  icon: CalendarClock,
  kind: "service-feedback-link-policy",
};

const SMS_RETRY_POLICY_ITEM: TenantApplicationListItem = {
  id: SMS_RETRY_POLICY_ITEM_ID,
  title: SMS_RETRY_POLICY_TITLE,
  subtitle: SMS_RETRY_POLICY_DESCRIPTION,
  statusLabel: "활성",
  icon: Repeat2,
  kind: "sms-retry-policy",
};

const PAST_TRIGGER_POLICY_ITEM: TenantApplicationListItem = {
  id: PAST_TRIGGER_POLICY_ITEM_ID,
  title: PAST_TRIGGER_POLICY_TITLE,
  subtitle: PAST_TRIGGER_POLICY_DESCRIPTION,
  statusLabel: "미실행",
  icon: History,
  kind: "past-trigger-policy",
};

const DEFAULT_POLICY_TOGGLE_STATE: Record<string, boolean> = {
  [DUPLICATE_SEND_POLICY_ITEM_ID]: true,
  [SERVICE_FEEDBACK_LINK_POLICY_ITEM_ID]: true,
  [SMS_RETRY_POLICY_ITEM_ID]: true,
  [PAST_TRIGGER_POLICY_ITEM_ID]: true,
};

function formatRequestedAt(date: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function MessageTenantApplicationSettings() {
  const { data: authUser } = useGetAuthUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: messageSenderApproval, isLoading: isMessageSenderApprovalLoading } = useQuery({
    queryKey: ["settings", "message-sender-approval"],
    queryFn: settingsApi.getMessageSenderApproval,
  });
  const [agreements, setAgreements] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ALIGO_POLICY_ITEMS.map((item) => [item.id, false])),
  );
  const [requestedAt, setRequestedAt] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [policyToggleState, setPolicyToggleState] = useState<Record<string, boolean>>(
    DEFAULT_POLICY_TOGGLE_STATE,
  );

  const tenantName = authUser?.branchName?.trim() || "현재 선택된 지점";
  const allAgreed = ALIGO_POLICY_ITEMS.every((item) => agreements[item.id]);
  const canSubmit = allAgreed;
  const isMessageSenderApproved = messageSenderApproval?.isApproved === true;
  const listItems = useMemo<TenantApplicationListItem[]>(
    () => {
      if (isMessageSenderApprovalLoading) {
        return [];
      }

      const items: TenantApplicationListItem[] = [];

      if (!isMessageSenderApproved) {
        items.push({
          id: CURRENT_TENANT_ITEM_ID,
          title: "메시지 발송 기능 신청",
          subtitle: requestedAt
            ? `신청 접수 ${requestedAt}`
            : "알리고 정책 동의 후 신청해 주세요.",
          statusLabel: requestedAt ? "접수됨" : canSubmit ? "준비 완료" : "작성 중",
          icon: Building2,
          kind: "tenant-application",
        });
      }

      items.push(
        SERVICE_FEEDBACK_LINK_POLICY_ITEM,
        PAST_TRIGGER_POLICY_ITEM,
        SMS_RETRY_POLICY_ITEM,
        DUPLICATE_SEND_POLICY_ITEM,
      );

      return items;
    },
    [canSubmit, isMessageSenderApprovalLoading, isMessageSenderApproved, requestedAt],
  );
  const fallbackSelectedItemId = isMessageSenderApproved
    ? SERVICE_FEEDBACK_LINK_POLICY_ITEM_ID
    : CURRENT_TENANT_ITEM_ID;
  const selectedItem = listItems.find((item) => item.id === (selectedItemId ?? fallbackSelectedItemId))
    ?? listItems[0]
    ?? null;

  const toggleAgreement = (id: string, checked: boolean) => {
    setAgreements((previous) => ({
      ...previous,
      [id]: checked,
    }));
  };

  const togglePolicy = (id: string, checked: boolean) => {
    setPolicyToggleState((previous) => ({
      ...previous,
      [id]: checked,
    }));
  };

  const requestApprovalMutation = useMutation({
    mutationFn: settingsApi.requestMessageSenderApproval,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "message-sender-approval"] });
      setRequestedAt(formatRequestedAt(new Date()));
      toast({ description: `${tenantName} 메시지 발송 신청이 접수되었습니다.` });
    },
    onError: () => {
      toast({
        variant: "destructive",
        description: "메시지 발송 신청 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      });
    },
  });

  const handleSubmit = () => {
    if (!allAgreed) {
      toast({ variant: "destructive", description: "알리고 정책 동의 항목을 모두 확인해 주세요." });
      return;
    }

    requestApprovalMutation.mutate();
  };
  const emptyListMessage = isMessageSenderApprovalLoading
    ? "설정 정보를 불러오는 중입니다."
    : "표시할 설정 항목이 없습니다.";
  const emptyDetailMessage = isMessageSenderApprovalLoading
    ? "설정 정보를 불러오는 중입니다."
    : "설정 항목을 선택해 주세요.";

  if (isMessageSenderApprovalLoading) {
    return (
      <div
        data-component="messages-settings-layout"
        className="grid min-h-[560px] flex-1 gap-6 lg:grid-cols-[380px_1fr]"
      >
        <ListPanel
          title="설정"
          subtitle="메시지에 관련된 설정들을 정할 수 있어요"
          headerActions={
            <span className="inline-flex items-center whitespace-nowrap rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
              {listItems.length}개
            </span>
          }
        >
          <ListEmptyState
            message={emptyListMessage}
          />
        </ListPanel>

        <DetailPanel
          title="설정"
          subtitle="메시지에 관련된 설정들을 정할 수 있어요"
        >
          <DetailEmptyState
            name="messages-settings-detail-empty"
            message={emptyDetailMessage}
          />
        </DetailPanel>
      </div>
    );
  }

  return (
    <div
      data-component="messages-settings-tenant-application"
      className="grid min-h-[560px] flex-1 gap-6 lg:grid-cols-[380px_1fr]"
    >
      <ListPanel
        title="설정"
        subtitle="메시지에 관련된 설정들을 정할 수 있어요"
        headerActions={
          <span className="inline-flex items-center whitespace-nowrap rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
            {listItems.length}개
          </span>
        }
      >
        <AnimatedSlotList<TenantApplicationListItem>
          items={listItems}
          isLoading={false}
          className="space-y-2"
          getSlotState={({ item }) => ({
            isActive: item?.id === selectedItem?.id,
            isInteractive: Boolean(item),
          })}
          onSlotClick={(item) => setSelectedItemId(item.id)}
          render={({ item }) => {
            if (!item) return null;

            return (
              <AnimatedSlotListItemContent
                dataComponent="messages-settings-tenant-list"
                icon={item.icon}
                iconContainerClassName="bg-white text-v3-primary"
                title={item.title}
                subtitle={item.subtitle}
                status={
                  item.kind === "tenant-application" ? (
                    <span className="inline-flex items-center rounded-full bg-white/85 px-2 py-0.5 text-[0.68rem] font-semibold text-v3-primary">
                      {item.statusLabel}
                    </span>
                  ) : (
                    <Switch
                      aria-label={`${item.title} 활성화`}
                      checked={isMessageSenderApproved ? (policyToggleState[item.id] ?? false) : false}
                      disabled={!isMessageSenderApproved}
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={
                        isMessageSenderApproved
                          ? (checked) => togglePolicy(item.id, checked)
                          : undefined
                      }
                      className="ml-auto shrink-0"
                    />
                  )
                }
              />
            );
          }}
        />
      </ListPanel>

      {selectedItem?.kind === "service-feedback-link-policy" ? (
        <DetailPanel
          avatar={
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
              <CalendarClock className="h-5 w-5" />
            </div>
          }
          title={SERVICE_FEEDBACK_LINK_POLICY_TITLE}
          subtitle={SERVICE_FEEDBACK_LINK_POLICY_DESCRIPTION}
          trailing={
            <span className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
              활성
            </span>
          }
        >
          <div data-component="messages-settings-service-feedback-link-policy" className="space-y-4">
            <InfoCard
              data-component="messages-settings-service-feedback-link-policy-card"
              title="규칙"
            >
              <div className="-mt-1">
                {SERVICE_FEEDBACK_LINK_POLICY_DETAIL_VALUES.map((item) => (
                  <InfoRow
                    key={item.label}
                    data-component={`messages-settings-service-feedback-link-policy-${item.id}`}
                    label={item.label}
                    value={item.value}
                  />
                ))}
              </div>
            </InfoCard>
          </div>
        </DetailPanel>
      ) : selectedItem?.kind === "past-trigger-policy" ? (
        <DetailPanel
          avatar={
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
              <History className="h-5 w-5" />
            </div>
          }
          title={PAST_TRIGGER_POLICY_TITLE}
          subtitle={PAST_TRIGGER_POLICY_DESCRIPTION}
          trailing={
            <span className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
              미실행
            </span>
          }
        >
          <div data-component="messages-settings-past-trigger-policy" className="space-y-4">
            <InfoCard
              data-component="messages-settings-past-trigger-policy-card"
              title="규칙"
            >
              <div className="-mt-1">
                <InfoRow
                  data-component="messages-settings-past-trigger-policy-condition"
                  label="조건"
                  value="고객 추가 시점이 자동 전송 트리거 시점 이후"
                />
                <InfoRow
                  data-component="messages-settings-past-trigger-policy-action"
                  label="동작"
                  value="지난 루틴 미실행"
                />
                <InfoRow
                  data-component="messages-settings-past-trigger-policy-scope"
                  label="적용 범위"
                  value="자동 메시지 템플릿 전송 루틴"
                />
              </div>
            </InfoCard>
          </div>
        </DetailPanel>
      ) : selectedItem?.kind === "sms-retry-policy" ? (
        <DetailPanel
          avatar={
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
              <Repeat2 className="h-5 w-5" />
            </div>
          }
          title={SMS_RETRY_POLICY_TITLE}
          subtitle={SMS_RETRY_POLICY_DESCRIPTION}
          trailing={
            <span className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
              활성
            </span>
          }
        >
          <div data-component="messages-settings-sms-retry-policy" className="space-y-4">
            <InfoCard
              data-component="messages-settings-sms-retry-policy-card"
              title="규칙"
            >
              <div className="-mt-1">
                <InfoRow
                  data-component="messages-settings-sms-retry-policy-count"
                  label="재시도 횟수"
                  value="최대 2회"
                />
                <InfoRow
                  data-component="messages-settings-sms-retry-policy-interval"
                  label="재시도 간격"
                  value="실패 후 5분"
                />
                <InfoRow
                  data-component="messages-settings-sms-retry-policy-action"
                  label="동작"
                  value="전송 실패 시 자동 재시도"
                />
              </div>
            </InfoCard>
          </div>
        </DetailPanel>
      ) : selectedItem?.kind === "duplicate-send-policy" ? (
        <DetailPanel
          avatar={
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
              <Repeat2 className="h-5 w-5" />
            </div>
          }
          title="중복 전송 확인"
          subtitle="같은 번호에 같은 메시지를 짧은 시간 안에 다시 보낼 때 재확인합니다."
          trailing={
            <span className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
              활성
            </span>
          }
        >
          <div data-component="messages-settings-duplicate-send-policy" className="space-y-4">
            <InfoCard
              data-component="messages-settings-duplicate-send-policy-card"
              title="규칙"
            >
              <div className="-mt-1">
                <InfoRow
                  data-component="messages-settings-duplicate-send-policy-condition"
                  label="조건"
                  value="같은 번호 · 같은 메시지"
                />
                <InfoRow
                  data-component="messages-settings-duplicate-send-policy-window"
                  label="확인 범위"
                  value="최근 72시간"
                />
                <InfoRow
                  data-component="messages-settings-duplicate-send-policy-action"
                  label="동작"
                  value="전송 전 확인 모달"
                />
              </div>
            </InfoCard>

            <div
              data-component="messages-settings-duplicate-send-policy-preview"
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
        <DetailPanel
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
          <div data-component="messages-settings-tenant-form" className="space-y-5 pb-2">
            <div
              data-component="messages-settings-tenant-card"
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
              data-component="messages-settings-tenant-sender-info"
              className="rounded-[18px] border border-v3-border bg-v3-dim-white/35 p-4"
            >
              <p className="text-[0.76rem] font-semibold text-v3-dark">발신번호</p>
              <p className="mt-1 text-[1rem] font-semibold text-v3-primary">{UNIFIED_SENDER_PHONE}</p>
              <p className="mt-1 text-[0.72rem] leading-5 text-v3-text-muted">
                모든 메시지는 사전 등록된 대표 발신번호 {UNIFIED_SENDER_PHONE} 으로 발송됩니다. 별도의 발신번호 입력이 필요하지 않습니다.
              </p>
            </div>

            <div data-component="messages-settings-tenant-agreements" className="space-y-3">
              {ALIGO_POLICY_ITEMS.map((policy) => {
                const checked = agreements[policy.id];

                return (
                  <label
                    key={policy.id}
                    htmlFor={policy.id}
                    className={cn(
                      "block cursor-pointer rounded-[18px] border px-4 py-3 transition-colors",
                      checked
                        ? "border-v3-primary bg-v3-primary-light/60"
                        : "border-v3-border bg-white hover:border-v3-primary/30 hover:bg-v3-primary-light/20",
                    )}
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
                );
              })}
            </div>

            <Button
              data-component="messages-settings-tenant-submit"
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
                data-component="messages-settings-tenant-success"
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
