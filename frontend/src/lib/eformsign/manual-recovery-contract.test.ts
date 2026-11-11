/** @jest-environment node */
import { api } from '@/lib/api/client';
import { eformsignApi } from '@/services/eformsign';
import {
  claimEpochSchema, manualRecoveryErrorSchema, openManualRecoveryRequestSchema, openManualRecoveryResponseSchema,
  verifyManualRecoveryRequestSchema, verifyManualRecoveryResponseSchema,
} from './manual-recovery-contract';

jest.mock('@/lib/api/client', () => ({ api: { post: jest.fn() } }));
const post = jest.mocked(api.post);
const jobId = '11111111-1111-4111-8111-111111111111';
const otherJobId = '22222222-2222-4222-8222-222222222222';
const document = { companyId: 'company-abc', templateId: 'template_ABC', documentId: 'document012' };
const session = { kind: 'editable', jobId, claimEpoch: '42', claimExpiresAt: '2026-11-05T00:10:00.000Z', document };
const verifyOnly = { kind: 'verify_only', jobId, claimEpoch: '42', claimExpiresAt: session.claimExpiresAt };
const result = { kind: 'verified', jobId, claimEpoch: '42' };
beforeEach(() => post.mockReset());

test('open posts no data and returns the strict bound session', async () => {
  post.mockResolvedValue({ data: session });
  await expect(eformsignApi.openDocumentJobRecovery(jobId)).resolves.toEqual(session);
  expect(post.mock.calls).toEqual([[`/eformsign-docs/jobs/${jobId}/recovery/open`, undefined, { timeout: 180000, _retry: true }]]);
});

test('verify posts epoch only and binds its response', async () => {
  post.mockResolvedValue({ data: result });
  await expect(eformsignApi.verifyDocumentJobRecovery(jobId, '42')).resolves.toEqual(result);
  expect(post.mock.calls).toEqual([[`/eformsign-docs/jobs/${jobId}/recovery/verify`, { claimEpoch: '42' }, { timeout: 180000, _retry: true }]]);
});

test('wrong job/epoch and private success fields never pass the client boundary', async () => {
  for (const data of [{ ...session, jobId: otherJobId }, { ...session, access_token: 'fixture' }]) {
    post.mockResolvedValue({ data });
    await expect(eformsignApi.openDocumentJobRecovery(jobId)).rejects.toThrow();
  }
  post.mockResolvedValue({ data: { ...result, claimEpoch: '43' } });
  await expect(eformsignApi.verifyDocumentJobRecovery(jobId, '42')).rejects.toThrow();
});

test('failure is not retried or sent to legacy resolve', async () => {
  const failure = new Error('unavailable'); post.mockRejectedValue(failure);
  await expect(eformsignApi.verifyDocumentJobRecovery(jobId, '42')).rejects.toBe(failure);
  expect(post.mock.calls).toEqual([[`/eformsign-docs/jobs/${jobId}/recovery/verify`, { claimEpoch: '42' }, { timeout: 180000, _retry: true }]]);
});

test('pure schemas accept both session/result variants and expired-but-structural ISO timestamps', () => {
  expect(typeof window).toBe('undefined');
  expect(openManualRecoveryRequestSchema.parse(undefined)).toBeUndefined();
  expect(openManualRecoveryRequestSchema.safeParse({}).success).toBe(false);
  expect(openManualRecoveryResponseSchema.parse(session)).toEqual(session);
  expect(openManualRecoveryResponseSchema.parse(verifyOnly)).not.toHaveProperty('document');
  for (const kind of ['pending', 'verified']) expect(verifyManualRecoveryResponseSchema.parse({ ...result, kind }).kind).toBe(kind);
  expect(manualRecoveryErrorSchema.parse({ code: 'ACCESS_DENIED', reason: 'claim_conflict', expiresAt: session.claimExpiresAt })).toBeTruthy();
  expect(manualRecoveryErrorSchema.safeParse({ code: 'PRIVATE_CODE' }).success).toBe(false);
  expect(manualRecoveryErrorSchema.safeParse({ code: 'ACCESS_DENIED', message: 'private' }).success).toBe(false);
});

