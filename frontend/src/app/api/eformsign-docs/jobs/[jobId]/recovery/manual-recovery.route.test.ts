/** @jest-environment node */
import { NextRequest } from 'next/server';
import { serverAPIClient } from '@/lib/api/server';
import { POST as open } from './open/route';
import { POST as verify } from './verify/route';

jest.mock('@/lib/api/server', () => ({ serverAPIClient: { post: jest.fn() } }));
const post = jest.mocked(serverAPIClient.post);
const jobId = '11111111-1111-4111-8111-111111111111';
const otherJobId = '22222222-2222-4222-8222-222222222222';
const document = { companyId: 'company-abc', templateId: 'template_ABC', documentId: 'document012' };
const session = { kind: 'editable', jobId, claimEpoch: '42', claimExpiresAt: '2026-11-05T00:10:00.000Z', document };
const result = { kind: 'pending', jobId, claimEpoch: '42' };
function call(action: 'open' | 'verify', body = action === 'open' ? undefined : JSON.stringify({ claimEpoch: '42' }), id = jobId, auth = true) {
  return (action === 'open' ? open : verify)(new NextRequest(`http://localhost/api/eformsign-docs/jobs/${id}/recovery/${action}`, {
    method: 'POST', headers: auth ? { cookie: 'auth_token=fixture-session' } : {}, ...(body === undefined ? {} : { body }),
  }), { params: Promise.resolve({ jobId: id }) });
}
beforeEach(() => post.mockReset());

test.each(['open', 'verify'] as const)('%s forwards existing auth and only its fixed body/path', async action => {
  const data = action === 'open' ? session : result;
  post.mockResolvedValue({ status: 200, data });
  const response = await call(action);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual(data);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(post.mock.calls).toEqual([[`/eformsign-docs/jobs/${jobId}/recovery/${action}`, action === 'open' ? undefined : { claimEpoch: '42' },
    { headers: { Authorization: 'Bearer fixture-session' }, timeout: 170000 }]]);
});

test('verify_only has no document, verified is accepted, and UUID case binds canonically', async () => {
  const fields = { jobId, claimEpoch: session.claimEpoch, claimExpiresAt: session.claimExpiresAt };
  post.mockResolvedValue({ status: 200, data: { ...fields, kind: 'verify_only' } });
  await expect((await call('open')).json()).resolves.toEqual({ ...fields, kind: 'verify_only' });
  const id = 'abcdefab-1111-4111-8111-111111111111';
  post.mockResolvedValue({ status: 200, data: { ...result, kind: 'verified', jobId: id.toUpperCase() } });
  expect((await call('verify', undefined, id)).status).toBe(200);
});

test.each(['open', 'verify'] as const)('%s blocks missing auth and invalid UUID before upstream', async action => {
  expect((await call(action, undefined, jobId, false)).status).toBe(401);
  for (const id of ['bad', 'a%2Fb', `${jobId}\n`]) expect((await call(action, undefined, id)).status).toBe(400);
  expect(post).not.toHaveBeenCalled();
});

test('open rejects every nonempty body without upstream calls', async () => {
  for (const body of ['{}', 'null', ' ', '{"user":"fixture"}', '{"documentId":"document012"}']) {
    expect((await call('open', body)).status).toBe(400);
  }
  expect(post).not.toHaveBeenCalled();
});

test('verify rejects malformed JSON, extra fields, and invalid epochs before forwarding', async () => {
  const invalid = ['', '{', 'null', '{}', ...['documentId', 'user', 'access_token'].map(key => JSON.stringify({ claimEpoch: '42', [key]: 'fixture' })),
    ...['0', '042', '-1', '1.5', 42, '9223372036854775808', '42\n'].map(claimEpoch => JSON.stringify({ claimEpoch }))];
  for (const body of invalid) expect((await call('verify', body)).status).toBe(400);
  expect(post).not.toHaveBeenCalled();
});

test('upstream private/invalid success data is rejected before any response body is forwarded', async () => {
  for (const data of [{ ...session, access_token: 'fixture' }, { ...session, payload: {} }, { ...session, document: { ...document, token: 'fixture' } },
    { ...session, document: { ...document, documentId: 'd#x' } }, { ...session, jobId: otherJobId }, { ...session, kind: 'verify_only' },
    { ...session, claimExpiresAt: 'tomorrow' }, 'not-json', { data: session }]) {
    post.mockResolvedValue({ status: 200, data });
    const response = await call('open');
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ code: 'RECOVERY_UNAVAILABLE' });
  }
  for (const data of [{ ...result, claimEpoch: '43' }, { ...result, jobId: otherJobId }, { ...result, document }, { ...result, refresh_token: 'fixture' }]) {
    post.mockResolvedValue({ status: 200, data });
    expect((await call('verify')).status).toBe(502);
  }
});

test.each([401, 403, 404, 409, 410, 503])('preserves safe upstream status %p and strips private error fields', async status => {
  post.mockRejectedValue({ response: { status, data: { code: 'ACCESS_DENIED', reason: 'claim_conflict', expiresAt: session.claimExpiresAt,
    message: 'private', access_token: 'fixture', claimExpiresAt: 'private', payload: {} } } });
  const response = await call('open');
  expect(response.status).toBe(status);
  await expect(response.json()).resolves.toEqual({ code: 'ACCESS_DENIED', reason: 'claim_conflict', expiresAt: session.claimExpiresAt });
});

test('unknown errors, invalid metadata, invalid JSON and statuses stay generic', async () => {
  post.mockRejectedValue({ response: { status: 403, data: { code: 'PRIVATE', reason: 'private', expiresAt: 'tomorrow', message: 'private' } } });
  await expect((await call('verify')).json()).resolves.toEqual({ code: 'RECOVERY_UNAVAILABLE' });
  for (const error of [new Error('private'), { response: { status: 500, data: {} } }, { response: { status: 403, data: 'invalid-json' } }]) {
    post.mockRejectedValue(error);
    const response = await call('open');
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ code: 'RECOVERY_UNAVAILABLE' });
  }
  post.mockResolvedValue({ status: 201, data: session });
  expect((await call('open')).status).toBe(502);
});
