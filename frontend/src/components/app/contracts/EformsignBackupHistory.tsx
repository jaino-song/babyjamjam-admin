"use client";

import { useState } from "react";
import { formatDateTimeKo } from "@babyjamjam/shared/utils/date";
import { EmptyState, ListPanel } from "@/components/app/v3";
import { DataTable, type DataTableColumn } from "@/components/app/ui/datatable";
import { StatusPill } from "@/components/app/ui/status-badge";
import { QueryErrorState } from "@/components/app/ui/QueryErrorState";
import {
  useEformsignBackupRuns,
  type EformsignBackupRun,
} from "@/hooks/useEformsignBackupRuns";

const ROOT = "desktop_contracts_sections_section-content_backups-section";
const STATUS = {
  success: { label: "성공", variant: "success" },
  partial: { label: "부분 실패", variant: "warning" },
  failed: { label: "실패", variant: "danger" },
} as const;
const DRIVE = { ok: "완료", failed: "실패", skipped: "안 함" } as const;
const COLUMNS: DataTableColumn<EformsignBackupRun>[] = [
  { key: "startedAt", header: "시작 시각", render: (run) => formatDateTimeKo(run.startedAt) },
  {
    key: "status",
    header: "상태",
    render: (run) => (
      <div data-slot="run-status" className="flex flex-wrap items-center justify-center gap-2">
        <StatusPill
          data-component={`${ROOT}_table_row_status`}
          variant={STATUS[run.status].variant}
        >
          {STATUS[run.status].label}
        </StatusPill>
        {run.limited ? (
          <StatusPill data-component={`${ROOT}_table_row_limited`} variant="neutral">
            제한 실행
          </StatusPill>
        ) : null}
      </div>
    ),
  },
  { key: "totalDocs", header: "문서 수" },
  {
    key: "files",
    header: "저장 / 건너뜀 / 실패",
    render: (run) => `${run.savedFiles} / ${run.skippedFiles} / ${run.failedFiles}`,
  },
  { key: "driveStatus", header: "Drive", render: (run) => DRIVE[run.driveStatus] },
];

export function EformsignBackupHistory() {
  const { data, isLoading, isError, refetch } = useEformsignBackupRuns();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const items = data?.items ?? [];
  // The API returns runs newest first; limited runs never count as a full backup.
  const lastSuccess = items.find((run) => run.status === "success" && run.limited === false);
  // Freshness is evaluated against the current time whenever the history renders.
  // eslint-disable-next-line react-hooks/purity -- a clock comparison only changes the read-only warning
  const isOverdue = !lastSuccess || Date.now() - Date.parse(lastSuccess.startedAt) > 26 * 60 * 60 * 1000;
  const selectedRun = items.find((run) => run.id === selectedRunId);

  return (
    <ListPanel data-component={ROOT} title="전자문서 백업" isLoading={isLoading}>
      {isError ? (
        <QueryErrorState dataComponent={`${ROOT}_error`} onRetry={() => void refetch()} />
      ) : (
        <>
          {!isLoading ? (
            <div data-component={`${ROOT}_summary`} data-slot="backup-summary" className="mb-4 space-y-2">
              <p data-component={`${ROOT}_summary_last-success`} data-slot="last-success">
                마지막 성공: {lastSuccess ? formatDateTimeKo(lastSuccess.startedAt) : "없음"}
              </p>
              {isOverdue ? (
                <p
                  data-component={`${ROOT}_summary_warning`}
                  data-slot="backup-warning"
                  role="status"
                  className="text-v3-burgundy"
                >
                  최근 26시간 안에 성공한 백업이 없습니다
                </p>
              ) : null}
            </div>
          ) : null}
          {!isLoading && items.length === 0 ? (
            <EmptyState message="아직 백업 기록이 없습니다" />
          ) : (
            <DataTable
              data-component={`${ROOT}_table`}
              data={items}
              columns={COLUMNS}
              getRowKey={(run) => run.id}
              isLoading={isLoading}
              searchEnabled={false}
              hideToolbar
              pagination="none"
              onRowClick={(run) => setSelectedRunId((current) => current === run.id ? null : run.id)}
            />
          )}
          {!isLoading && selectedRun ? (
            <div
              data-component={`${ROOT}_failures`}
              data-slot="backup-failures"
              className="mt-4 space-y-2 break-words"
              aria-live="polite"
            >
              <p data-component={`${ROOT}_failures_title`} data-slot="failures-title">
                {formatDateTimeKo(selectedRun.startedAt)} 실패 내역
              </p>
              {selectedRun.failures.map((failure, index) => (
                <p key={`${failure.docId}-${index}`} data-component={`${ROOT}_failures_item`} data-slot="failure-item">
                  {failure.docId} — {failure.reason}
                </p>
              ))}
              {selectedRun.failedFiles > selectedRun.failures.length ? (
                <p data-component={`${ROOT}_failures_remaining`} data-slot="remaining-failures">
                  외 {selectedRun.failedFiles - selectedRun.failures.length}건
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </ListPanel>
  );
}
