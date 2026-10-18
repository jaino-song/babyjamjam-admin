"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileCheck2 } from "lucide-react";

import { InfoCard } from "@/components/app/mobile-redesign/detail-sheet";
import { QueryErrorState } from "@/components/app/ui/QueryErrorState";
import { Button } from "@/components/ui/button";
import { eformsignApi, type EformsignLinkConfirmation } from "@/services/api";
import { ContractLinkConfirmSheet } from "../clients/contract-link-confirm-sheet";

/** Rows shown before the "N건 더 보기" toggle once the notice is expanded. */
const COLLAPSED_ROW_LIMIT = 5;

interface ContractLinkConfirmationsNoticeProps {
  "data-component": string;
  /** Branch the entries belong to. Part of the query key so a branch switch never shows another branch's entries. */
  branchId: string | null | undefined;
}

function differenceText(entry: EformsignLinkConfirmation): string {
  return entry.differences.map(field => (field === "name" ? "이름이 다릅니다" : "생년월일이 다릅니다")).join(" · ");
}

/**
 * Rule 계약-05: a contract whose phone matches exactly one client but whose name or birthday differs is left
 * unlinked ("연결 확인 필요"). It has no client, so it is not in the contracts list; this notice is the list's
 * entry point to those documents. It owns its query and the confirm sheet.
 */
export function ContractLinkConfirmationsNotice({ "data-component": dataComponent, branchId }: ContractLinkConfirmationsNoticeProps) {
  const query = useQuery({
    queryKey: ["eformsign-docs", "link-confirmations", "all", branchId ?? null],
    queryFn: () => eformsignApi.getLinkConfirmations(),
    enabled: Boolean(branchId),
  });
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<EformsignLinkConfirmation | null>(null);

  const entries = query.data ?? [];
  // A failed load is never shown as "none": the error state stands even when the cached list is empty.
  const showNotice = query.isError || entries.length > 0;
  const visibleEntries = showAll ? entries : entries.slice(0, COLLAPSED_ROW_LIMIT);
  const hiddenCount = entries.length - visibleEntries.length;

  return (
    <>
      {showNotice ? (
        <div data-component={dataComponent} data-slot="link-confirmations" className="flex shrink-0 flex-col gap-2">
          {query.isError ? (
            <QueryErrorState
              dataComponent={`${dataComponent}_error`}
              size="inline"
              title={query.data === undefined ? "연결 확인이 필요한 계약서를 불러오지 못했습니다" : "최신 정보를 불러오지 못했습니다"}
              isRetrying={query.isFetching}
              onRetry={() => { void query.refetch(); }}
            />
          ) : null}
          {entries.length > 0 ? (
            <InfoCard data-component={`${dataComponent}_card`} title={`연결 확인이 필요한 계약서 ${entries.length}건`}>
              <Button
                size="sm"
                variant="v3-outline"
                aria-expanded={expanded}
                data-component={`${dataComponent}_card_toggle`}
                data-slot="toggle"
                onClick={() => setExpanded(current => !current)}
              >
                {expanded ? "접기" : "보기"}
              </Button>
              {expanded ? (
                <div data-component={`${dataComponent}_card_list`} data-slot="list" className="max-h-[40vh] overflow-y-auto">
                  {visibleEntries.map((entry, index) => (
                    <div
                      key={entry.documentId}
                      className="doc-row"
                      data-component={`${dataComponent}_card_list_doc-${index}`}
                      data-slot="doc-row"
                    >
                      <div className="doc-icon doc-icon-orange" data-component={`${dataComponent}_card_list_doc-${index}_icon`} data-slot="doc-icon">
                        <FileCheck2 size={16} strokeWidth={2.5} />
                      </div>
                      <div className="doc-info" data-component={`${dataComponent}_card_list_doc-${index}_info`} data-slot="doc-info">
                        <div className="doc-title" data-component={`${dataComponent}_card_list_doc-${index}_info_title`} data-slot="doc-title">
                          {entry.documentName || "계약서"}
                        </div>
                        <div className="doc-meta" data-component={`${dataComponent}_card_list_doc-${index}_info_meta`} data-slot="doc-meta">
                          <span>{entry.client.name}</span>
                          <span>{differenceText(entry)}</span>
                          {entry.canConfirm ? (
                            <Button
                              size="sm"
                              variant="v3-outline"
                              data-component={`${dataComponent}_card_list_doc-${index}_info_meta_confirm`}
                              onClick={() => setSelected(entry)}
                            >
                              확인
                            </Button>
                          ) : (
                            <span>지점 관리자만 연결을 확정할 수 있습니다</span>
                          )}
                        </div>
                      </div>
                      <span className="badge-mini orange" data-slot="doc-badge">연결 확인 필요</span>
                    </div>
                  ))}
                  {hiddenCount > 0 ? (
                    <Button
                      size="sm"
                      variant="v3-outline"
                      data-component={`${dataComponent}_card_list_more`}
                      data-slot="show-more"
                      onClick={() => setShowAll(true)}
                    >
                      {hiddenCount}건 더 보기
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </InfoCard>
          ) : null}
        </div>
      ) : null}
      {selected ? (
        <ContractLinkConfirmSheet
          key={selected.documentId}
          data-component={`${dataComponent}_sheet`}
          entry={selected}
          refetchConfirmations={query.refetch}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}
