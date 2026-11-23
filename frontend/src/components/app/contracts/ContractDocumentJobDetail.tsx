"use client";

import Link from "next/link";

import { InfoRow } from "@/components/app/v3/InfoRow";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { documentJobOperationLabel, documentJobStatus } from "@/features/document-jobs/job-display";
import { describeJobFailureDetail, initialDocumentStateLabel } from "@/features/document-jobs/failure-popup-copy";
import { recoverJobHref } from '@/features/document-jobs/failure-popup-copy';
import { INITIAL_DOCUMENT_RECOVERY_COPY, initialRegenerationBlockedCopy, SERVICE_RECORD_RECOVERY_COPY, serviceRecordMayExist } from "@/features/document-jobs/service-record-recovery-copy";

import type {
  InitialDocumentAction,
  InitialNoProviderDocumentProjection,
  InitialRegenerationProjection,
} from "@/lib/eformsign/initial-document-recovery-contract";

import type { ContractDocumentJob } from "./ContractDocumentJobsPopover";
import { DocumentJobProgressSummary } from "./DocumentJobProgressSummary";

export type InitialDocumentActionHandler = (action: InitialDocumentAction, trigger: HTMLButtonElement) => void;

interface InitialDocumentDetailProps {
  regeneration?: InitialRegenerationProjection;
  confirmation?: InitialNoProviderDocumentProjection;
  clientName?: string;
  onInitialAction: InitialDocumentActionHandler;
  "data-component": string;
}

export function InitialDocumentJobDetail({ regeneration, confirmation, clientName, onInitialAction, "data-component": base }: InitialDocumentDetailProps) {
  const reason = initialRegenerationBlockedCopy(regeneration?.reasonCode);
  const state = initialDocumentStateLabel(regeneration?.reasonCode);
  return <Card data-component={base} data-slot="initial-document-detail" data-source-component="InitialDocumentJobDetail" className="gap-3 p-4">
    {clientName && <InfoRow label="고객" value={clientName} data-component={`${base}_client`} />}
    {confirmation && <InfoRow label="이폼사인 접미사" value={confirmation.suffix} data-component={`${base}_suffix`} />}
    {state && <p data-component={`${base}_state`} data-slot="initial-document-state">{state}</p>}
    {reason && <p data-component={`${base}_readiness`} data-slot="initial-document-readiness">{reason}</p>}
    {regeneration?.ready && <Button type="button" variant="outline"
      data-component={`${base}_regenerate`} data-slot="initial-document-regenerate"
      onClick={event => onInitialAction({ kind: "regenerate", target: regeneration }, event.currentTarget)}
    >{INITIAL_DOCUMENT_RECOVERY_COPY.regenerateLabel}</Button>}
    {confirmation && <Button type="button" variant="outline"
      data-component={`${base}_confirm-no-provider-document`} data-slot="initial-document-confirm"
      onClick={event => onInitialAction({ kind: "confirm-no-provider-document", target: confirmation }, event.currentTarget)}
    >{INITIAL_DOCUMENT_RECOVERY_COPY.confirmLabel}</Button>}
  </Card>;
}

export type DocumentJobCancelHandler = (jobId: string, trigger: HTMLButtonElement, onCancelled?: () => void) => void;

export type DocumentJobRetryHandler = (jobId: string, trigger: HTMLButtonElement, onRetried?: () => void) => void;

interface ContractDocumentJobDetailProps {
  job: ContractDocumentJob;
  onDocumentNavigate?: () => void;
  onRetryJob?: DocumentJobRetryHandler;
  onCancel?: DocumentJobCancelHandler;
  onCancelled?: () => void;
  onRecover?: (jobId: string, trigger: HTMLButtonElement) => void;
  "data-component"?: string;
}

const DATE_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  hour12: false, timeZone: "Asia/Seoul",
});

function formatTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  const parts = DATE_FORMAT.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}.${part("month")}.${part("day")} ${part("hour")}:${part("minute")}`;
}

export function ContractDocumentJobDetail({ job, onDocumentNavigate, onRecover, onCancel, onRetryJob, onCancelled, "data-component": base }: ContractDocumentJobDetailProps): React.ReactElement {
  const sub = (suffix: string) => base ? `${base}_${suffix}` : undefined;
  const failure = describeJobFailureDetail(job);
  const rows = [
    ["operation", "작업 유형", documentJobOperationLabel(job)],
    ["status", "상태", documentJobStatus(job.status).label],
    ...(failure ? [["failure-reason", "실패 사유", failure.reason]] : []),
    ["started-at", "작업 시작", formatTime(job.createdAt)],
    ["ended-at", "작업 종료", formatTime(job.completedAt ?? (failure ? job.updatedAt : null))],
    ["attempts", "시도 횟수", typeof job.attempts === "number" && Number.isFinite(job.attempts) && job.attempts >= 0 ? `${job.attempts}회` : "-"],
  ];

  return (
    <div data-component={base} data-slot="job-detail-body" data-source-component="ContractDocumentJobDetail" className="space-y-4">
      <DocumentJobProgressSummary job={job} data-component={sub("progress")} action={failure?.actionKind ? (onRecover
        ? <Button type="button" className="w-full" data-component={sub("progress_action_button")} data-slot="job-failure-action"
            onClick={event => onRecover(job.jobId, event.currentTarget)}>{failure.actionLabel}</Button>
        : <Button asChild className="w-full" data-component={sub("progress_action_button")} data-slot="job-failure-action">
            <Link href={recoverJobHref(job.jobId)} onClick={onDocumentNavigate}>{failure.actionLabel}</Link>
          </Button>) : null} retryAction={job.retryable === true ? (
        <Button type="button" variant="outline" className="w-full" data-component={sub("progress_retry_button")} data-slot="job-retry-action"
          onClick={event => onRetryJob?.(job.jobId, event.currentTarget, onCancelled)}>재시도</Button>
      ) : null} secondaryAction={job.cancellable === true ? (
        <Button type="button" variant="outline" className="w-full" data-component={sub("progress_cancel_button")} data-slot="job-cancel-action"
          onClick={event => onCancel?.(job.jobId, event.currentTarget, onCancelled)}>취소</Button>
      ) : null} />
      {job.documentKind === "service_record" && serviceRecordMayExist(job) ? (
        <p data-component={sub("dispatch-warning")} data-slot="job-dispatch-warning" className="text-sm text-v3-text-muted">
          {SERVICE_RECORD_RECOVERY_COPY.afterDispatch}
        </p>
      ) : null}
      <Card data-component={sub("info")} data-slot="job-info-card" className="rounded-[18px] border-0 bg-v3-dim-white p-4 shadow-none">
        <h3 data-component={sub("info_title")} data-slot="job-info-title" className="mb-2 text-xs font-semibold leading-[18px] text-v3-text-muted">작업 정보</h3>
        {rows.map(([key, label, value]) => (
          <div key={key} data-component={sub(`info_${key}`)} data-slot="job-info-row" className="border-b border-v3-border last:border-b-0">
            <InfoRow data-component={sub(`info_${key}_content`)} label={label} value={<span className="break-words">{value}</span>} size="compact" className="border-0" />
          </div>
        ))}
      </Card>

    </div>
  );
}
