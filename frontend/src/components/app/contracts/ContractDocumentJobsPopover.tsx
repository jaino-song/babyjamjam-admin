"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileSignature,
  History,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";

import { StatusBadge } from "@/components/app/ui/status-badge";
import { AnimatedSlotList } from "@/components/app/v3/AnimatedSlotList";
import { AnimatedSlotListItemContent } from "@/components/app/v3/AnimatedSlotListItemContent";
import { EmptyState } from "@/components/app/v3/EmptyState";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { isRecoverableJob, recoverJobHref } from "@/features/document-jobs/failure-popup-copy";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "ContractDocumentJobsPopover";

export type ContractDocumentJobStatus =
  | "queued"
  | "processing"
  | "reconciling"
  | "completed"
  | "failed"
  | "requires_attention"
  | (string & {});

export interface ContractDocumentJob {
  jobId: string;
  jobType: string;
  source?: "staff" | "auto_finalize";
  status: ContractDocumentJobStatus;
  clientId?: number | null;
  clientName?: string | null;
  recoveryKind?: "manual_send" | "verify_result" | null;
  documentId?: string | null;
  progressStep?: string | null;
  attempts?: number;
  nextAttemptAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContractDocumentJobsSummary {
  activeCount: number;
  requiresAttentionCount: number;
}

export interface ContractDocumentJobsData {
  active: readonly ContractDocumentJob[];
  requiresAttention: readonly ContractDocumentJob[];
  recent: readonly ContractDocumentJob[];
}

export interface ContractDocumentJobsPopoverProps {
  trigger?: React.ReactElement;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  summary?: ContractDocumentJobsSummary | null;
  jobs?: ContractDocumentJobsData | null;
  documentJobs?: ContractDocumentJobsData | null;
  isLoading?: boolean;
  isJobsLoading?: boolean;
  error?: unknown;
  jobsError?: unknown;
  onRetry?: () => void;
  onRetryJobs?: () => void;
  "data-component"?: string;
  className?: string;
}

interface SectionProps {
  base?: string;
  title: string;
  icon: typeof Clock3;
  items: readonly ContractDocumentJob[];
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  emptyMessage: string;
  onNavigate: () => void;
}

const STATUS_COPY: Record<ContractDocumentJobStatus, { label: string; variant: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  queued: { label: "대기", variant: "neutral" },
  processing: { label: "처리 중", variant: "info" },
  reconciling: { label: "확인 중", variant: "warning" },
  completed: { label: "완료", variant: "success" },
  failed: { label: "실패", variant: "danger" },
  requires_attention: { label: "수동 확인", variant: "danger" },
};

function getStatusCopy(status: ContractDocumentJobStatus) {
  return STATUS_COPY[status] ?? { label: "처리 중", variant: "info" as const };
}

function getJobTitle(job: ContractDocumentJob): string {
  const who = job.clientName?.trim() || "고객";
  return `${who} · ${job.jobType === "create_document" ? "계약서 생성" : "검토완료"}`;
}

/** Machine steps written by the backend; staff see words, never the step name. */
const PROGRESS_STEP_COPY: Readonly<Record<string, string>> = {
  queued: "대기 중",
  processing: "처리 중",
  "client-started": "전자문서 연결 중",
  "info-inserted": "이용자 정보 입력 완료",
  creating: "전자문서 생성 중",
  sent: "전송 완료",
  failed: "실패",
  reconciling: "결과 확인 중",
  dispatch_authorized: "전송 준비 중",
  manual_resolved: "처리됨으로 표시",
  manual_in_progress: "처리 중",
};

/** A manual claim may be stored as `manual_in_progress:<userId>:<expiry>`; only the prefix is meaningful. */
const MANUAL_CLAIM_STEP_PREFIX = "manual_in_progress:";

function getProgressStepCopy(progressStep: string | null | undefined): string | undefined {
  if (!progressStep) return undefined;
  if (progressStep.startsWith(MANUAL_CLAIM_STEP_PREFIX)) return PROGRESS_STEP_COPY.manual_in_progress;
  return Object.prototype.hasOwnProperty.call(PROGRESS_STEP_COPY, progressStep)
    ? PROGRESS_STEP_COPY[progressStep]
    : undefined;
}

function getJobSubtitle(job: ContractDocumentJob): string {
  const stepCopy = getProgressStepCopy(job.progressStep);
  if (stepCopy) return stepCopy;
  if (job.documentId) return `문서 ID ${job.documentId}`;
  return "문서 연결 정보 없음";
}

function getJobMeta(job: ContractDocumentJob): string {
  if (job.source === "auto_finalize") return "자동 최종화";
  if (job.attempts && job.attempts > 1) return `${job.attempts}회 시도`;
  // Failed jobs also carry completedAt (the failure time), so only a completed job is "done".
  if (job.completedAt && job.status === "completed") return "최근 완료";
  return "전자문서 작업";
}

function getJobIcon(job: ContractDocumentJob) {
  if (job.status === "completed") return CheckCircle2;
  if (job.status === "failed" || job.status === "requires_attention") return AlertCircle;
  if (job.jobType === "create_document") return FileSignature;
  return LoaderCircle;
}

function JobRow({
  job,
  dataComponent,
  onNavigate,
}: {
  job: ContractDocumentJob;
  dataComponent?: string;
  onNavigate: () => void;
}) {
  const Icon = getJobIcon(job);
  const statusCopy = getStatusCopy(job.status);
  const sub = (suffix: string) => (dataComponent ? `${dataComponent}_${suffix}` : undefined);
  const content = (
    <AnimatedSlotListItemContent
      data-component={sub("content")}
      icon={Icon}
      title={getJobTitle(job)}
      subtitle={getJobSubtitle(job)}
      meta={getJobMeta(job)}
      status={<StatusBadge variant={statusCopy.variant}>{statusCopy.label}</StatusBadge>}
      iconContainerClassName="bg-v3-dim-white"
    />
  );

  const isTerminal =
    job.status === "failed" || job.status === "requires_attention" || job.status === "completed";
  const isCompleted = job.status === "completed";
  const documentHref = job.documentId
    ? `/contracts?documentId=${encodeURIComponent(job.documentId)}`
    : null;
  const href =
    (job.status === "failed" || job.status === "requires_attention") && isRecoverableJob(job)
      ? recoverJobHref(job.jobId)
      : isTerminal
        ? documentHref
        : null;

  if (!href) {
    return (
      <div
        data-component={sub("static")}
        className="flex min-w-0 items-center gap-[calc(12px*var(--glint-ui-scale,1))] rounded-[16px] px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(10px*var(--glint-ui-scale,1))]"
        title={isCompleted ? "연결된 계약서가 없어 이동할 수 없어요." : undefined}
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      href={href}
      data-component={sub("link")}
      className="flex min-w-0 items-center rounded-[16px] px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(10px*var(--glint-ui-scale,1))] text-left transition-colors hover:bg-v3-dim-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary focus-visible:ring-offset-2"
      onClick={onNavigate}
    >
      {content}
    </Link>
  );
}

function JobSection({
  base,
  title,
  icon: SectionIcon,
  items,
  isLoading,
  error,
  onRetry,
  emptyMessage,
  onNavigate,
}: SectionProps) {
  return (
    <section data-component={base} data-slot="job-section" className="space-y-[calc(8px*var(--glint-ui-scale,1))]">
      <div data-component={base ? `${base}_heading` : undefined} className="flex items-center gap-2 px-[calc(4px*var(--glint-ui-scale,1))]">
        <SectionIcon className="h-4 w-4 text-v3-text-muted" aria-hidden="true" />
        <h3 className="text-[calc(11.2px*var(--glint-ui-scale,1))] font-bold text-v3-text-muted">{title}</h3>
      </div>

      {error ? (
        <div
          data-component={base ? `${base}_error` : undefined}
          className="flex flex-col items-center gap-2 rounded-[16px] px-4 py-5 text-center"
        >
          <AlertCircle className="h-5 w-5 text-v3-burgundy" aria-hidden="true" />
          <p className="text-[calc(11.2px*var(--glint-ui-scale,1))] text-v3-text-muted">
            전자문서 작업을 불러오지 못했습니다.
          </p>
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              다시 시도
            </Button>
          ) : null}
        </div>
      ) : isLoading ? (
        <div
          data-component={base ? `${base}_loading` : undefined}
          className="flex min-h-24 items-center justify-center rounded-[16px] px-4 py-5"
          aria-label={`${title} 불러오는 중`}
        >
          <Spinner size="sm" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={History}
          message={emptyMessage}
          className="min-h-20 rounded-[16px]"
        />
      ) : (
        <AnimatedSlotList
          data-component={base ? `${base}_list` : undefined}
          items={items}
          isLoading={false}
          itemVariant="unstyled"
          itemDataComponent={base ? `${base}_list_slot` : undefined}
          getItemKey={(item) => item.jobId}
          slotClassName="min-w-0"
          render={({ item, index }) => {
            if (!item) return null;
            const itemBase = base ? `${base}_list_slot-${item.jobId || index}` : undefined;
            return (
              <JobRow
                job={item}
                dataComponent={itemBase}
                onNavigate={onNavigate}
              />
            );
          }}
        />
      )}
    </section>
  );
}

