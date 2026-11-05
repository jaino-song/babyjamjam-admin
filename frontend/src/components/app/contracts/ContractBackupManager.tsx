"use client";

import { useRef, useState } from 'react';
import { Archive, AlertTriangle, Clock, Download, FileText, Filter, Play, Save } from 'lucide-react';
import {
  ActivityTimeline, AnimatedSlotList, AnimatedSlotListItemContent, DetailEmptyState,
  DetailPanel, InfoCard, InfoRow, ListEmptyState, ListPanel, SplitLayout, StatMini,
  useSplitLayoutSelection,
} from '@/components/app/v3';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/app/ui/status-badge';
import { FormHelperText } from '@/components/app/ui/form-section';
import {
  DocumentMilestoneFilterDialog, DocumentMilestoneScopeSummary,
} from '@/components/app/ui/DocumentMilestoneFilterDialog';
import {
  BACKUP_RUN_LABELS, cloneDocumentScope, defaultDocumentScope, runNeedsAttention,
  type BackupDestinationResult, type BackupViewSource, type DocumentMilestoneScope,
} from '@/lib/eformsign-backup-view';

export interface ContractBackupManagerProps {
  dataComponent: string;
  source?: BackupViewSource;
  onRequestRun?: (scope: DocumentMilestoneScope) => void | Promise<void>;
  onDownload?: (runId: string) => void | Promise<void>;
}

const UNAVAILABLE: BackupViewSource = { state: 'unavailable' };
const HISTORY_TABS = [{ label: '전체', value: 'all' }, { label: '확인 필요', value: 'attention' }];
const DESTINATION_LABELS = {
  stored: '저장됨', partial: '확인 필요', failed: '실패', unverified: '검증 전', excluded: '대상 제외',
} as const;

function displayTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '시간 확인 전';
  return `${new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)} KST`;
}

function destinationText(result: BackupDestinationResult): string {
  return [
    DESTINATION_LABELS[result.state],
    result.saved === undefined ? undefined : `${result.saved}건`,
    result.location,
  ].filter(Boolean).join(' · ');
}

