/** @jest-environment node */
import axios, { AxiosError, type AxiosAdapter } from 'axios';
import { api } from '@/lib/api/client';
import { eformsignApi } from '../eformsign';

// Keep Axios and the client's registered interceptors real; isolate unrelated effects.
jest.mock('@/lib/auth/authority-state', () => ({ resetAuthorityState: jest.fn() }));
jest.mock('@/lib/observability/capture-api-error', () => ({ captureApiError: jest.fn() }));
const originalAdapter = axios.defaults.adapter;
const originalApiAdapter = api.defaults.adapter;
const jobId = '11111111-1111-4111-8111-111111111111';
afterEach(() => { axios.defaults.adapter = originalAdapter; api.defaults.adapter = originalApiAdapter; });

function transport(initial401: boolean) {
  const events: Array<{ path: string | undefined; method: string | undefined; timeout: number | undefined; body: unknown }> = [];
  let recoveryCalls = 0;
  const adapter: AxiosAdapter = async config => {
    events.push({ path: config.url, method: config.method, timeout: config.timeout, body: config.data });
    const response = { status: 200, statusText: 'OK', data: {}, headers: {}, config };
    if (config.url === '/api/auth/refresh') return response;
    if (!config.url?.endsWith('/recovery/open') && !config.url?.endsWith('/recovery/verify')) throw new Error('Unexpected local transport target');
    recoveryCalls += 1;
    if (initial401 && recoveryCalls === 1) {
      throw new AxiosError('fixture 401', 'ERR_BAD_REQUEST', config, undefined,
        { ...response, status: 401, statusText: 'Unauthorized', data: { code: 'AUTH_REQUIRED' } });
    }
    return { ...response, data: config.url.endsWith('/open')
      ? { kind: 'verify_only', jobId, claimEpoch: '42', claimExpiresAt: '2026-11-05T00:10:00.000Z' }
      : { kind: 'pending', jobId, claimEpoch: '42' } };
  };
  axios.defaults.adapter = adapter; api.defaults.adapter = adapter;
  return events;
}
const run = (action: 'open' | 'verify') => action === 'open'
  ? eformsignApi.openDocumentJobRecovery(jobId) : eformsignApi.verifyDocumentJobRecovery(jobId, '42');

test.each(['open', 'verify'] as const)('%s first 401 produces one actual POST and no automatic refresh/replay', async action => {
  const events = transport(true);
  let failure: unknown;
  try { await run(action); } catch (error) { failure = error; }
  expect(events.map(event => event.path)).toEqual([`/eformsign-docs/jobs/${jobId}/recovery/${action}`]);
  expect(failure).toBeInstanceOf(AxiosError);
  expect(failure).toMatchObject({ response: { status: 401, data: { code: 'AUTH_REQUIRED' } } });
  expect(events[0]).toMatchObject({ method: 'post', timeout: 180000,
    body: action === 'open' ? undefined : JSON.stringify({ claimEpoch: '42' }) });
});

test.each(['open', 'verify'] as const)('%s retains normal 200 parsing through actual interceptors', async action => {
  const events = transport(false);
  await expect(run(action)).resolves.toMatchObject({ kind: action === 'open' ? 'verify_only' : 'pending', jobId, claimEpoch: '42' });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ method: 'post', timeout: 180000 });
});