export function ContractDocumentJobsPopover({
  trigger,
  open,
  defaultOpen = false,
  onOpenChange,
  summary: _summary,
  jobs,
  documentJobs,
  isLoading: loading = false,
  isJobsLoading = false,
  error,
  jobsError,
  onRetry,
  onRetryJobs,
  "data-component": dataComponent,
  className,
}: ContractDocumentJobsPopoverProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const resolvedJobs = documentJobs ?? jobs ?? null;
  const resolvedLoading = loading || isJobsLoading;
  const resolvedError = error ?? jobsError ?? null;
  const resolvedRetry = onRetry ?? onRetryJobs;
  const sub = (suffix: string) => (dataComponent ? `${dataComponent}_${suffix}` : undefined);
  // Below lg the list is a bottom sheet. A Radix popper wrapper is a transformed, fixed box sized
  // to its content, so a `fixed inset-x-0` child inside it collapses to a sliver; the sheet is a
  // Dialog portal with no such wrapper.
  const isMobile = useIsMobile();

  const handleOpenChange = (nextOpen: boolean) => {
    setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const resolvedTrigger = trigger ?? (
    <Button type="button" variant="outline" size="sm" aria-label="전자문서 처리중">
      전자문서 처리중
    </Button>
  );

  const panelBody = (
    <>
      <div data-component={sub("body")} className="max-h-[min(560px,calc(100vh-148px))] min-h-0 space-y-5 overflow-y-auto px-5 py-4 flex-1">
        <JobSection
          base={sub("processing")}
          title="처리 중"
          icon={Clock3}
          items={resolvedJobs?.active ?? []}
          isLoading={resolvedLoading}
          error={resolvedError}
          onRetry={resolvedRetry}
          emptyMessage="처리 중인 전자문서가 없습니다."
          onNavigate={() => handleOpenChange(false)}
        />
        <JobSection
          base={sub("attention")}
          title="확인 필요"
          icon={AlertCircle}
          items={resolvedJobs?.requiresAttention ?? []}
          isLoading={resolvedLoading}
          error={resolvedError}
          onRetry={resolvedRetry}
          emptyMessage="확인이 필요한 전자문서가 없습니다."
          onNavigate={() => handleOpenChange(false)}
        />
        <JobSection
          base={sub("recent")}
          title="최근 처리"
          icon={CheckCircle2}
          items={resolvedJobs?.recent ?? []}
          isLoading={resolvedLoading}
          error={resolvedError}
          onRetry={resolvedRetry}
          emptyMessage="최근 처리한 전자문서가 없습니다."
          onNavigate={() => handleOpenChange(false)}
        />
      </div>
    </>
  );

  const panelHeader = (mobile: boolean) => {
    const title = <p className="text-[calc(14px*var(--glint-ui-scale,1))] font-bold text-v3-dark">전자문서 작업</p>;
    const description = <p className="mt-1 text-[calc(10.4px*var(--glint-ui-scale,1))] text-v3-text-muted">읽기 전용 처리 현황</p>;
    return (
      <div data-component={sub("header")} className="flex items-center justify-between border-b border-v3-border px-5 py-4">
        <div>
          {mobile ? <SheetTitle asChild>{title}</SheetTitle> : title}
          {mobile ? <SheetDescription asChild>{description}</SheetDescription> : description}
        </div>
        <span className="text-[calc(10.4px*var(--glint-ui-scale,1))] text-v3-text-muted">
          {(_summary?.activeCount ?? 0) + (_summary?.requiresAttentionCount ?? 0)}건
        </span>
      </div>
    );
  };

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>{resolvedTrigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          data-component={dataComponent}
          data-slot="document-jobs-popover"
          data-source-component={SOURCE_COMPONENT}
          className={cn(
            "!z-[60] max-h-[85dvh] gap-0 overflow-hidden rounded-t-[28px] border-b-0 p-0 pb-[env(safe-area-inset-bottom)]",
            className,
          )}
        >
          {panelHeader(true)}
          {panelBody}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{resolvedTrigger}</PopoverTrigger>
      <PopoverContent
        data-component={dataComponent}
        data-slot="document-jobs-popover"
        data-source-component={SOURCE_COMPONENT}
        side="bottom"
        align="end"
        sideOffset={12}
        avoidCollisions
        className={cn(
          "!z-[60] !w-[min(420px,calc(100vw-32px))] max-h-[min(640px,calc(100vh-64px))] overflow-hidden p-0",
          className,
        )}
      >
        {panelHeader(false)}
        {panelBody}
      </PopoverContent>
    </Popover>
  );
}
