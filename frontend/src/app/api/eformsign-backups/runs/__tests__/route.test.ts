/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { GET as getRun } from '../[runId]/route';
import { GET as getDocuments } from '../[runId]/documents/route';
import { serverAPIClient } from '@/lib/api/server';
import { defaultDocumentScope } from '@/lib/eformsign-backup-view';
jest.mock('@/lib/api/server', () => ({ serverAPIClient: { get: jest.fn(), post: jest.fn() } }));
const get = jest.mocked(serverAPIClient.get); const post = jest.mocked(serverAPIClient.post);
const id = '20000000-0000-4000-8000-000000000001';
const time = '2026-11-05T00:00:00.000Z';
const run = { id, status: 'queued', scope: defaultDocumentScope(), cut: time, createdAt: time, startedAt: null, finishedAt: null,
  summary: { target: 0, saved: 0, attention: 0, metadataOnly: 0, local: { state: 'unverified', saved: 0 }, drive: { state: 'excluded', saved: 0 } },
  coverage: 'unverified', backupComplete: false, failureCode: null };
const req = (suffix = '', body?: unknown, auth = true) => new NextRequest('http://localhost/api/eformsign-backups/runs' + suffix,
  { method: body === undefined ? 'GET' : 'POST', headers: auth ? { cookie: 'auth_token=synthetic', 'Content-Type': 'application/json' } : {},
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
const ctx = (runId = id) => ({ params: Promise.resolve({ runId }) });
beforeEach(() => { jest.clearAllMocks(); });
describe('backup BFF boundaries', () => {
  it('requires app authentication', async () => { expect((await GET(req('', undefined, false))).status).toBe(401); expect(get).not.toHaveBeenCalled(); });
  it('forwards only allowed paging fields and strips private response fields', async () => {
    get.mockResolvedValueOnce({ status: 200, data: { items: [{ ...run, leaseToken: 'private' }], nextCursor: null, companyId: 'private' } });
    const response = await GET(req('?limit=100'));
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual({ items: [run], nextCursor: null });
    expect(get).toHaveBeenCalledWith('/eformsign-backups/runs', { headers: expect.objectContaining({ Authorization: 'Bearer synthetic' }), params: { limit: 100 } });
  });
  it.each(['?limit=101', '?limit=1&limit=2', '?companyId=private', '?cursor=bad'])('rejects %s before transport', async suffix => {
    expect((await GET(req(suffix))).status).toBe(400); expect(get).not.toHaveBeenCalled();
  });
  it('uses strict UUID paths and rejects extra detail queries', async () => {
    expect((await getRun(req(), ctx('bad'))).status).toBe(400);
    expect((await getRun(req('?branchId=' + id), ctx())).status).toBe(400);
    expect((await getDocuments(req('?limit=101'), ctx())).status).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON and unknown create authority', async () => {
    expect((await POST(req('', '{'))).status).toBe(400);
    expect((await POST(req('', { scope: defaultDocumentScope(), requestKey: 'test', branchId: id }))).status).toBe(400);
    expect(post).not.toHaveBeenCalled();
  });
  it('preserves accepted status and known safe error codes', async () => {
    post.mockResolvedValueOnce({ status: 202, data: run });
    expect((await POST(req('', { scope: defaultDocumentScope(), requestKey: 'test' }))).status).toBe(202);
    post.mockRejectedValueOnce({ response: { status: 409, data: { code: 'RUN_ACTIVE', message: 'private' } } });
    const response = await POST(req('', { scope: defaultDocumentScope(), requestKey: 'test' }));
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ code: 'RUN_ACTIVE' });
  });
});
