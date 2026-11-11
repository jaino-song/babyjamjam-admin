"use client";

import { useId } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, FileText } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { documentJobOperationLabel, documentJobStatus } from "@/features/document-jobs/job-display";
import type { ContractDocumentJobsData } from "./ContractDocumentJobsPopover";

export type ContractDocumentJobsSection = "processing" | "attention" | "recent";
export interface ContractDocumentJobsListProps {
  jobs?: ContractDocumentJobsData | null;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  collapsed: Readonly<Record<ContractDocumentJobsSection, boolean>>;
  onToggle: (section: ContractDocumentJobsSection) => void;
  onSelect: (jobId: string, clickedButton: HTMLButtonElement) => void;
  "data-component"?: string;
}
const sections = [
  { key: "processing", field: "active", title: "처리 중", icon: Clock3, empty: "처리 중인 전자문서가 없습니다." },
  { key: "attention", field: "requiresAttention", title: "확인 필요", icon: AlertCircle, empty: "확인이 필요한 전자문서가 없습니다." },
  { key: "recent", field: "recent", title: "최근 처리", icon: CheckCircle2, empty: "최근 처리한 전자문서가 없습니다." },
] as const;

export function ContractDocumentJobsList({ jobs, isLoading, error, onRetry, collapsed, onToggle, onSelect, "data-component": base }: ContractDocumentJobsListProps) {
  const id = useId();
  const sub = (part: string) => base ? `${base}_${part}` : undefined;
  return <div data-component={base} data-slot="contract-document-jobs-list" data-source-component="ContractDocumentJobsList" className="contract-document-jobs-list">
    {error ? <Alert data-component={sub("error")} data-slot="contract-document-jobs-state" className="contract-document-jobs-state">
      <AlertTitle data-component={sub("error_title")}>전자문서 작업을 불러오지 못했습니다.</AlertTitle>
      {onRetry ? <Button type="button" variant="outline" size="sm" data-component={sub("error_retry")} onClick={onRetry}>다시 시도</Button> : null}
    </Alert> : isLoading ? <div role="status" aria-label="전자문서 작업 불러오는 중" data-component={sub("loading")} data-slot="contract-document-jobs-state" className="contract-document-jobs-state">
      <Spinner aria-hidden="true" data-component={sub("loading_spinner")} /><span>불러오는 중</span>
    </div> : sections.map(({ key, field, title, icon: SectionIcon, empty }) => {
      const items = jobs?.[field] ?? [];
      const expanded = !collapsed[key];
      const toggleId = `${id}-${key}-toggle`, contentId = `${id}-${key}-content`;
      return <section key={key} data-component={sub(key)} data-slot="contract-document-jobs-section" className="contract-document-jobs-section">
        <h3><Button type="button" variant="ghost" id={toggleId} aria-label={`${title} ${items.length}건`} aria-expanded={expanded} aria-controls={contentId}
          data-component={sub(`${key}_toggle`)} data-slot="contract-document-jobs-toggle" className="contract-document-jobs-toggle" onClick={() => onToggle(key)}>
          <SectionIcon aria-hidden="true" /><span data-component={sub(`${key}_toggle_title`)}>{title}</span>
          <span data-component={sub(`${key}_toggle_count`)} data-slot="contract-document-jobs-count" className="contract-document-jobs-count">{items.length}건</span>
          <ChevronDown aria-hidden="true" data-slot="contract-document-jobs-chevron" className="contract-document-jobs-chevron" />
        </Button></h3>
        <div id={contentId} role="region" aria-labelledby={toggleId} aria-hidden={!expanded} inert={!expanded || undefined} data-expanded={expanded}
          data-component={sub(`${key}_content`)} data-slot="contract-document-jobs-content" className="contract-document-jobs-content">
          <div data-slot="contract-document-jobs-inner" className="contract-document-jobs-inner">
            {items.length ? <div data-slot="contract-document-jobs-cards" className="contract-document-jobs-cards">{items.map((job, index) => {
              const scope = `${key}_content_item-${index}`;
              const name = job.clientName?.trim() || "고객 정보 확인 필요";
              const operation = documentJobOperationLabel(job), status = documentJobStatus(job.status);
              const Icon = status.variant === "danger" ? AlertCircle : status.variant === "success" ? CheckCircle2 : FileText;
              return <Button key={job.jobId} type="button" variant="ghost" aria-label={`${name} · ${operation} · ${status.label} 상세 보기`}
                data-component={sub(scope)} data-slot="contract-document-jobs-card" data-active={key !== "recent"} className="contract-document-jobs-card"
                onClick={(event) => onSelect(job.jobId, event.currentTarget)}>
                <span data-component={sub(`${scope}_icon`)} data-slot="contract-document-jobs-card-icon" data-warning={status.variant === "danger"} className="contract-document-jobs-card-icon"><Icon aria-hidden="true" /></span>
                <span data-component={sub(`${scope}_copy`)} data-slot="contract-document-jobs-card-copy" className="contract-document-jobs-card-copy">
                  <span data-component={sub(`${scope}_copy_title`)} data-slot="contract-document-jobs-card-title" className="contract-document-jobs-card-title">{name}</span>
                  <span data-component={sub(`${scope}_copy_subtype`)} data-slot="contract-document-jobs-card-subtype" className="contract-document-jobs-card-subtype">{operation}</span>
                </span>
                <span data-component={sub(`${scope}_status`)} data-slot="contract-document-jobs-card-status" className="contract-document-jobs-card-status"><StatusBadge data-component={sub(`${scope}_status_badge`)} variant={status.variant}>{status.label}</StatusBadge></span>
              </Button>;
            })}</div> : <p data-component={sub(`${key}_content_empty`)} data-slot="contract-document-jobs-empty" className="contract-document-jobs-empty">{empty}</p>}
          </div>
        </div>
      </section>;
    })}
  </div>;
}
