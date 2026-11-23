"use client";

import { useId } from "react";
import type { CanceledAutomationRetryReason, CanceledAutomationRetryRoutine } from "@babyjamjam/shared/types/message";
import { LoadingState } from "@/components/app/ui/LoadingState";
import { QueryErrorState } from "@/components/app/ui/QueryErrorState";
import { InfoCard, InfoRow } from "@/components/app/v3";
import { Switch } from "@/components/ui/switch";
import {
  useCanceledAutomationRetrySettings,
  useUpdateCanceledAutomationRetry,
} from "@/features/message-triggers/hooks/use-canceled-automation-retry";

const reasonLabels: Record<CanceledAutomationRetryReason, string> = {
  target_client_status_not_met: "대상 고객 상태 불일치",
  live_unsigned_contract: "진행 중인 계약서에 서명 필요",
  missing_birthday: "생년월일 미등록",
  missing_current_contract: "현재 계약서 없음",
  current_contract_pdf_pending: "현재 계약서 PDF 준비 중",
  pre_booking: "예약 전 고객",
};
const unavailableLabels = {
  dispatch_disabled: "이 지점의 메시지 자동 발송이 꺼져 있어요.",
  routine_disabled: "이 루틴이 꺼져 있어요.",
  unsupported: "이 루틴은 취소 후 재시도를 지원하지 않아요.",
};

function RetryRoutineRow({ routine, branchId, canManage, "data-component": row }: {
  routine: CanceledAutomationRetryRoutine;
  branchId: string;
  canManage: boolean;
  "data-component": string;
}) {
  const save = useUpdateCanceledAutomationRetry(branchId, routine.id);
  const explanationId = useId();
  const base = `${row}_value`;
  const name = `${routine.label} 취소 자동화 재시도`;
  const explanation = routine.unavailableReason
    ? unavailableLabels[routine.unavailableReason]
    : routine.recoverableReasons.map((reason) => reasonLabels[reason]).join(" · ");

  return (
    <InfoRow
      data-component={row}
      label={routine.label}
      value={
        <span className="flex flex-col items-end gap-1">
          <span className="flex items-center gap-2">
            <Switch
              type="button"
              data-component={`${base}_switch`}
              aria-label={name}
              aria-describedby={explanationId}
              aria-busy={save.isPending}
              checked={routine.enabled}
              disabled={!canManage || !routine.eligible || save.isPending}
              onCheckedChange={(enabled) => save.mutate(enabled)}
            />
            {save.isPending ? (
              <LoadingState data-component={`${base}_pending`} label={`${name} 설정 저장 중`} inline size="sm" />
            ) : null}
          </span>
          <span id={explanationId} data-component={`${base}_eligibility`} data-slot="eligibility">{explanation}</span>
          {save.isError ? (
            <span role="alert" data-component={`${base}_save-error`}>설정을 저장하지 못했어요. 다시 시도해 주세요.</span>
          ) : null}
          {save.isSuccess ? (
            <span role="status" data-component={`${base}_save-success`}>설정을 저장했어요.</span>
          ) : null}
        </span>
      }
    />
  );
}

export function CanceledAutomationRetrySettings({ branchId, canManageActivation, "data-component": component }: {
  branchId: string;
  canManageActivation: boolean;
  "data-component": string;
}) {
  const settings = useCanceledAutomationRetrySettings(branchId);

  if (settings.isPending) {
    return <LoadingState data-component={component} label="취소 자동화 재시도 설정을 불러오는 중" />;
  }
  if (!settings.data) {
    return (
      <QueryErrorState
        dataComponent={component}
        title="취소 자동화 재시도 설정을 불러오지 못했어요"
        onRetry={() => void settings.refetch()}
        isRetrying={settings.isFetching}
      />
    );
  }

  return (
    <InfoCard title="자동 전송 루틴" data-component={component}>
      {settings.isError ? (
        <QueryErrorState
          dataComponent={`${component}_refresh-error`}
          size="inline"
          title="최신 설정을 불러오지 못했어요"
          onRetry={() => void settings.refetch()}
          isRetrying={settings.isFetching}
        />
      ) : null}
      {settings.data.routines.map((routine) => (
        <RetryRoutineRow
          key={routine.id}
          branchId={branchId}
          routine={routine}
          canManage={canManageActivation && settings.data.canManageActivation && !settings.isError}
          data-component={`${component}_routine`}
        />
      ))}
      {settings.data.routines.length === 0 ? (
        <InfoRow label="루틴" value="등록된 자동 전송 루틴이 없어요." data-component={`${component}_empty`} />
      ) : null}
    </InfoCard>
  );
}
