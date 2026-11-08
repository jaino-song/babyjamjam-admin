"use client";

import { useMemo, useState, type ReactElement } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { isSmsTriggerTemplate } from "@babyjamjam/shared";
import { mergeRuleOrder } from "@babyjamjam/shared/utils/rule-order";
import type { MessageAutomationPolicyConfiguration, MessageAutomationPolicyPreviewResponse, MessagePolicyRecipientGroup } from "@babyjamjam/shared/types/message";
import { InputField } from "@/components/app/v3/InputField";
import { OptionButtonGroup } from "@/components/app/v3/OptionButtonGroup";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { InfoCard, InfoRow, MobileDetailActions } from "@/components/app/mobile-redesign/detail-sheet";
import { useMessageTriggerRules } from "@/features/message-triggers/hooks/use-message-triggers";
import { settingsApi } from "@/services/api";
import { getOrderedTriggerRules } from "./settings-items";

export type ConfigurationField = Exclude<keyof MessageAutomationPolicyConfiguration, "schemaVersion" | "quietHours" | "pastRuleOrder">;
export const CONFIGURATION_FIELDS: Array<{ key: ConfigurationField; label: string; min?: number; max?: number; item: string }> = [
  { key: "dispatchCheckIntervalMinutes", label: "자동 전송 확인 간격 (분)", min: 1, max: 1440, item: "trigger-dispatch" },
  { key: "defaultRuleSendTime", label: "기본 발송 시각 (한국 시간)", item: "trigger-dispatch" },
  { key: "triggerRetryIntervalMinutes", label: "자동 전송 재시도 간격 (분)", min: 1, max: 1440, item: "trigger-job-retry" },
  { key: "processingReclaimMinutes", label: "처리 중 작업 재확인 간격 (분)", min: 10, max: 1440, item: "trigger-job-retry" },
  { key: "smsRetryIntervalMinutes", label: "SMS 재시도 간격 (분)", min: 1, max: 1440, item: "sms-retry" },
  { key: "pastExpiryHours", label: "지난 자동 전송 유효 기간 (시간)", min: 1, max: 720, item: "past-trigger" },
  { key: "pastSendIntervalMinutes", label: "늦은 등록 자동 전송 간격", min: 1, max: 1440, item: "past-trigger" },
  { key: "duplicateWindowHours", label: "중복 전송 확인 범위 (시간)", min: 1, max: 720, item: "duplicate-send-confirmation" },
];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export function configurationError(configuration: MessageAutomationPolicyConfiguration): string | null {
  for (const field of CONFIGURATION_FIELDS) {
    const value = configuration[field.key];
    if (field.key === "defaultRuleSendTime") {
      if (typeof value !== "string" || !TIME.test(value)) return "발송 시각을 입력해 주세요 (한국 시간).";
    } else if (typeof value !== "number" || !Number.isInteger(value) || value < field.min! || value > field.max!) {
      return `${field.label}: ${field.min}~${field.max} 범위로 입력해 주세요.`;
    }
  }
  const quiet = configuration.quietHours;
  if (!TIME.test(quiet.start) || !TIME.test(quiet.end)) return "심야 시작·종료 시각을 입력해 주세요.";
  if (quiet.start === quiet.end) return "심야 시작과 종료 시각은 달라야 합니다.";
  if (quiet.enabled && quiet.recipientGroups.length === 0) return "심야 전송 금지 대상을 한 개 이상 선택해 주세요.";
  return null;
}

