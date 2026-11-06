"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_MESSAGE_TRIGGER_RETRY_ON_FAILURE,
  DEFAULT_MESSAGE_TRIGGER_TARGET_CLIENT_STATUS,
  MESSAGE_TRIGGER_TARGET_CLIENT_STATUSES,
  MESSAGE_TRIGGER_TARGET_CLIENT_STATUS_LABELS,
  normalizeApiError,
  type MessageTriggerTargetClientStatus,
} from "@babyjamjam/shared";
import type { CreateMessageTriggerRuleGroupDto, MessageTriggerRuleGroupView, MessageTriggerRecipientMode, MessageTriggerRecipientType, MessageTriggerTemplateKey, MessageTriggerRuleGroupPreviewResponse } from "@babyjamjam/shared/types/message";
import { isAxiosError } from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { messageRuleGroupsApi } from "@/services/api";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { OptionButtonGroup } from "@/components/app/v3/OptionButtonGroup";
import { Button } from "@/components/ui/button";
import { BellRing, Trash2 } from "lucide-react";

import { InputField } from "@/components/app/v3/InputField";
import { InfoCard, InfoRow, MobileDetailHeader, MobileDetailPage } from "./detail-sheet";
import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import {
  useDeleteMessageTriggerRule,
  useMessageTriggerTemplates,
  useUpdateMessageTriggerRule,
} from "@/features/message-triggers/hooks/use-message-triggers";
import type {
  CreateMessageTriggerRuleDto,
  MessageTriggerRule,
  TriggerEventType,
  TriggerOffsetType,
  TriggerRecipientType,
  TriggerTemplateKey,
} from "@/features/message-triggers/types";

