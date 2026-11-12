"use client";

import { useId } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, FileText } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AnimatedSlotList } from "@/components/app/v3/AnimatedSlotList";
import { AnimatedSlotListItemContent } from "@/components/app/v3/AnimatedSlotListItemContent";
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
  onSelect: (jobId: string, clickedElement: HTMLElement) => void;
  cardVariant?: "full" | "compact";
  "data-component"?: string;
}
const sections = [
  { key: "processing", field: "active", title: "처리중", icon: Clock3, empty: "처리중인 전자문서가 없습니다." },
  { key: "attention", field: "requiresAttention", title: "확인 필요", icon: AlertCircle, empty: "확인이 필요한 전자문서가 없습니다." },
  { key: "recent", field: "recent", title: "최근 처리", icon: CheckCircle2, empty: "최근 처리한 전자문서가 없습니다." },
] as const;

export function ContractDocumentJobsList({ jobs, isLoading, error, onRetry, collapsed, onToggle, onSelect, cardVariant = "full", "data-component": base }: ContractDocumentJobsListProps) {
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
            {items.length ? <AnimatedSlotList data-component={sub(`${key}_content_list`)} items={items} isLoading={false}
              itemVariant="job" size={cardVariant} getItemKey={job => job.jobId}
              getSlotState={() => ({ isEmphasized: key !== "recent" })}
              getSlotProps={({ item: job, index }) => ({
                "data-component": sub(`${key}_content_list_item-${index}`),
                "data-slot": "contract-document-jobs-card",
                "aria-label": job ? `${job.clientName?.trim() || "고객 정보 확인 필요"} · ${documentJobOperationLabel(job)} · ${documentJobStatus(job.status).label} 상세 보기` : undefined,
              })}
              onSlotClick={(job, _index, element) => onSelect(job.jobId, element)}
              render={({ item: job, index }) => {
                if (!job) return null;
                const scope = `${key}_content_list_item-${index}`;
                const status = documentJobStatus(job.status);
                const Icon = status.variant === "danger" ? AlertCircle : status.variant === "success" ? CheckCircle2 : FileText;
                return <AnimatedSlotListItemContent data-component={sub(scope)} icon={Icon}
                  title={job.clientName?.trim() || "고객 정보 확인 필요"} subtitle={documentJobOperationLabel(job)}
                  iconContainerClassName={status.variant === "danger" ? "border border-amber-700/20 bg-amber-100 text-amber-700" : "border border-v3-primary/20 bg-v3-primary-light text-v3-primary"}
                  status={<StatusBadge data-component={sub(`${scope}_status_badge`)} variant={status.variant}>{status.label}</StatusBadge>} />;
              }} /> : <p data-component={sub(`${key}_content_empty`)} data-slot="contract-document-jobs-empty" className="contract-document-jobs-empty">{empty}</p>}
          </div>
        </div>
      </section>;
    })}
  </div>;
}
