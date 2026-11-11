"use client";

import { FileText } from "lucide-react";

import { StatusBadge } from "@/components/app/ui/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { documentJobOperationLabel, documentJobStatus } from "@/features/document-jobs/job-display";

import type { ContractDocumentJob } from "./ContractDocumentJobsPopover";

interface ContractDocumentJobSummaryProps {
  job: ContractDocumentJob;
  "data-component"?: string;
}

export function ContractDocumentJobSummary({ job, "data-component": base }: ContractDocumentJobSummaryProps): React.ReactElement {
  const sub = (suffix: string) => base ? `${base}_${suffix}` : undefined;
  const status = documentJobStatus(job.status);

  return (
    <div data-component={base} data-slot="job-detail-summary" data-source-component="ContractDocumentJobSummary" className="flex items-center gap-3">
      <Avatar data-component={sub("avatar")} data-slot="job-detail-avatar" aria-hidden="true" className="h-12 w-12 rounded-[16px] border border-v3-border">
        <AvatarFallback className="rounded-[16px] bg-v3-primary-light text-v3-primary">
          <FileText className="size-5" />
        </AvatarFallback>
      </Avatar>
      <div data-component={sub("heading")} data-slot="job-detail-heading" className="min-w-0 flex-1">
        <h2 data-component={sub("heading_customer")} data-slot="job-detail-customer" className="text-base font-bold leading-6 break-words text-v3-dark">
          {job.clientName?.trim() || "고객 정보 확인 필요"}
        </h2>
        <p data-component={sub("heading_type")} data-slot="job-detail-type" className="mt-0.5 text-[12.8px] leading-5 text-v3-text-muted">
          {documentJobOperationLabel(job)}
        </p>
      </div>
      <StatusBadge data-component={sub("status")} variant={status.variant} className="self-center">
        {status.label}
      </StatusBadge>
    </div>
  );
}
