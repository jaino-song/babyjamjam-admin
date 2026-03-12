"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  ExternalLink,
  Send,
  ShieldCheck,
} from "lucide-react";
import { AnimatedSlotList, DetailPanel, ListPanel } from "@/components/app/v3";
import { TitleTextInputMolecule } from "@/components/app/messages/forms/form-components/TitleTextInputMolecule";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { formatKoreanPhoneNumber, isValidKoreanPhoneNumber, normalizePhoneDigits } from "@/lib/phone";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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
};

function isValidSenderPhone(value: string) {
  return isValidKoreanPhoneNumber(value);
}

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
  const [senderPhone, setSenderPhone] = useState("");
  const [agreements, setAgreements] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ALIGO_POLICY_ITEMS.map((item) => [item.id, false])),
  );
  const [requestedAt, setRequestedAt] = useState<string | null>(null);

  const tenantName = authUser?.organizationName?.trim() || "현재 선택된 지점";
  const normalizedPhone = useMemo(() => normalizePhoneDigits(senderPhone), [senderPhone]);
  const formattedPhone = useMemo(() => formatKoreanPhoneNumber(normalizedPhone), [normalizedPhone]);
  const phoneError =
    normalizedPhone.length > 0 && !isValidSenderPhone(normalizedPhone)
      ? "발신 신청에 사용할 전화번호 형식을 확인해 주세요."
      : undefined;
  const allAgreed = ALIGO_POLICY_ITEMS.every((item) => agreements[item.id]);
  const canSubmit = isValidSenderPhone(normalizedPhone) && allAgreed;
  const listItems = useMemo<TenantApplicationListItem[]>(
    () => [
      {
        id: CURRENT_TENANT_ITEM_ID,
        title: "메시지 발송 기능 신청",
        subtitle: requestedAt
          ? `신청 접수 ${requestedAt}`
          : formattedPhone
            ? `발신 번호 ${formattedPhone}`
            : "발신 전화번호와 정책 동의를 확인해 주세요.",
        statusLabel: requestedAt ? "접수됨" : canSubmit ? "준비 완료" : "작성 중",
        icon: Building2,
      },
    ],
    [canSubmit, formattedPhone, requestedAt],
  );

  const toggleAgreement = (id: string, checked: boolean) => {
    setAgreements((previous) => ({
      ...previous,
      [id]: checked,
    }));
  };

  const handleSubmit = () => {
    if (!isValidSenderPhone(normalizedPhone)) {
      toast({ variant: "destructive", description: "발신 전화번호를 정확히 입력해 주세요." });
      return;
    }

    if (!allAgreed) {
      toast({ variant: "destructive", description: "알리고 정책 동의 항목을 모두 확인해 주세요." });
      return;
    }

    const now = new Date();
    setRequestedAt(formatRequestedAt(now));
    toast({ description: `${tenantName} 메시지 발송 신청이 접수되었습니다.` });
  };

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
          slotClassName={() =>
            "flex items-center gap-3 rounded-[18px] border-2 border-v3-primary bg-v3-primary-light p-3 text-left transition-all duration-200"
          }
          render={({ item }) => {
            if (!item) return null;
            const Icon = item.icon;

            return (
              <>
                <div
                  data-component="messages-settings-tenant-list-icon"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-white text-v3-primary shadow-sm"
                >
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <div data-component="messages-settings-tenant-list-copy" className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[0.82rem] font-semibold text-v3-dark">{item.title}</p>
                    <span className="inline-flex items-center rounded-full bg-white/85 px-2 py-0.5 text-[0.68rem] font-semibold text-v3-primary">
                      {item.statusLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-[0.72rem] leading-5 text-v3-text-muted">{item.subtitle}</p>
                </div>
              </>
            );
          }}
        />
      </ListPanel>

      <DetailPanel
        avatar={
          <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
        }
        title="메시지 발송 기능 신청"
        subtitle="메시지 발송 기능 사용을 위해 아래의 항목들을 입력 및 동의해 주세요."
        trailing={
          requestedAt ? (
            <span className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
              접수 {requestedAt}
            </span>
          ) : undefined
        }
      >
        <div data-component="messages-settings-tenant-detail">
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

            <div data-component="messages-settings-tenant-phone-field" className="space-y-2">
              <TitleTextInputMolecule
                label="발신 전화번호"
                value={formattedPhone}
                onValueChange={(value) => setSenderPhone(normalizePhoneDigits(value))}
                placeholder="예: 0212345678"
                required
                error={Boolean(phoneError)}
                helperText={phoneError}
                containerClassName="gap-2"
                inputClassName="h-11 rounded-[14px] border-v3-border bg-white"
                dataComponent="messages-settings-tenant-phone-input"
              />
              <p className="text-[0.72rem] leading-5 text-v3-text-muted">
                신청 후 알리고에 등록할 발신 번호를 입력해 주세요. 숫자만 입력해도 자동으로 구분자를 적용합니다.
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
        </div>
      </DetailPanel>
    </div>
  );
}