const EVENT_OPTIONS: Array<{ value: TriggerEventType; label: string }> = [
  { value: "CLIENT_CREATED", label: "고객 등록" },
  { value: "SERVICE_START", label: "서비스 시작" },
  { value: "SERVICE_END", label: "서비스 종료" },
  { value: "EMPLOYEE_ASSIGNED", label: "제공인력 배정" },
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

const RECIPIENT_OPTIONS: Array<{ value: TriggerRecipientType; label: string }> = [
  { value: "CLIENT", label: "고객" },
  { value: "PRIMARY_EMPLOYEE", label: "주 담당 제공인력" },
  { value: "SECONDARY_EMPLOYEE", label: "보조 제공인력" },
];

const PREVIEW_ANCHOR_LABELS = { "client.createdAt": "고객 등록일 기준", "client.startDate": "고객 서비스 시작일 기준", "client.endDate": "고객 서비스 종료일 기준", "employee_schedule.startDate": "배정 일정 시작일 기준", "employee_schedule.endDate": "배정 일정 종료일 기준" };
const PREVIEW_OUTCOME_LABELS = { ready: "전송 대상", skip: "전송 제외", needs_setup: "추가 설정 필요", unavailable: "확인 불가" };
function previewReasonLabel(reason: string) {
  const labels: Record<string, string> = { source_unavailable: "대상 정보를 불러올 수 없습니다.", schedule_unavailable: "배정 일정을 확인할 수 없습니다.", rule_unavailable: "자동 전송 규칙을 확인할 수 없습니다.", group_unavailable: "자동 전송 규칙을 확인할 수 없습니다.", template_unavailable: "메시지 템플릿을 확인해 주세요.", recipient_phone_conflict: "다른 제공인력의 연락처가 같습니다.", "anchor 없음": "기준 일정이 없습니다." };
  return labels[reason] ?? (/[가-힣]/.test(reason) ? reason : "전송 조건을 확인해 주세요.");
}

type RuleForm = Required<CreateMessageTriggerRuleDto>;

function initialForm(rule: MessageTriggerRule | null): RuleForm {
  if (rule) {
    return {
      name: rule.name,
      isActive: rule.isActive,
      eventType: rule.eventType,
      offsetType: rule.offsetType,
      offsetDays: rule.offsetDays,
      sendTime: rule.sendTime ?? "09:00",
      recipientType: rule.recipientType,
      templateKey: rule.templateKey,
      targetClientStatus: rule.targetClientStatus,
      retryOnFailure: rule.retryOnFailure,
    };
  }

  return {
    name: "",
    isActive: true,
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    offsetDays: 7,
    sendTime: "09:00",
    recipientType: "CLIENT",
    templateKey: "SERVICE_INFO",
    targetClientStatus: DEFAULT_MESSAGE_TRIGGER_TARGET_CLIENT_STATUS,
    retryOnFailure: DEFAULT_MESSAGE_TRIGGER_RETRY_ON_FAILURE,
  };
}

const FIELD_CLASS = "min-h-11 w-full rounded-xl border border-v3-border bg-white px-3 text-sm text-v3-dark outline-none focus:border-v3-primary";

export function MessageTriggerEditor({
  "data-component": dataComponent,
  rule,
  group = null,
  onDirtyChange,
  onCancel,
  onClose,
}: {
  "data-component": string;
  rule: MessageTriggerRule | null;
  group?: MessageTriggerRuleGroupView | null;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel?: () => void;
  onClose: () => void;
}) {
  const branchId = useGetAuthUser().data?.branchId ?? null;
  const branchRef = useRef(branchId);
  useEffect(() => { branchRef.current = branchId; }, [branchId]);
  const queryClient = useQueryClient();
  const groupMode = !rule;
  const [expectedGroupVersion] = useState(group?.version ?? null);
  const [form, setForm] = useState<RuleForm>(() => group ? { ...initialForm(null), name: group.name, isActive: group.isActive, eventType: group.eventType, offsetType: group.offsetType, offsetDays: group.offsetDays, sendTime: group.sendTime, targetClientStatus: group.targetClientStatus, retryOnFailure: group.retryOnFailure } : initialForm(rule));
  const [recipientMode, setRecipientMode] = useState<MessageTriggerRecipientMode>(group?.recipientMode ?? rule?.recipientType ?? "CLIENT");
  const [recipientTemplates, setRecipientTemplates] = useState<Partial<Record<MessageTriggerRecipientType, MessageTriggerTemplateKey>>>(() => group?.recipientTemplates ?? { [rule?.recipientType ?? "CLIENT"]: rule?.templateKey ?? "SERVICE_INFO" });
  const recipients: MessageTriggerRecipientType[] = recipientMode === "BOTH_EMPLOYEES" ? ["PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE"] : [recipientMode];
  const [groupPending, setGroupPending] = useState(false);
  const pendingRef = useRef(false);
  const [preview, setPreview] = useState<{ fingerprint: string; data: MessageTriggerRuleGroupPreviewResponse } | null>(null);
  const draftFingerprint = JSON.stringify({ form, recipientMode, recipientTemplates });
  const [initialFingerprint] = useState(draftFingerprint);
  const dirty = initialFingerprint !== draftFingerprint;
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const updateMutation = useUpdateMessageTriggerRule();
  const deleteMutation = useDeleteMessageTriggerRule();
  const templatesQuery = useMessageTriggerTemplates({
    eventType: form.eventType,
  });
  const templates = useMemo(
    () => (templatesQuery.data ?? []).filter((template) => template.providers.sms && template.allowedEventTypes.includes(form.eventType)),
    [form.eventType, templatesQuery.data],
  );
  const isPending = groupPending || updateMutation.isPending || deleteMutation.isPending;
  const needsDays = form.offsetType === "BEFORE_DAYS" || form.offsetType === "AFTER_DAYS";
  const roleTemplates = (recipient: MessageTriggerRecipientType) => templates.filter((template) => template.allowedRecipientTypes.includes(recipient));
  const selectedTemplateKey = form.templateKey;
  const validTemplates = !templatesQuery.isLoading && !templatesQuery.isError && (groupMode ? recipients.every((recipient) => roleTemplates(recipient).some((template) => template.key === recipientTemplates[recipient])) : roleTemplates(form.recipientType).some((template) => template.key === form.templateKey));
  const validCombination = !(form.eventType === "CLIENT_CREATED" && recipientMode !== "CLIENT");
  const groupDraft = (): CreateMessageTriggerRuleGroupDto => ({ name: form.name.trim(), isActive: form.isActive, eventType: form.eventType, offsetType: form.offsetType, offsetDays: needsDays ? form.offsetDays : 0, sendTime: form.offsetType === "IMMEDIATE" ? "09:00" : form.sendTime, targetClientStatus: form.targetClientStatus, retryOnFailure: form.retryOnFailure, recipientMode, recipientTemplates: Object.fromEntries(recipients.map((recipient) => [recipient, recipientTemplates[recipient]])) });

  const validDraft = Boolean(form.name.trim()) && validTemplates && validCombination && (!needsDays || Number.isInteger(form.offsetDays) && form.offsetDays >= 0) && (form.offsetType === "IMMEDIATE" || /^([01]\d|2[0-3]):[0-5]\d$/.test(form.sendTime));
  const handlePreview = async () => {
    if (!branchId || !groupMode || !validDraft || pendingRef.current) return;
    const capturedBranch = branchId;
    const fingerprint = draftFingerprint;
    pendingRef.current = true; setGroupPending(true); setError(null);
    try {
      const data = await messageRuleGroupsApi.preview({ draft: groupDraft() }, capturedBranch);
      if (branchRef.current === capturedBranch) setPreview({ fingerprint, data });
    } catch (error) { if (branchRef.current === capturedBranch) setError(normalizeApiError(error, { locale: "ko-KR" }).message); }
    finally { pendingRef.current = false; setGroupPending(false); }
  };

  const setField = <K extends keyof RuleForm>(key: K, value: RuleForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleEventChange = (eventType: TriggerEventType) => {
    const nextOffset = OFFSET_OPTIONS[eventType][0]?.value ?? "IMMEDIATE";
    setForm((current) => ({
      ...current,
      eventType,
      offsetType: nextOffset,
      offsetDays: nextOffset === "BEFORE_DAYS" || nextOffset === "AFTER_DAYS" ? current.offsetDays : 0,
    }));
  };

  const handleSave = async () => {
    if (rule?.branchId === null) return;
    if (form.offsetType !== "IMMEDIATE" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.sendTime)) {
      setError("발송 시각을 입력해 주세요 (한국 시간).");
      return;
    }
    const name = form.name.trim();
    if (!name) {
      // Local validation copy is authored by this repo — render as-is.
      setError("규칙 이름을 입력해 주세요.");
      return;
    }
    if (!validTemplates || !validCombination) {
      setError("선택한 조건에 사용할 수 있는 SMS 템플릿이 없습니다.");
      return;
    }

    const dto: CreateMessageTriggerRuleDto = {
      ...form,
      sendTime: form.offsetType === "IMMEDIATE" ? "09:00" : form.sendTime,
      name,
      templateKey: selectedTemplateKey,
      offsetDays: needsDays ? Math.max(0, Number(form.offsetDays) || 0) : 0,
    };

    if (!validDraft || pendingRef.current) return;
    const capturedBranch = branchId;
    if (groupMode && !capturedBranch) return;
    setError(null);
    try {
      if (groupMode && capturedBranch) {
        pendingRef.current = true; setGroupPending(true);
        if (group) await messageRuleGroupsApi.update(group.id, { ...groupDraft(), expectedVersion: expectedGroupVersion! }, capturedBranch);
        else await messageRuleGroupsApi.create(groupDraft(), capturedBranch);
        await queryClient.invalidateQueries({ queryKey: ["message-trigger-rule-groups", capturedBranch] });
        if (branchRef.current !== capturedBranch) return;
      } else if (rule) {
        await updateMutation.mutateAsync({ id: rule.id, dto });
      }
      onClose();
    } catch (saveError) {
      // Shared problem contract resolution — a registered body surfaces its
      // catalog copy; the locally authored fallback covers unverified failures.
      const normalized = normalizeApiError(saveError, { locale: "ko-KR", operation: "mutation" });
      setError(isAxiosError(saveError) && saveError.response?.status === 409 ? "자동 전송 규칙이 다른 곳에서 변경되었습니다. 최신 규칙을 다시 불러온 후 확인해 주세요." : normalized.verified ? normalized.message : "자동 전송 규칙을 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally { pendingRef.current = false; setGroupPending(false); }
  };

  const handleDelete = async () => {
    if ((!rule && !group) || rule?.isDefault || pendingRef.current) return;
    setError(null);
    try {
      if (group && branchId) {
        const capturedBranch = branchId;
        pendingRef.current = true; setGroupPending(true);
        await messageRuleGroupsApi.remove(group.id, group.version, capturedBranch);
        await queryClient.invalidateQueries({ queryKey: ["message-trigger-rule-groups", capturedBranch] });
        if (branchRef.current !== capturedBranch) return;
      } else if (rule) await deleteMutation.mutateAsync(rule.id);
      setDeleteOpen(false);
      onClose();
    } catch (deleteError) {
      setDeleteOpen(false);
      // Shared problem contract resolution — see handleSave.
      const normalized = normalizeApiError(deleteError, { locale: "ko-KR", operation: "mutation" });
      setError(normalized.verified ? normalized.message : "자동 전송 규칙을 삭제하지 못했습니다. 다시 시도해 주세요.");
    } finally { pendingRef.current = false; setGroupPending(false); }
  };

  return (
    <MobileDetailPage data-component={dataComponent} name="message-trigger-editor">
      <MobileDetailHeader
        data-component={`${dataComponent}_header`}
        name="message-trigger-editor"
        avatar={<BellRing size={22} aria-hidden="true" />}
        title={rule || group ? "자동 전송 규칙 수정" : "자동 전송 규칙 추가"}
        badges={[{ label: form.isActive ? "활성화" : "비활성화", tone: form.isActive ? "green" : "muted" }]}
      />

      <form
        className="space-y-4 px-4 pb-8"
        data-component={`${dataComponent}_form`}
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <fieldset disabled={isPending} className="contents">
        <label className="block space-y-1.5 text-xs font-semibold text-v3-text-muted">
          <span>규칙 이름</span>
          <input
            name="ruleName"
            autoComplete="off"
            className={FIELD_CLASS}
            value={form.name}
            onChange={(event) => setField("name", event.target.value)}
          />
        </label>

        <label className="block space-y-1.5 text-xs font-semibold text-v3-text-muted">
          <span>발송 이벤트</span>
          <select
            name="eventType"
            className={FIELD_CLASS}
            value={form.eventType}
            onChange={(event) => handleEventChange(event.target.value as TriggerEventType)}
          >
            {EVENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="block space-y-1.5 text-xs font-semibold text-v3-text-muted">
          <span>발송 시점</span>
          <select
            name="offsetType"
            className={FIELD_CLASS}
            value={form.offsetType}
            onChange={(event) => setField("offsetType", event.target.value as TriggerOffsetType)}
          >
            {OFFSET_OPTIONS[form.eventType].map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        {form.offsetType !== "IMMEDIATE" && (
          <InputField
            data-component={`${dataComponent}_form_send-time`}
            title="발송 시각 (한국 시간)"
            inputProps={{
              id: "trigger-rule-send-time",
              name: "sendTime",
              type: "time",
              step: 60,
              required: true,
              value: form.sendTime,
              disabled: rule?.branchId === null,
              onChange: (event) => setField("sendTime", event.target.value),
              "data-component": `${dataComponent}_form_send-time_input`,
            }}
          />
        )}

        {needsDays ? (
          <label className="block space-y-1.5 text-xs font-semibold text-v3-text-muted">
            <span>기준 일수</span>
            <input
              name="offsetDays"
              type="number"
              inputMode="numeric"
              min={0}
              className={FIELD_CLASS}
              value={form.offsetDays}
              onChange={(event) => setField("offsetDays", Number(event.target.value))}
            />
          </label>
        ) : null}

        {groupMode ? <div data-component={`${dataComponent}_form_recipients`}>
          <p id={`${dataComponent}-recipients`}>수신자</p>
          <OptionButtonGroup data-component={`${dataComponent}_form_recipients_modes`} labelledBy={`${dataComponent}-recipients`} mode="single" options={[{ value: "CLIENT", label: "고객" }, { value: "PRIMARY_EMPLOYEE", label: "주제공인력" }, { value: "SECONDARY_EMPLOYEE", label: "보조제공인력" }, { value: "BOTH_EMPLOYEES", label: "주보조모두" }]} selected={[recipientMode]} onToggle={(value) => setRecipientMode(value as MessageTriggerRecipientMode)} />
          {!validCombination ? <p role="alert">고객 등록 이벤트는 고객만 선택할 수 있습니다.</p> : null}
          {recipientMode !== "CLIENT" && (form.eventType === "SERVICE_START" || form.eventType === "SERVICE_END") ? <p>제공인력 배정 일정 기준으로 발송합니다.</p> : null}
        </div> : <label className="block space-y-1.5 text-xs font-semibold text-v3-text-muted"><span>수신자</span><select name="recipientType" className={FIELD_CLASS} value={form.recipientType} onChange={(event) => setField("recipientType", event.target.value as TriggerRecipientType)}>{RECIPIENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
        {(groupMode ? recipients : [form.recipientType]).map((recipient) => <label key={recipient} className="block space-y-1.5 text-xs font-semibold text-v3-text-muted" data-component={`${dataComponent}_form_template-${recipient.toLowerCase().replaceAll("_", "-")}`}>
          <span>{groupMode ? `${RECIPIENT_OPTIONS.find((option) => option.value === recipient)?.label} 메시지 템플릿` : "메시지 템플릿"}</span>
          <select className={FIELD_CLASS} value={groupMode ? recipientTemplates[recipient] ?? "" : selectedTemplateKey} disabled={templatesQuery.isLoading || templatesQuery.isError || !validCombination || roleTemplates(recipient).length === 0} onChange={(event) => groupMode ? setRecipientTemplates((current) => ({ ...current, [recipient]: event.target.value as TriggerTemplateKey })) : setField("templateKey", event.target.value as TriggerTemplateKey)}>
            <option value="">템플릿 선택</option>
            {roleTemplates(recipient).map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}
          </select>
          {roleTemplates(recipient).length === 0 ? <span>이 조건에 사용할 수 있는 SMS 템플릿이 없습니다.</span> : null}
        </label>)}

        <label
          className="block space-y-1.5 text-xs font-semibold text-v3-text-muted"
          data-component={`${dataComponent}_form_target-client-status`}
        >
          <span>대상 고객 상태</span>
          <select
            name="targetClientStatus"
            className={FIELD_CLASS}
            value={form.targetClientStatus}
            onChange={(event) => setField("targetClientStatus", event.target.value as MessageTriggerTargetClientStatus)}
          >
            {MESSAGE_TRIGGER_TARGET_CLIENT_STATUSES.map((status) => (
              <option key={status} value={status}>{MESSAGE_TRIGGER_TARGET_CLIENT_STATUS_LABELS[status]}</option>
            ))}
          </select>
        </label>

        <div className="space-y-1.5">
          <label
            className="flex min-h-11 items-center justify-between rounded-xl border border-v3-border bg-white px-3 text-sm font-semibold text-v3-dark"
            data-component={`${dataComponent}_form_retry-on-failure`}
          >
            <span>실패 시 재전송</span>
            <input
              name="retryOnFailure"
              type="checkbox"
              checked={form.retryOnFailure}
              onChange={(event) => setField("retryOnFailure", event.target.checked)}
            />
          </label>
          <p className="text-xs text-v3-text-muted">일시적인 발송 실패를 설정된 재시도 간격에 따라 다시 보냅니다.</p>
        </div>

        <label className="flex min-h-11 items-center justify-between rounded-xl border border-v3-border bg-white px-3 text-sm font-semibold text-v3-dark">
          <span>규칙 활성화</span>
          <input
            name="isActive"
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setField("isActive", event.target.checked)}
          />
        </label>

        {groupMode ? <div data-component={`${dataComponent}_form_preview`} className="space-y-3">
          <Button type="button" variant="v3-soft" data-component={`${dataComponent}_form_preview_action`} disabled={!validDraft || !branchId || isPending} onClick={() => void handlePreview()}>수신자별 미리보기</Button>
          {preview?.fingerprint === draftFingerprint ? <InfoCard data-component={`${dataComponent}_form_preview_result`} title="현재 지점 전송 대상 미리보기">
            <InfoRow label="전송 대상" value={`${preview.data.count}건`} />
            <InfoRow label="확인 상태" value={preview.data.complete ? "미리보기 완료" : "전체 대상을 확인하지 못했습니다. 대상이 많거나 확인이 필요한 정보가 있습니다."} />
            {preview.data.recipients.length === 0 ? <InfoRow label="수신자" value={preview.data.complete ? "현재 조건에 맞는 수신자가 없습니다." : "확인할 수 있는 수신자가 없습니다."} /> : null}
            {preview.data.recipients.map((recipient, index) => <InfoCard key={`${recipient.recipientType}-${index}`} data-component={`${dataComponent}_form_preview_result_recipient-${index}`} title={`${RECIPIENT_OPTIONS.find((option) => option.value === recipient.recipientType)?.label ?? "수신자"} · ${recipient.recipientName ?? "수신자 없음"}`}>
              <InfoRow label="연락처" value={recipient.recipientPhone ?? "연락처 없음"} />
              <InfoRow label="메시지 템플릿" value={templates.find((template) => template.key === recipient.templateKey)?.name ?? "템플릿 확인 필요"} />
              <InfoRow label="예상 건수" value={`${recipient.count}건`} />
              <InfoRow label="발송 시각 (한국 시간)" value={recipient.scheduledFor ? new Date(recipient.scheduledFor).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "예약 없음"} />
              <InfoRow label="기준 일정" value={`${PREVIEW_ANCHOR_LABELS[recipient.anchorSource]} · ${recipient.anchorDate ?? "기준일 없음"}`} />
              <InfoRow label="처리" value={PREVIEW_OUTCOME_LABELS[recipient.outcome]} />
              {recipient.reason ? <InfoRow label="사유" value={previewReasonLabel(recipient.reason)} /> : null}
              <InfoRow label="메시지 내용" value={recipient.body ?? "본문 없음"} />
            </InfoCard>)}
          </InfoCard> : null}
        </div> : null}
        {error ? <p className="text-sm font-semibold text-v3-burgundy" role="alert">{error}</p> : null}

        <div className="flex gap-2" data-component={`${dataComponent}_form_actions`}>
          {onCancel ? <Button type="button" data-component={`${dataComponent}_form_actions_cancel`} variant="v3-soft" disabled={isPending} onClick={onCancel}>취소</Button> : null}
          {(group || rule && !rule.isDefault) ? (
            <button
              type="button"
              className="btn btn-secondary min-h-11"
              disabled={isPending}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 size={15} aria-hidden="true" />
              규칙 삭제
            </button>
          ) : null}
          <button type="submit" className="btn btn-primary min-h-11 flex-1" disabled={isPending || !validDraft || groupMode && !branchId}>
            {isPending ? "저장 중…" : "규칙 저장"}
          </button>
        </div>
        </fieldset>
      </form>

      <ApprovalTwoButtonModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="자동 전송 규칙을 삭제할까요?"
        description="삭제한 규칙은 복구할 수 없어요."
        isDescriptionVisuallyHidden={false}
        approvalLabel="삭제 확인"
        pendingLabel="삭제 중…"
        approvalVariant="destructive"
        isPending={groupPending || deleteMutation.isPending}
        onApprove={handleDelete}
        data-component={`${dataComponent}_delete-modal`}
      />
    </MobileDetailPage>
  );
}