export function ContractBackupManager({
  dataComponent, source = UNAVAILABLE, onRequestRun, onDownload,
}: ContractBackupManagerProps) {
  const [scope, setScope] = useState(defaultDocumentScope);
  const [filterOpen, setFilterOpen] = useState(false);
  const [tab, setTab] = useState('all');
  const [pending, setPending] = useState<'run' | 'download' | null>(null);
  const pendingRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const runs = source.state === 'ready' ? source.runs : [];
  // Document scope applies to a future request. It never filters recorded runs.
  const visible = tab === 'attention' ? runs.filter(runNeedsAttention) : runs;
  const { selectedId, setSelectedId, setSplitLayoutMode } = useSplitLayoutSelection(visible.map(run => run.id));
  const selected = visible.find(run => run.id === selectedId);
  const split = `${dataComponent}_split-layout`;
  const list = `${split}_track_panel_list-panel`;
  const detail = `${split}_track_panel_detail-panel${selected ? '' : '-empty'}`;
  const body = `${detail}_main_scroll-content`;
  const canRun = source.state === 'ready' && source.capabilities?.requestRun === true && Boolean(onRequestRun);
  const canDownload = source.state === 'ready' && source.capabilities?.download === true && Boolean(onDownload) && Boolean(selected);

  const act = async (kind: 'run' | 'download') => {
    if (pendingRef.current || (kind === 'run' ? !canRun : !canDownload)) return;
    pendingRef.current = true;
    setPending(kind);
    setActionError(null);
    try {
      if (kind === 'run') await onRequestRun?.(cloneDocumentScope(scope));
      else if (selected) await onDownload?.(selected.id);
    } catch {
      setActionError(kind === 'run' ? '백업을 요청하지 못했습니다' : '결과를 내려받지 못했습니다');
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  };
  const stateMessage = source.state === 'unavailable' ? '백업 연결 전'
    : source.state === 'loading' ? '이력 불러오는 중'
    : source.state === 'error' ? '이력을 불러오지 못했습니다' : '이력이 없습니다';

  return (
    <section data-component={dataComponent} data-slot="contract-backup-manager" className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <SplitLayout
        data-component={split} hasSelection={Boolean(selected)}
        onBack={() => setSelectedId(null)} onModeChange={setSplitLayoutMode}
      >
        <ListPanel
          data-component={list} title="백업 실행 이력" headerPadding="compact"
          tabs={HISTORY_TABS} tabsAriaLabel="실행 이력 구분" activeTab={tab}
          onTabChange={next => {
            setTab(next);
            const nextRuns = next === 'attention' ? runs.filter(runNeedsAttention) : runs;
            if (selectedId && !nextRuns.some(run => run.id === selectedId)) setSelectedId(nextRuns[0]?.id ?? null);
          }}
          headerActions={(
            <div className="flex items-center gap-[calc(6px*var(--glint-ui-scale,1))]">
              <Button
                data-component={`${list}_top-area_header_actions_filter`}
                type="button" variant="ghost" size="icon"
                className="h-[calc(32px*var(--glint-ui-scale,1))] w-[calc(32px*var(--glint-ui-scale,1))]"
                aria-label="문서 필터" aria-haspopup="dialog" aria-expanded={filterOpen}
                onClick={() => setFilterOpen(true)}
              >
                <Filter aria-hidden="true" />
              </Button>
              <Button
                data-component={`${list}_top-area_header_actions_run`}
                type="button" size="sm" disabled={!canRun || pending !== null}
                onClick={() => void act('run')}
              >
                <Play aria-hidden="true" />{pending === 'run' ? '요청 중' : '백업 실행'}
              </Button>
            </div>
          )}
          emptyState={source.state !== 'loading' && visible.length === 0 ? (
            <ListEmptyState data-component={`${list}_overlay_empty`} icon={Archive} message={stateMessage} />
          ) : undefined}
          subHeader={(
            <div className="flex min-w-0 flex-col gap-[calc(8px*var(--glint-ui-scale,1))]">
              {source.state !== 'ready' ? (
                <div>
                  <StatusBadge data-component={`${list}_top-area_sub-header_connection`} variant="neutral">
                    {source.state === 'unavailable' ? '연결 전' : source.state === 'loading' ? '불러오는 중' : '확인 필요'}
                  </StatusBadge>
                </div>
              ) : null}
              <DocumentMilestoneScopeSummary dataComponent={`${list}_top-area_sub-header_scope`} scope={scope} />
              {actionError ? (
                <FormHelperText data-component={`${list}_top-area_sub-header_action-error`} tone="error" role="alert">
                  {actionError}
                </FormHelperText>
              ) : null}
            </div>
          )}
        >
          <AnimatedSlotList
            data-component={`${list}_content_runs`} itemDataComponent={`${list}_content_runs_item`}
            items={source.state === 'loading' ? undefined : visible}
            isLoading={source.state === 'loading'} loadingCount={1}
            getItemKey={run => run.id} onSlotClick={run => setSelectedId(run.id)}
            getSlotState={({ item, isLoading }) => ({
              isActive: !isLoading && item?.id === selected?.id,
              isInteractive: !isLoading && Boolean(item),
            })}
            render={({ item, index }) => {
              if (!item) return null;
              const row = `${list}_content_runs_item_run-${index}`;
              return (
                <AnimatedSlotListItemContent
                  data-component={row} icon={Archive} title={displayTime(item.startedAt)}
                  subtitle={item.trigger === 'manual' ? '수동 실행' : '예약 실행'}
                  meta={`대상 ${item.counts.target}건 · 저장 ${item.counts.saved}건 · 확인 필요 ${item.counts.attention}건`}
                  status={(
                    <StatusBadge data-component={`${row}_status_badge`} variant={runNeedsAttention(item) ? 'warning' : 'neutral'}>
                      {BACKUP_RUN_LABELS[item.state]}
                    </StatusBadge>
                  )}
                />
              );
            }}
          />
        </ListPanel>
        <DetailPanel
          data-component={detail} title={selected ? '백업 결과' : undefined}
          subtitle={selected ? `${displayTime(selected.startedAt)} · ${selected.trigger === 'manual' ? '수동 실행' : '예약 실행'}` : undefined}
          badges={selected ? (
            <StatusBadge data-component={`${detail}_header_title-group_title-row_state`} variant={runNeedsAttention(selected) ? 'warning' : 'neutral'}>
              {BACKUP_RUN_LABELS[selected.state]}
            </StatusBadge>
          ) : undefined}
          overlay={!selected ? (
            <DetailEmptyState
              data-component={`${detail}_overlay_empty`} icon={Archive}
              message={source.state === 'ready' ? '왼쪽 목록에서 실행 이력을 선택하세요' : stateMessage}
            />
          ) : undefined}
          footer={(
            <Button
              data-component={`${detail}_footer_download`} type="button" variant="outline" size="sm"
              disabled={!canDownload || pending !== null} onClick={() => void act('download')}
            >
              <Download aria-hidden="true" />{pending === 'download' ? '내려받는 중' : '결과 내려받기'}
            </Button>
          )}
        >
          {selected ? (
            <div className="flex min-w-0 flex-col gap-[calc(20px*var(--glint-ui-scale,1))]">
              <div data-component={`${body}_metrics`} className="grid grid-cols-1 gap-[calc(12px*var(--glint-ui-scale,1))] sm:grid-cols-3">
                <StatMini data-component={`${body}_metrics_target`} icon={FileText} label="대상" value={selected.counts.target} counter="건" />
                <StatMini data-component={`${body}_metrics_saved`} icon={Save} label="저장" value={selected.counts.saved} counter="건" />
                <StatMini data-component={`${body}_metrics_attention`} icon={AlertTriangle} label="확인 필요" value={selected.counts.attention} counter="건" />
              </div>
              <InfoCard data-component={`${body}_storage`} title="저장 위치별 결과">
                <InfoRow data-component={`${body}_storage_body_local`} label="로컬 보관함" value={destinationText(selected.local)} />
                <InfoRow data-component={`${body}_storage_body_drive`} label="Google Drive" value={destinationText(selected.drive)} />
                <InfoRow data-component={`${body}_storage_body_finished`} label="종료 시각" value={selected.finishedAt ? displayTime(selected.finishedAt) : '확인 전'} />
              </InfoCard>
              {selected.missingDocuments.length ? (
                <InfoCard data-component={`${body}_attention`} title="확인 필요한 문서">
                  {selected.missingDocuments.map((document, index) => (
                    <InfoRow key={document.id} data-component={`${body}_attention_body_document-${index}`} label={document.title} value={document.reason} />
                  ))}
                </InfoCard>
              ) : null}
              {selected.timeline.length ? (
                <InfoCard data-component={`${body}_timeline`} title="처리 내역">
                  <ActivityTimeline
                    data-component={`${body}_timeline_body_events`}
                    items={selected.timeline.map(event => ({ icon: Clock, iconVariant: event.tone, text: event.text, time: displayTime(event.at) }))}
                  />
                </InfoCard>
              ) : null}
            </div>
          ) : null}
        </DetailPanel>
      </SplitLayout>
      <DocumentMilestoneFilterDialog
        dataComponent={`${dataComponent}_filter-dialog`} open={filterOpen}
        onOpenChange={setFilterOpen} scope={scope} onApply={setScope}
      />
    </section>
  );
}
