"use client";

import Link from "next/link";

import { InfoRow } from "@/components/app/v3/InfoRow";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { documentJobOperationLabel, documentJobStatus } from "@/features/document-jobs/job-display";
import { describeJobFailureDetail } from "@/features/document-jobs/failure-popup-copy";
import { recoverJobHref } from '@/features/document-jobs/failure-popup-copy';

import type { ContractDocumentJob } from "./ContractDocumentJobsPopover";
import { DocumentJobProgressSummary } from "./DocumentJobProgressSummary";

interface ContractDocumentJobDetailProps {
  job: ContractDocumentJob;
  onDocumentNavigate?: () => void;
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

export function ContractDocumentJobDetail({ job, onDocumentNavigate, onRecover, "data-component": base }: ContractDocumentJobDetailProps): React.ReactElement {
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
          </Button>) : null} />
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
