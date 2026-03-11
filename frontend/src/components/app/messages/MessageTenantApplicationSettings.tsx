"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  ExternalLink,
  Phone,
  Send,
  ShieldCheck,
} from "lucide-react";
import { DetailPanel, ListPanel } from "@/components/app/v3";
import { TitleTextInputMolecule } from "@/components/app/messages/forms/form-components/TitleTextInputMolecule";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const ALIGO_POLICY_ITEMS = [
  {
    id: "aligo-terms",
    text: "회원등록 버튼을 클릭함으로써 알리고 문자 서비스 이용약관 개인정보보호방침에 동의함을 간주합니다.",
    sourceLabel: "알리고 회원가입",
    sourceHref: "https://smartsms.aligo.in/join.html",
  },
  {
    id: "sender-number",
    text: "발신번호는 사이트내에서 미리 등록된 번호만 사용하실 수 있습니다.",
    sourceLabel: "알리고 API SPEC",
    sourceHref: "https://smartsms.aligo.in/admin/api/spec.html",
  },
] as const;

function normalizePhone(value: string) {
  return value.replace(/\D/g, "").slice(0, 11);
}

function formatPhone(value: string) {
  if (value.length <= 3) return value;
  if (value.length <= 7) return `${value.slice(0, 3)}-${value.slice(3)}`;
  if (value.length === 8) return `${value.slice(0, 4)}-${value.slice(4)}`;
  if (value.startsWith("02")) {
    if (value.length <= 9) return `${value.slice(0, 2)}-${value.slice(2, 5)}-${value.slice(5)}`;
    return `${value.slice(0, 2)}-${value.slice(2, 6)}-${value.slice(6)}`;
  }

  return `${value.slice(0, 3)}-${value.slice(3, 7)}-${value.slice(7)}`;
}

function isValidSenderPhone(value: string) {
  return /^0\d{8,10}$/.test(value);
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
  const normalizedPhone = useMemo(() => normalizePhone(senderPhone), [senderPhone]);
  const formattedPhone = useMemo(() => formatPhone(normalizedPhone), [normalizedPhone]);
  const phoneError =
    normalizedPhone.length > 0 && !isValidSenderPhone(normalizedPhone)
      ? "발신 신청에 사용할 전화번호 형식을 확인해 주세요."
      : undefined;
  const allAgreed = ALIGO_POLICY_ITEMS.every((item) => agreements[item.id]);
  const canSubmit = isValidSenderPhone(normalizedPhone) && allAgreed;

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
        title="메시지 발송 신청"
        subtitle="현재 선택된 지점 기준으로 알리고 발송 사용을 신청합니다."
      >
        <div data-component="messages-settings-tenant-form" className="space-y-5 pb-2">
          <div
            data-component="messages-settings-tenant-card"
            className="rounded-[18px] border border-v3-border bg-v3-dim-white/35 p-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-white text-v3-primary shadow-sm">
                <Building2 className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.82rem] font-semibold text-v3-dark">{tenantName}</p>
                <p className="mt-1 text-[0.74rem] leading-5 text-v3-text-muted">
                  지점별 메시지 발송은 선택된 tenant 단위로 신청 상태를 관리합니다.
                </p>
              </div>
            </div>
          </div>

          <div data-component="messages-settings-tenant-phone-field" className="space-y-2">
            <TitleTextInputMolecule
              label="발신 전화번호"
              value={formattedPhone}
              onValueChange={(value) => setSenderPhone(normalizePhone(value))}
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
      </ListPanel>

      <DetailPanel
        avatar={
          <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-v3-primary-light text-v3-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
        }
        title="알리고 정책 동의"
        subtitle="공식 페이지에 노출된 문구를 그대로 확인하고 동의할 수 있도록 구성했습니다."
        badges={
          <span
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1 text-[0.68rem] font-semibold",
              allAgreed ? "bg-emerald-50 text-emerald-600" : "bg-v3-dim-white text-v3-text-muted",
            )}
          >
            {allAgreed ? "동의 준비 완료" : "정책 확인 필요"}
          </span>
        }
        trailing={
          requestedAt ? (
            <span className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary">
              접수 {requestedAt}
            </span>
          ) : undefined
        }
      >
        <div data-component="messages-settings-tenant-detail" className="space-y-4">
          <div
            data-component="messages-settings-tenant-status-grid"
            className="grid gap-3 sm:grid-cols-2"
          >
            <div className="rounded-[18px] border border-v3-border bg-white p-4">
              <p className="text-[0.72rem] font-semibold text-v3-text-muted">신청 대상 tenant</p>
              <p className="mt-2 text-sm font-semibold text-v3-dark">{tenantName}</p>
            </div>
            <div className="rounded-[18px] border border-v3-border bg-white p-4">
              <p className="text-[0.72rem] font-semibold text-v3-text-muted">발신 전화번호</p>
              <p className="mt-2 text-sm font-semibold text-v3-dark">
                {formattedPhone || "아직 입력되지 않았습니다."}
              </p>
            </div>
          </div>

          <div className="rounded-[18px] border border-v3-border bg-white p-4">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-v3-primary" />
              <p className="text-[0.78rem] font-semibold text-v3-dark">신청 전 확인</p>
            </div>
            <ul className="mt-3 space-y-2 text-[0.76rem] leading-5 text-v3-text-muted">
              <li>현재 화면은 선택된 지점 단위로 메시지 발송 사용 신청을 관리합니다.</li>
              <li>알리고 정책 문구 동의와 발신 전화번호 입력이 모두 완료되어야 신청 버튼이 활성화됩니다.</li>
              <li>공식 페이지 확인이 필요할 때는 각 동의 항목 아래 링크에서 원문을 바로 열 수 있습니다.</li>
            </ul>
          </div>

          <div className="rounded-[18px] border border-v3-border bg-v3-dim-white/35 p-4">
            <p className="text-[0.78rem] font-semibold text-v3-dark">공식 문구 출처</p>
            <div className="mt-3 space-y-3">
              {ALIGO_POLICY_ITEMS.map((policy) => (
                <div key={policy.id} className="rounded-[14px] border border-white/80 bg-white px-4 py-3">
                  <p className="text-[0.75rem] leading-5 text-v3-dark">{policy.text}</p>
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
              ))}
            </div>
          </div>
        </div>
      </DetailPanel>
    </div>
  );
}
