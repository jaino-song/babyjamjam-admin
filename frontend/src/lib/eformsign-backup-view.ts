/** Frontend presentation model. This does not describe a backend API. */
export const CONTRACT_MILESTONES = [
  { id: 'created', label: '문서 생성' },
  { id: 'sent', label: '발송 완료' },
  { id: 'opened', label: '이용자 문서 열람' },
  { id: 'signed', label: '이용자 서명 완료' },
  { id: 'reviewed', label: '제공기관 검토 완료' },
  { id: 'completed', label: '계약서 완료' },
] as const;
export const RECORD_MILESTONES = [
  { id: 'created', label: '문서 생성' },
  { id: 'sent', label: '발송 완료' },
  { id: 'reviewed', label: '제공기관 검토 완료' },
  { id: 'completed', label: '제공기록지 완료' },
] as const;
export type ContractMilestone = typeof CONTRACT_MILESTONES[number]['id'];
export type RecordMilestone = typeof RECORD_MILESTONES[number]['id'];
export type DocumentKind = 'all' | 'contract' | 'record';
export type PeriodPreset = 'all' | '7' | '30' | 'custom';
export interface DocumentMilestoneScope {
  period: PeriodPreset;
  start: string;
  end: string;
  kind: DocumentKind;
  contractStages: ContractMilestone[];
  recordStages: RecordMilestone[];
}
export function defaultDocumentScope(): DocumentMilestoneScope {
  return { period: 'all', start: '', end: '', kind: 'all', contractStages: CONTRACT_MILESTONES.map(s => s.id), recordStages: RECORD_MILESTONES.map(s => s.id) };
}
export function cloneDocumentScope(scope: DocumentMilestoneScope): DocumentMilestoneScope {
  return { ...scope, contractStages: CONTRACT_MILESTONES.filter(s => scope.contractStages.includes(s.id)).map(s => s.id), recordStages: RECORD_MILESTONES.filter(s => scope.recordStages.includes(s.id)).map(s => s.id) };
}
export function kstToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function withPeriod(scope: DocumentMilestoneScope, period: PeriodPreset, today: string): DocumentMilestoneScope {
  const next = cloneDocumentScope(scope);
  if (!isCalendarDate(today)) throw new RangeError('Invalid calendar anchor');
  if (period === 'all') return { ...next, period, start: '', end: '' };
  if (period === 'custom') return { ...next, period };
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (Number(period) - 1));
  return { ...next, period, start: date.toISOString().slice(0, 10), end: today };
}
export function validateDocumentScope(scope: DocumentMilestoneScope): { period?: string; contractStages?: string; recordStages?: string } {
  const errors: ReturnType<typeof validateDocumentScope> = {};
  if (scope.period !== 'all') {
    if ([scope.start, scope.end].some(d => d && !isCalendarDate(d))) errors.period = '올바른 날짜를 입력하세요';
    else if (scope.start && scope.end && scope.start > scope.end) errors.period = '시작일을 종료일 이전으로 선택하세요';
  }
  const normalized = cloneDocumentScope(scope);
  if (scope.kind !== 'record' && !normalized.contractStages.length) errors.contractStages = '계약서 단계를 선택하세요';
  if (scope.kind !== 'contract' && !normalized.recordStages.length) errors.recordStages = '제공기록지 단계를 선택하세요';
  return errors;
}
/** Uses the current highest milestone, never cumulative events or raw status codes. */
export function matchesDocumentScope(scope: DocumentMilestoneScope, document: { kind: 'contract'; stage: ContractMilestone; createdDate: string } | { kind: 'record'; stage: RecordMilestone; createdDate: string }): boolean {
  if (Object.keys(validateDocumentScope(scope)).length || !isCalendarDate(document.createdDate)) return false;
  if (scope.kind !== 'all' && scope.kind !== document.kind) return false;
  if (scope.period !== 'all' && ((scope.start && document.createdDate < scope.start) || (scope.end && document.createdDate > scope.end))) return false;
  return document.kind === 'contract' ? scope.contractStages.includes(document.stage) : scope.recordStages.includes(document.stage);
}
export function documentScopeSummary(scope: DocumentMilestoneScope): string {
  const period = scope.period === 'all' ? '전체 기간' : `${scope.start || '처음'} ~ ${scope.end || '현재'}`;
  const kind = scope.kind === 'all' ? '전체 종류' : scope.kind === 'contract' ? '계약서' : '제공기록지';
  const groups = [
    ...(scope.kind !== 'record' ? [{ name: '계약서', stages: CONTRACT_MILESTONES, selected: scope.contractStages }] : []),
    ...(scope.kind !== 'contract' ? [{ name: '제공기록지', stages: RECORD_MILESTONES, selected: scope.recordStages }] : []),
  ];
  const stages = groups.every(g => g.stages.every(s => g.selected.some(id => id === s.id))) ? '전체 단계' : groups.map(g => `${g.name} ${g.stages.filter(s => g.selected.some(id => id === s.id)).map(s => s.label).join(', ') || '선택 없음'}`).join(' · ');
  return `${period} · ${kind} · ${stages}`;
}
export type BackupRunState = 'running' | 'partial' | 'blocked' | 'failed' | 'unverified';
export const BACKUP_RUN_LABELS: Record<BackupRunState, string> = { running: '진행 중', partial: '확인 필요', blocked: '중단', failed: '실패', unverified: '검증 전' };
export interface BackupDestinationResult {
  readonly state: 'stored' | 'partial' | 'failed' | 'unverified' | 'excluded';
  readonly saved?: number;
  readonly location?: string;
}
export interface BackupRunView {
  readonly id: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly trigger: 'manual' | 'scheduled';
  readonly state: BackupRunState;
  readonly counts: { readonly target: number; readonly saved: number; readonly attention: number };
  readonly local: BackupDestinationResult;
  readonly drive: BackupDestinationResult;
  readonly missingDocuments: readonly { readonly id: string; readonly title: string; readonly reason: string }[];
  readonly timeline: readonly { readonly id: string; readonly at: string; readonly text: string; readonly tone: 'info' | 'warning' | 'danger' | 'success' }[];
}
export type BackupViewSource =
  | { readonly state: 'unavailable' }
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | { readonly state: 'ready'; readonly runs: readonly BackupRunView[]; readonly capabilities?: { readonly requestRun?: boolean; readonly download?: boolean } };
export function runNeedsAttention(run: BackupRunView): boolean {
  return run.counts.attention > 0 || ['partial', 'blocked', 'failed'].includes(run.state);
}