export interface PastTriggerPolicyDetailProps {
  "data-component": string;
  itemId: string;
  configuration: MessageAutomationPolicyConfiguration;
  branchId: string;
  version: string | null;
  canWrite: boolean;
  isPending: boolean;
  dirty: boolean;
  error: string | null;
  onChange: (configuration: MessageAutomationPolicyConfiguration) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** Shared configuration editor inside the existing settings detail sheet. */
export function PastTriggerPolicyDetail({ "data-component": base, itemId, configuration, branchId, version, canWrite, isPending, dirty, error, onChange, onSave, onCancel }: PastTriggerPolicyDetailProps): ReactElement {
  const rulesQuery = useMessageTriggerRules();
  const rules = useMemo(() => getOrderedTriggerRules((rulesQuery.data ?? []).filter((rule) => rule.isActive && isSmsTriggerTemplate(rule.templateKey)), configuration.pastRuleOrder), [rulesQuery.data, configuration.pastRuleOrder]);
  const [preview, setPreview] = useState<{ fingerprint: string; data: MessageAutomationPolicyPreviewResponse } | null>(null);
  const fingerprint = JSON.stringify(configuration);
  const previewMutation = useMutation({
    mutationFn: (captured: { configuration: MessageAutomationPolicyConfiguration; branchId: string; version: string | null; fingerprint: string }) => settingsApi.previewMessageAutomationConfig(captured.configuration, captured.branchId, captured.version),
    onSuccess: (data, captured) => setPreview({ fingerprint: captured.fingerprint, data }),
  });
  const currentPreview = preview?.fingerprint === fingerprint ? preview.data : null;
  const invalid = configurationError(configuration);
  const fields = CONFIGURATION_FIELDS.filter((field) => field.item === itemId);
  const setQuiet = (patch: Partial<MessageAutomationPolicyConfiguration["quietHours"]>) => onChange({ ...configuration, quietHours: { ...configuration.quietHours, ...patch } });
  const moveRule = (id: string, direction: number) => {
    const order = rules.map((rule) => rule.id);
    const index = order.indexOf(id);
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    onChange({ ...configuration, pastRuleOrder: mergeRuleOrder(configuration.pastRuleOrder, order) });
  };
  return (
    <div data-component={base} data-source-component="PastTriggerPolicyDetail" className="flex flex-col gap-3">
      {fields.map((field) => (
        <InputField key={field.key} data-component={`${base}_field-${field.key.toLowerCase()}`} title={field.label}
          message={field.min === undefined ? undefined : `${field.min}~${field.max}`}
          inputProps={{ id: `${base}-${field.key}`, "aria-label": field.label, type: field.key === "defaultRuleSendTime" ? "time" : "number", min: field.min, max: field.max, step: field.key === "defaultRuleSendTime" ? 60 : 1, inputMode: field.key === "defaultRuleSendTime" ? undefined : "numeric", disabled: !canWrite, value: typeof configuration[field.key] === "number" && !Number.isFinite(configuration[field.key]) ? "" : configuration[field.key], onChange: (event) => onChange({ ...configuration, [field.key]: field.key === "defaultRuleSendTime" ? event.target.value : event.target.value === "" ? NaN : Number(event.target.value) }) }} />
      ))}
      {itemId === "past-trigger" ? (
        <InfoCard data-component={`${base}_order`} title="늦은 등록 자동 전송 순서">
          {rulesQuery.isError ? <p role="alert">자동 전송 규칙을 불러오지 못했습니다.</p> : rulesQuery.isLoading ? <p role="status">자동 전송 루틴을 불러오는 중</p> : rules.length === 0 ? <p>등록된 자동 전송 루틴 없음</p> : rules.map((rule, index) => (
            <div key={rule.id} data-component={`${base}_order_rule-${index}`} className="flex items-center gap-2">
              <span className="flex-1">{index + 1}. {rule.name}</span>
              <Button data-component={`${base}_order_rule-${index}_up`} variant="v3-soft" size="icon" aria-label={`${rule.name} 위로 이동`} disabled={!canWrite || index === 0} onClick={() => moveRule(rule.id, -1)}><ArrowUp size={16} /></Button>
              <Button data-component={`${base}_order_rule-${index}_down`} variant="v3-soft" size="icon" aria-label={`${rule.name} 아래로 이동`} disabled={!canWrite || index === rules.length - 1} onClick={() => moveRule(rule.id, 1)}><ArrowDown size={16} /></Button>
            </div>
          ))}
        </InfoCard>
      ) : null}
      {itemId === "quiet-hours" ? (
        <InfoCard data-component={`${base}_quiet`} title="SMS/LMS 심야 전송 금지">
          <InfoRow label="심야 시간 메세지 전송 금지" value={<Switch data-component={`${base}_quiet_enabled`} aria-label="심야 시간 메세지 전송 금지" checked={configuration.quietHours.enabled} disabled={!canWrite} onCheckedChange={(enabled) => setQuiet({ enabled })} />} />
          {(["start", "end"] as const).map((key) => <InputField key={key} data-component={`${base}_quiet_${key}`} title={key === "start" ? "시작 시각 (한국 시간)" : "종료 시각 (한국 시간)"} inputProps={{ id: `${base}-${key}`, type: "time", step: 60, value: configuration.quietHours[key], disabled: !canWrite, onChange: (event) => setQuiet({ [key]: event.target.value }) }} />)}
          <p id={`${base}-targets`}>전송 금지 대상</p>
          <OptionButtonGroup data-component={`${base}_quiet_targets`} labelledBy={`${base}-targets`} mode="multi" options={[{ value: "CLIENT", label: "고객" }, { value: "CAREGIVER", label: "제공인력" }, { value: "STAFF", label: "직원" }]} selected={configuration.quietHours.recipientGroups} disabled={!canWrite} onToggle={(value) => { const group = value as MessagePolicyRecipientGroup; setQuiet({ recipientGroups: configuration.quietHours.recipientGroups.includes(group) ? configuration.quietHours.recipientGroups.filter((item) => item !== group) : [...configuration.quietHours.recipientGroups, group] }); }} />
          <p id={`${base}-action`}>금지 시간에 접수한 메시지 처리</p>
          <OptionButtonGroup data-component={`${base}_quiet_action`} labelledBy={`${base}-action`} mode="single" options={[{ value: "CANCEL", label: "전송 취소" }, { value: "DEFER", label: "금지 시간 이후 전송" }]} selected={[configuration.quietHours.action]} disabled={!canWrite} onToggle={(action) => setQuiet({ action: action as "CANCEL" | "DEFER" })} />
          <Button data-component={`${base}_quiet_preview-action`} variant="v3-soft" disabled={Boolean(invalid) || previewMutation.isPending} onClick={() => previewMutation.mutate({ configuration: { ...configuration, pastRuleOrder: [...configuration.pastRuleOrder], quietHours: { ...configuration.quietHours, recipientGroups: [...configuration.quietHours.recipientGroups] } }, branchId, version, fingerprint })}>영향 미리보기</Button>
          {previewMutation.isError ? <p role="alert">영향을 불러오지 못했습니다.</p> : null}
          {currentPreview ? <div data-component={`${base}_quiet_preview`}><InfoRow label="보류" value={`${currentPreview.deferredCount}건`} /><InfoRow label="취소" value={`${currentPreview.canceledCount}건`} /><InfoRow label="예약된 메시지" value={`${currentPreview.futureProviderReservations}건`} /><InfoRow label="다음 확인" value={currentPreview.reevaluateAt ? new Date(currentPreview.reevaluateAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "없음"} /><InfoRow label="사용 가능" value={currentPreview.canEnableQuietHours ? "가능" : "설정 확인 필요"} /></div> : null}
        </InfoCard>
      ) : null}
      {invalid ? <p role="alert">{invalid}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <MobileDetailActions data-component={`${base}_actions`} name="message-policy" actions={[{ label: "취소", onClick: onCancel, disabled: isPending }, { label: isPending ? "저장 중…" : "저장", variant: "primary", onClick: onSave, disabled: !canWrite || !dirty || Boolean(invalid) || isPending, busy: isPending }]} />
    </div>
  );
}
