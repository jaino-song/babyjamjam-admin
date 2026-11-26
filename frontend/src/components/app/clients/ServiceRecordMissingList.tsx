"use client";

import { useId, useState } from "react";
import { ChevronDown, ClipboardX } from "lucide-react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AnimatedSlotList } from "@/components/app/v3/AnimatedSlotList";
import { AnimatedSlotListItemContent } from "@/components/app/v3/AnimatedSlotListItemContent";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { serviceRecordCaseLabel } from "@/features/service-records/utils/case-selection";
import type { ServiceRecordMissingClients } from "@/features/clients/types/service-record-missing";

interface ServiceRecordMissingListProps {
  items: ServiceRecordMissingClients["items"];
  error?: unknown;
  onRetry: () => void;
  onSelectClient: (clientId: number, caseId?: string) => void;
  "data-component": string;
}

export function ServiceRecordMissingList({ items, error, onRetry, onSelectClient, "data-component": base }: ServiceRecordMissingListProps) {
  const id = useId();
  const [expanded, setExpanded] = useState(true);
  const clientCount = new Set(items.map(({ clientId }) => clientId)).size;
  const titleFor = (item: ServiceRecordMissingClients["items"][number]) => {
    if ((item.babyCount ?? 0) < 2 && !item.legacyName) return item.clientName;
    return `${item.clientName} · ${serviceRecordCaseLabel({ rank: item.rank ?? null, legacyName: item.legacyName ?? null })}`;
  };
  const countLabel = items.length === clientCount ? `${clientCount}명` : `${clientCount}명 · 기록지 ${items.length}건`;
  return <div data-component={base} data-slot="contract-document-jobs-list" data-source-component="ServiceRecordMissingList" className="contract-document-jobs-list">
    {error ? <Alert data-component={`${base}_error`} data-slot="contract-document-jobs-state" className="contract-document-jobs-state">
      <AlertTitle data-component={`${base}_error_title`}>제공기록지 미작성 고객을 불러오지 못했습니다.</AlertTitle>
      <Button type="button" variant="outline" size="sm" data-component={`${base}_error_retry`} onClick={onRetry}>다시 시도</Button>
    </Alert> : <section data-component={`${base}_missing`} data-slot="contract-document-jobs-section" className="contract-document-jobs-section">
      <h3><Button type="button" variant="ghost" id={`${id}-toggle`} aria-label={`미작성 중인 서비스 ${countLabel}`} aria-expanded={expanded} aria-controls={`${id}-content`}
        data-component={`${base}_missing_toggle`} data-slot="contract-document-jobs-toggle" className="contract-document-jobs-toggle" onClick={() => setExpanded(current => !current)}>
        <ClipboardX aria-hidden="true" /><span data-component={`${base}_missing_toggle_title`}>미작성 중인 서비스</span>
        <span data-component={`${base}_missing_toggle_count`} data-slot="contract-document-jobs-count" className="contract-document-jobs-count">{countLabel}</span>
        <ChevronDown aria-hidden="true" data-slot="contract-document-jobs-chevron" className="contract-document-jobs-chevron" />
      </Button></h3>
      <div id={`${id}-content`} role="region" aria-labelledby={`${id}-toggle`} aria-hidden={!expanded} inert={!expanded || undefined} data-expanded={expanded}
        data-component={`${base}_missing_content`} data-slot="contract-document-jobs-content" className="contract-document-jobs-content">
        <div data-slot="contract-document-jobs-inner" className="contract-document-jobs-inner">
          {items.length ? <AnimatedSlotList data-component={`${base}_missing_content_list`} items={items} isLoading={false}
            itemVariant="job" size="compact" getItemKey={item => item.caseId ?? String(item.clientId)} getSlotState={() => ({ isEmphasized: true })}
            getSlotProps={({ item, index }) => ({ "data-component": `${base}_missing_content_list_item-${index}`, "data-slot": "contract-document-jobs-card", "aria-label": item ? `${titleFor(item)} 제공기록지 보기` : undefined })}
            onSlotClick={item => item.caseId ? onSelectClient(item.clientId, item.caseId) : onSelectClient(item.clientId)}
            render={({ item, index }) => item ? <AnimatedSlotListItemContent data-component={`${base}_missing_content_list_item-${index}`} icon={ClipboardX}
              iconContainerClassName="border border-amber-700/20 bg-amber-100 text-amber-700" title={titleFor(item)}
              subtitle={`${item.primaryEmployeeName} 관리사 · ${item.unwrittenThroughSessionIndex}회차 미작성`}
              status={<StatusBadge data-component={`${base}_missing_content_list_item-${index}_status_badge`} variant="danger">미작성</StatusBadge>} /> : null} />
            : <p data-component={`${base}_missing_content_empty`} data-slot="contract-document-jobs-empty" className="contract-document-jobs-empty">미작성 중인 서비스가 없습니다.</p>}
        </div>
      </div>
    </section>}
  </div>;
}