test.each(['0', '042', '-1', '1.5', 42, '9223372036854775808', '42\n', '', null])('invalid epoch %p is rejected before posting', async claimEpoch => {
  expect(claimEpochSchema.safeParse(claimEpoch).success).toBe(false);
  expect(verifyManualRecoveryRequestSchema.safeParse({ claimEpoch }).success).toBe(false);
  await expect(eformsignApi.verifyDocumentJobRecovery(jobId, claimEpoch as string)).rejects.toThrow();
  expect(post).not.toHaveBeenCalled();
});

test('epoch bounds are strings, and request fields stay strict', () => {
  for (const claimEpoch of ['1', '42', '9223372036854775807']) expect(claimEpochSchema.parse(claimEpoch)).toBe(claimEpoch);
  for (const key of ['documentId', 'user', 'access_token']) {
    expect(verifyManualRecoveryRequestSchema.safeParse({ claimEpoch: '42', [key]: 'fixture' }).success).toBe(false);
  }
});

test.each(['d#x', 'd&document_id=x', 'd%23x', 'https://x', 'id\n', '', 'x'.repeat(129)])('unsafe provider ID %p is invalid in every public field', value => {
  for (const key of Object.keys(document)) {
    expect(openManualRecoveryResponseSchema.safeParse({ ...session, document: { ...document, [key]: value } }).success).toBe(false);
  }
});

test('strict schemas and client reject private fields, unexpected wrappers, dates and verification documents', async () => {
  const invalid = [{ ...session, refresh_token: 'fixture' }, { ...session, payload: {} },
    { ...session, document: { ...document, token: 'fixture' } }, { ...verifyOnly, kind: 'verify_only', document },
    { ...session, claimExpiresAt: 'tomorrow' }, { ...session, claimExpiresAt: '' }, { ...session, claimExpiresAt: `${session.claimExpiresAt}\n` }, { data: session },
    { ...session, jobId: 'invalid' }];
  for (const data of invalid) {
    expect(openManualRecoveryResponseSchema.safeParse(data).success).toBe(false);
    post.mockResolvedValue({ data });
    await expect(eformsignApi.openDocumentJobRecovery(jobId)).rejects.toThrow();
  }
  for (const data of [{ ...result, document }, { ...result, payload: {} }, { ...result, access_token: 'fixture' }, { ...result, jobId: otherJobId }]) {
    post.mockResolvedValue({ data });
    await expect(eformsignApi.verifyDocumentJobRecovery(jobId, '42')).rejects.toThrow();
  }
});

test('client UUID binding ignores case and rejects unsafe path inputs before posting', async () => {
  const id = 'abcdefab-1111-4111-8111-111111111111';
  post.mockResolvedValue({ data: { ...session, jobId: id.toUpperCase() } });
  await expect(eformsignApi.openDocumentJobRecovery(id)).resolves.toHaveProperty('jobId', id.toUpperCase());
  post.mockClear();
  for (const id of ['../x', `${jobId}\n`, '']) await expect(eformsignApi.openDocumentJobRecovery(id)).rejects.toThrow();
  expect(post).not.toHaveBeenCalled();
});

test('client preserves verify_only and pending responses without adding an iframe document', async () => {
  post.mockResolvedValue({ data: verifyOnly });
  await expect(eformsignApi.openDocumentJobRecovery(jobId)).resolves.toEqual(verifyOnly);
  post.mockResolvedValue({ data: { ...result, kind: 'pending' } });
  await expect(eformsignApi.verifyDocumentJobRecovery(jobId, '42')).resolves.toEqual({ ...result, kind: 'pending' });
});
