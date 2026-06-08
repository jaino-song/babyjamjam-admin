"use client";

import { useState } from "react";
import {
  BadgeCheck,
  Building2,
  Clock3,
  Phone,
  ShieldAlert,
} from "lucide-react";
import { ContentPaper } from "@/components/app/root/content-paper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { MessageSenderApprovalResponse } from "@/services/api";

interface MessageSenderApprovalSettingsProps {
  approval?: MessageSenderApprovalResponse;
  isLoading: boolean;
  isSubmitting: boolean;
  errorMessage?: string | null;
  onSubmit: (senderPhone: string) => void;
}

const STATUS_META = {
  not_requested: {
    label: "미신청",
    tone: "bg-slate-100 text-slate-700 border-slate-200",
    icon: ShieldAlert,
    description:
      "발신번호를 등록하고 승인 신청을 완료해야 발송 예정, 발송 기록, 발송 트리거 설정을 사용할 수 있습니다.",
  },
  pending: {
    label: "승인 대기",
    tone: "bg-amber-50 text-amber-700 border-amber-200",
    icon: Clock3,
    description:
      "조직 오너가 발신번호를 승인하면 메시지 관련 기능이 활성화됩니다.",
  },
  approved: {
    label: "승인 완료",
    tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: BadgeCheck,
    description:
      "이 조직에서는 승인된 발신번호로 메시지 기능을 사용할 수 있습니다.",
  },
} as const;

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("ko-KR");
}

export function MessageSenderApprovalSettings({
  approval,
  isLoading,
  isSubmitting,
  errorMessage,
  onSubmit,
}: MessageSenderApprovalSettingsProps) {
  const [senderPhone, setSenderPhone] = useState(
    approval?.senderPhoneFormatted ?? approval?.senderPhone ?? "",
  );

  const approvalStatus = approval?.approvalStatus ?? "not_requested";
  const meta = STATUS_META[approvalStatus];
  const StatusIcon = meta.icon;

  return (
    <ContentPaper variant="v3" className="overflow-hidden">
      <div className="rounded-[28px] border border-v3-border/70 bg-gradient-to-br from-white via-white to-v3-primary-light/40 p-6 sm:p-7">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-v3-primary/10 text-v3-primary">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-v3-dark">문자 발신번호 승인</h2>
              <p className="text-sm text-v3-text-muted">
                승인 대상은 계정이 아니라 조직 단위입니다. 한 번 승인되면 같은 조직의 다른 계정에도 적용됩니다.
              </p>
            </div>
          </div>

          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[0.72rem] font-semibold",
              meta.tone,
            )}
          >
            <StatusIcon className="h-3.5 w-3.5" />
            {meta.label}
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
          <div className="space-y-4 rounded-[24px] border border-v3-border bg-white/90 p-5">
            <div>
              <Label htmlFor="message-sender-phone" className="text-sm font-medium text-v3-dark">
                발신번호
              </Label>
              <Input
                id="message-sender-phone"
                value={senderPhone}
                onChange={(event) => setSenderPhone(event.target.value)}
                placeholder="예: 02-123-4567 또는 010-1234-5678"
                className="mt-2 h-11 rounded-2xl"
                disabled={isLoading || isSubmitting || !approval?.canRequest}
              />
            </div>

            <div className="rounded-[18px] bg-slate-50 px-4 py-3">
              <div className="flex items-start gap-2">
                <Phone className="mt-0.5 h-4 w-4 text-slate-500" />
                <div className="space-y-1 text-sm text-slate-600">
                  <p>입력한 번호로 조직 오너 승인 요청이 올라갑니다.</p>
                  <p>번호를 변경해 다시 신청하면 기존 승인 상태는 대기로 전환됩니다.</p>
                </div>
              </div>
            </div>

            {!isLoading && !approval?.canRequest ? (
              <Alert>
                <AlertDescription>
                  이 신청은 현재 조직의 `admin` 또는 `manager` 역할만 진행할 수 있습니다.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex items-center justify-end">
                <Button
                  onClick={() => onSubmit(senderPhone)}
                  disabled={isLoading || isSubmitting || senderPhone.trim().length === 0}
                  className="rounded-full px-5"
                >
                  {isSubmitting ? (
                    <>
                      <Spinner className="mr-2 h-4 w-4" />
                      신청 중
                    </>
                  ) : approvalStatus === "approved" ? (
                    "번호 변경 후 재신청"
                  ) : approvalStatus === "pending" ? (
                    "번호 수정 후 재신청"
                  ) : (
                    "승인 신청"
                  )}
                </Button>
              </div>
            )}

            {errorMessage ? (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}
          </div>

          <div className="space-y-4 rounded-[24px] border border-v3-border bg-white/90 p-5">
            <div>
              <p className="text-sm font-semibold text-v3-dark">현재 상태</p>
              <p className="mt-1 text-sm leading-6 text-v3-text-muted">{meta.description}</p>
            </div>

            <div className="space-y-3 rounded-[18px] bg-v3-dim-white/60 p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-v3-text-muted">등록 번호</span>
                <span className="font-semibold text-v3-dark">
                  {approval?.senderPhoneFormatted ?? approval?.senderPhone ?? "아직 없음"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-v3-text-muted">신청 시각</span>
                <span className="font-semibold text-v3-dark">
                  {formatDate(approval?.requestedAt ?? null) ?? "아직 없음"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-v3-text-muted">승인 시각</span>
                <span className="font-semibold text-v3-dark">
                  {formatDate(approval?.approvedAt ?? null) ?? "아직 없음"}
                </span>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center rounded-[18px] border border-dashed border-v3-border px-4 py-8">
                <Spinner className="h-5 w-5" />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </ContentPaper>
  );
}
