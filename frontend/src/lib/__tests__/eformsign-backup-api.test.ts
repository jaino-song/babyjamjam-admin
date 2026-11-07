import { backupRunSchema, backupDocumentSchema, backupPageQuery, backupScopeSchema, safeBackupError, backupErrorMessage, BackupApiError } from '../eformsign-backup-api';
import { defaultDocumentScope } from '../eformsign-backup-view';
const id = '20000000-0000-4000-8000-000000000001';
const time = '2026-11-05T00:00:00.000Z';
const run = { id, status: 'queued', scope: defaultDocumentScope(), cut: time, createdAt: time, startedAt: null, finishedAt: null,
  summary: { target: 121, saved: 0, attention: 0, metadataOnly: 0, local: { state: 'unverified', saved: 0 }, drive: { state: 'excluded', saved: 0 } },
  coverage: 'unverified', backupComplete: false, failureCode: null };
describe('closed public backup transport', () => {
  it('projects only public fields, including nested results', () => {
    const result = backupRunSchema.parse({ ...run, companyId: 'private', leaseToken: 'private', summary: { ...run.summary, local: { ...run.summary.local, path: 'private' } } });
    expect(result).toEqual(run);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it.each([{ id: 'bad' }, { status: 'completed' }, { backupComplete: true }, { createdAt: 'invalid' },
    { summary: { ...run.summary, saved: -1 } }, { summary: { ...run.summary, target: Number.MAX_SAFE_INTEGER + 1 } },
    { summary: { ...run.summary, saved: 122 } }])('refuses unsafe public values %j', invalid => {
    expect(backupRunSchema.safeParse({ ...run, ...invalid }).success).toBe(false);
  });
  it('accepts nullable baseline observations without promoting milestones or aggregate states', () => {
    const document = { documentId: 'opaque-provider-document', ordinal: 1, kind: 'contract', currentMilestone: null, documentCreatedAt: time,
      classification: null, local: 'metadata_only', drive: 'not_required' };
    expect(backupDocumentSchema.parse({ ...document, artifacts: ['private'] })).toEqual(document);
    expect(backupDocumentSchema.safeParse({ ...document, local: { state: 'verified' } }).success).toBe(false);
    expect(backupDocumentSchema.safeParse({ ...document, local: 'stored' }).success).toBe(false);
    expect(backupDocumentSchema.safeParse({ ...document, kind: 'record', currentMilestone: 'opened' }).success).toBe(false);
  });
  it('validates exact query/cursor shape without forwarding authority', () => {
    const cursor = btoa(JSON.stringify({ id, createdAt: time })).replace(/=+$/, '');
    expect(backupPageQuery(new URLSearchParams({ cursor, limit: '100' }))).toEqual({ cursor, limit: 100 });
    for (const query of ['limit=101', 'limit=0', 'limit=01', 'limit=1&limit=2', 'branchId=private', 'cursor=bad']) {
      expect(() => backupPageQuery(new URLSearchParams(query))).toThrow(BackupApiError);
    }
    const docCursor = btoa(JSON.stringify({ runId: id, afterOrdinal: 100 })).replace(/=+$/, '');
    expect(backupPageQuery(new URLSearchParams({ cursor: docCursor }), true, id)).toEqual({ cursor: docCursor });
    expect(() => backupPageQuery(new URLSearchParams({ cursor: docCursor }), true, id.replace(/1$/, '2'))).toThrow(BackupApiError);
  });
  it('preserves 6/4 milestones and excludes unknown scope authority', () => {
    const scope = backupScopeSchema.parse(defaultDocumentScope());
    expect(scope.contractStages).toEqual(['created', 'sent', 'opened', 'signed', 'reviewed', 'completed']);
    expect(scope.recordStages).toEqual(['created', 'sent', 'reviewed', 'completed']);
    expect(backupScopeSchema.safeParse({ ...scope, branchId: id }).success).toBe(false);
    expect(backupScopeSchema.safeParse({ ...scope, period: 'custom', start: '2026-11-06', end: '2026-11-05' }).success).toBe(false);
  });
  it('maps known errors and never reflects upstream messages', () => {
    expect(backupErrorMessage(safeBackupError({ response: { status: 400, data: { code: 'EMPTY_SELECTION', message: 'private' } } }))).toBe('선택한 조건에 해당하는 문서가 없습니다');
    expect(backupErrorMessage(safeBackupError({ response: { status: 409, data: { code: 'RUN_ACTIVE' } } }))).toBe('이미 실행 중인 백업이 있습니다');
    const unknown = safeBackupError({ response: { status: 500, data: { code: 'private', message: 'private' } } });
    expect(backupErrorMessage(unknown)).toBe('백업을 요청하지 못했습니다'); expect(unknown.message).not.toContain('private');
  });
});
