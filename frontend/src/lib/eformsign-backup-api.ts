import { z } from 'zod';
import { CONTRACT_MILESTONES, RECORD_MILESTONES, isCalendarDate } from '@/lib/eformsign-backup-view';

export const backupUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const time = z.iso.datetime({ precision: 3 }).refine(s => Number.isFinite(Date.parse(s)));
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const contractStage = z.enum(['created', 'sent', 'opened', 'signed', 'reviewed', 'completed']);
const recordStage = z.enum(['created', 'sent', 'reviewed', 'completed']);
const date = z.string().refine(s => s === '' || isCalendarDate(s));
export const backupScopeSchema = z.strictObject({
  period: z.enum(['all', '7', '30', 'custom']), start: date, end: date,
  kind: z.enum(['all', 'contract', 'record']),
  contractStages: z.array(contractStage).max(32), recordStages: z.array(recordStage).max(32),
}).superRefine((s, ctx) => {
  if ((s.kind !== 'record' && !s.contractStages.length) || (s.kind !== 'contract' && !s.recordStages.length)
    || (s.start && s.end && s.start > s.end) || (s.period === 'all' && (s.start || s.end))) {
    ctx.addIssue({ code: 'custom', message: 'INVALID_REQUEST' });
  }
  if (s.period === '7' || s.period === '30') {
    const days = (Date.parse(s.end) - Date.parse(s.start)) / 86_400_000 + 1;
    if (!s.start || !s.end || days !== Number(s.period)) ctx.addIssue({ code: 'custom', message: 'INVALID_REQUEST' });
  }
}).transform(s => ({ ...s, contractStages: CONTRACT_MILESTONES.filter(m => s.contractStages.includes(m.id)).map(m => m.id),
  recordStages: RECORD_MILESTONES.filter(m => s.recordStages.includes(m.id)).map(m => m.id) }));
const destination = z.object({ state: z.enum(['excluded', 'stored', 'partial', 'failed', 'unverified']), saved: count });
export const backupRunSchema = z.object({
  id: backupUuidSchema, status: z.enum(['queued', 'running', 'partial', 'blocked', 'failed', 'unverified']),
  scope: backupScopeSchema.nullable(), cut: time, createdAt: time, startedAt: time.nullable(), finishedAt: time.nullable(),
  summary: z.object({ target: count, saved: count, attention: count, metadataOnly: count, local: destination, drive: destination })
    .refine(s => [s.saved, s.attention, s.metadataOnly, s.local.saved, s.drive.saved].every(n => n <= s.target)),
  coverage: z.literal('unverified'), backupComplete: z.literal(false),
  failureCode: z.enum(['WORKER_LEASE_EXPIRED', 'INVALID_SERVER_SELECTION']).nullable(),
});
const observation = z.enum(['verified', 'partial', 'blocked', 'unverified', 'metadata_only', 'not_required']);
export const backupDocumentSchema = z.object({
  documentId: z.string().regex(/^[^\u0000-\u001f\u007f]{1,512}$/u), ordinal: count.refine(n => n > 0), kind: z.enum(['contract', 'record']),
  currentMilestone: contractStage.nullable(), documentCreatedAt: time,
  classification: z.enum(['excluded_by_policy', 'policy_pending', 'unknown_template', 'inaccessible', 'included']).nullable(),
  local: observation, drive: observation,
}).refine(d => d.kind === 'contract' || d.currentMilestone === null || recordStage.safeParse(d.currentMilestone).success);
const cursor = z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/);
export const backupRunsSchema = z.object({ items: z.array(backupRunSchema).max(100), nextCursor: cursor.nullable() });
export const backupDocumentsSchema = z.object({ items: z.array(backupDocumentSchema).max(100), nextCursor: cursor.nullable() });
export type BackupRun = z.infer<typeof backupRunSchema>;
export type BackupDocument = z.infer<typeof backupDocumentSchema>;
export type BackupRuns = z.infer<typeof backupRunsSchema>;
export type BackupDocuments = z.infer<typeof backupDocumentsSchema>;
export const backupRequestSchema = z.strictObject({ scope: backupScopeSchema, requestKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/) });
export type BackupRequest = z.infer<typeof backupRequestSchema>;

export class BackupApiError extends Error {
  constructor(readonly code: string = 'SERVICE_UNAVAILABLE', readonly status = 503) { super('백업 요청을 처리하지 못했습니다'); }
}
const ERROR_CODES = ['INVALID_REQUEST', 'EMPTY_SELECTION', 'NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN', 'IDEMPOTENCY_CONFLICT', 'RUN_ACTIVE',
  'SOURCE_CHANGED', 'LEASE_LOST', 'DOCUMENT_RESULTS_PENDING', 'INVALID_REPORT', 'SERVICE_UNAVAILABLE'] as const;
export function safeBackupError(error: unknown): BackupApiError {
  const e = error as { response?: { status?: unknown; data?: { code?: unknown } } } | null;
  const status = typeof e?.response?.status === 'number' ? e.response.status : 503;
  const known = ERROR_CODES.find(code => code === e?.response?.data?.code);
  return new BackupApiError(status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : known ?? 'SERVICE_UNAVAILABLE', status);
}
export function backupErrorMessage(error: unknown): string {
  if (error instanceof BackupApiError && error.code === 'EMPTY_SELECTION') return '선택한 조건에 해당하는 문서가 없습니다';
  if (error instanceof BackupApiError && error.code === 'RUN_ACTIVE') return '이미 실행 중인 백업이 있습니다';
  return '백업을 요청하지 못했습니다';
}
export function backupIsTerminal(run: BackupRun): boolean { return run.status !== 'queued' && run.status !== 'running'; }
export function backupPageQuery(params: URLSearchParams, documents = false, runId?: string): { cursor?: string; limit?: number } {
  const keys = [...params.keys()];
  if (keys.some(k => !['cursor', 'limit'].includes(k) || params.getAll(k).length !== 1)) throw new BackupApiError('INVALID_REQUEST', 400);
  const result: { cursor?: string; limit?: number } = {};
  if (params.has('limit')) {
    const raw = params.get('limit') ?? '';
    if (!/^[1-9][0-9]*$/.test(raw) || Number(raw) > 100) throw new BackupApiError('INVALID_REQUEST', 400);
    result.limit = Number(raw);
  }
  if (params.has('cursor')) {
    const raw = cursor.safeParse(params.get('cursor'));
    if (!raw.success) throw new BackupApiError('INVALID_REQUEST', 400);
    try {
      const decoded = atob(raw.data.replace(/-/g, '+').replace(/_/g, '/'));
      const canonical = btoa(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (canonical !== raw.data) throw new Error();
      const value: unknown = JSON.parse(decoded);
      const parsed = documents
        ? z.strictObject({ runId: backupUuidSchema, afterOrdinal: count }).safeParse(value)
        : z.strictObject({ id: backupUuidSchema, createdAt: time }).safeParse(value);
      if (!parsed.success || (documents && (parsed.data as { runId: string }).runId !== runId)) throw new Error();
    } catch { throw new BackupApiError('INVALID_REQUEST', 400); }
    result.cursor = raw.data;
  }
  return result;
}
