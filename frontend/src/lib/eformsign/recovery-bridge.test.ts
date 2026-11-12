import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  createRecoveryBridgeClose, createRecoveryBridgeInit, createRecoveryBridgeNonce,
  isRecoveryBridgeEvent, isRecoveryBridgeId, isRecoveryBridgeMessage, isRecoveryBridgeNonce,
} from './recovery-bridge';

const runtime = readFileSync(resolve(process.cwd(), 'public/eformsign-recovery-bridge.js'), 'utf8');
const nonce = 'a'.repeat(64);
const channel = 'babyjamjam:eformsign-recovery';
const origin = window.location.origin;
const ids = { companyId: 'company-abc', templateId: 'template_ABC', documentId: 'document012' };
const packet = (type: string, extra = {}) => ({ channel, version: 1, nonce, type, ...extra });
const invalidIds = ['', 'd#x', 'd&document_id=other', 'd%23x', 'a b', '한글', 'https://example.com', 'x'.repeat(129), 'd\n', 'd\r', 'd '];

function harness(hash = nonce) {
  const outer = document.createElement('iframe');
  outer.src = `${origin}/eformsign-recovery-bridge.html#${hash}`;
  document.body.appendChild(outer);
  const realm = outer.contentWindow!;
  const doc = realm.document;
  doc.open(); doc.write('<!doctype html><html><head></head><body></body></html>'); doc.close();
  doc.body.innerHTML = '<main id="provider-root"></main>';
  const post = jest.spyOn(window, 'postMessage').mockImplementation(() => {});
  const received = jest.fn();
  const calls = jest.fn();
  const open = jest.fn();
  const sdk = { document: calls, open, _success_callback: null, _error_callback: null, _action_callback: null };
  calls.mockImplementation((_options, _frame, success, error, action) => {
    Object.assign(sdk, { _success_callback: success, _error_callback: error, _action_callback: action });
  });
  const Constructor = jest.fn(() => {
    realm.addEventListener('message', received);
    return sdk;
  });
  Object.assign(realm, { EformSignDocument: Constructor });
  runInNewContext(runtime, { window: realm, document: doc });
  function message(data: unknown, source: MessageEventSource | null = window, from = origin) {
    realm.dispatchEvent(new MessageEvent('message', { data, source, origin: from }));
  }
  const init = (extra = {}) => message(packet('INIT', { ...ids, ...extra }));
  function load() {
    doc.querySelectorAll('script').forEach(script => script.dispatchEvent(new Event('load')));
    doc.querySelectorAll('script').forEach(script => script.dispatchEvent(new Event('load')));
  }
  const callback = (index: number, data: unknown) => calls.mock.calls[0][index](data);
  return { realm, doc, post, received, calls, open, Constructor, sdk, message, init, load, callback,
    dispose: () => { outer.remove(); post.mockRestore(); } };
}

afterEach(() => { document.body.innerHTML = ''; jest.restoreAllMocks(); });

test('valid INIT loads only ordered official scripts and opens exact tokenless mode02 once', () => {
  const h = harness();
  expect(h.post).toHaveBeenCalledWith(packet('READY'), origin);
  h.init();
  expect([...h.doc.scripts].map(s => s.src)).toEqual(['https://www.eformsign.com/plugins/jquery/jquery.min.js']);
  h.load();
  expect([...h.doc.scripts].map(s => s.src)).toEqual([
    'https://www.eformsign.com/plugins/jquery/jquery.min.js', 'https://www.eformsign.com/lib/js/efs_embedded_v2.js',
  ]);
  expect(h.calls).toHaveBeenCalledTimes(1);
  expect(h.calls.mock.calls[0].slice(0, 2)).toEqual([{
    company: { id: 'company-abc', country_code: 'kr' }, mode: { type: '02', template_id: 'template_ABC', document_id: 'document012' },
    user: { type: '01' }, layout: { lang_code: 'ko' },
  }, 'eformsign-recovery-provider']);
  expect(h.open).toHaveBeenCalledTimes(1);
  const iframe = h.doc.querySelector('iframe')!;
  expect(iframe.title).toBe('전자문서 복구');
  expect(iframe.dataset.component).toBe('desktop_contracts_document-job-recovery_bridge_provider');
  expect(iframe.dataset.slot).toBe('provider-view');
  h.init(); h.load();
  expect(h.calls).toHaveBeenCalledTimes(1);
  h.dispose();
});

test.each(['companyId', 'templateId', 'documentId'])('%s rejects unsafe IDs before loading SDK', field => {
  for (const value of invalidIds) {
    const h = harness(); h.init({ [field]: value });
    expect(h.doc.scripts).toHaveLength(0);
    expect(h.Constructor).not.toHaveBeenCalled(); h.dispose();
  }
});

test.each(['user', 'access_token', 'refresh_token', 'external_token', 'url', 'mode', 'prefill', 'payload', 'unknown'])('rejects caller field %s', key => {
  const h = harness(); h.init({ [key]: 'untrusted' });
  expect(h.doc.scripts).toHaveLength(0); h.dispose();
});

test('forged origin/source/nonce/channel/version/shape cannot initialize or reach SDK', () => {
  const h = harness();
  h.message(packet('INIT', ids), window, 'https://evil.example');
  h.message(packet('INIT', ids), h.realm);
  for (const extra of [{ nonce: 'b'.repeat(64) }, { channel: 'other' }, { version: 2 }]) {
    h.message({ ...packet('INIT', ids), ...extra });
  }
  for (const data of [null, [], 'INIT', packet('INIT')]) h.message(data);
  expect(h.doc.scripts).toHaveLength(0);
  h.init(); h.load();
  h.post.mockClear();
  const source = h.doc.querySelector('iframe')!.contentWindow;
  const provider = JSON.stringify({ type: 'document', fn: 'setStorage', message: { access_token: 'fixture', refresh_token: 'fixture' } });
  h.message(provider, window, 'https://www.eformsign.com');
  h.message(provider, source, 'https://www.eformsign.com.evil.example');
  h.message(provider, source, 'http://www.eformsign.com');
  for (const data of [null, '{}', '[]', 'bad-json', JSON.stringify({ fn: 'setStorage', type: 'other' }),
    JSON.stringify({ fn: 'setStorage' }), JSON.stringify({ fn: 'setStorage', message: null })]) {
    h.message(data, source, 'https://www.eformsign.com');
  }
  expect(h.received).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
  h.message(provider, source, 'https://www.eformsign.com');
  expect(h.received).toHaveBeenCalledTimes(1); h.dispose();
});

test('success code -1 only requests verification, with no provider IDs/status/credentials', () => {
  const h = harness(); h.init(); h.load(); h.post.mockClear();
  for (const code of ['0', 0, '-2', null]) h.callback(2, { code });
  h.callback(4, { code: '-1', action: 'send' });
  expect(h.post).not.toHaveBeenCalled();
  h.callback(2, { code: '-1', document_id: 'untrusted', status: 'completed', access_token: 'fixture' });
  expect(h.post.mock.calls).toEqual([[packet('CHANGED'), origin]]);
  h.callback(3, { message: 'private provider details' });
  expect(h.post).toHaveBeenLastCalledWith(packet('ERROR'), origin); h.dispose();
});

test.each(['CLOSE', 'pagehide'])('%s removes resources, stops late work and retains deny-all capture guard', kind => {
  const h = harness(); h.init(); h.load();
  const remove = jest.spyOn(h.realm, 'removeEventListener');
  const oldSource = h.doc.querySelector('iframe')!.contentWindow;
  if (kind === 'CLOSE') {
    h.message(packet('CLOSE'), window, 'https://evil.example');
    expect(h.doc.querySelector('iframe')).not.toBeNull();
    h.message(packet('CLOSE'));
  } else h.realm.dispatchEvent(new Event('pagehide'));
  expect(h.doc.querySelector('iframe')).toBeNull();
  expect(h.doc.scripts).toHaveLength(0);
  expect(remove.mock.calls.filter(c => c[0] === 'message')).toHaveLength(1);
  expect(h.sdk._success_callback).toBeNull();
  h.post.mockClear();
  for (const index of [2, 3, 4]) h.callback(index, { code: '-1' });
  h.init();
  const malicious = JSON.stringify({ fn: 'setStorage', message: { access_token: 'fixture' } });
  h.message(malicious, window, 'https://evil.example');
  h.message(malicious, oldSource, 'https://www.eformsign.com');
  expect(h.received).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
  expect(h.doc.scripts).toHaveLength(0); h.dispose();
});

test('close during load suppresses detached script callbacks; errors are generic', () => {
  const h = harness(); h.init();
  const script = h.doc.scripts[0];
  const lateLoad = script.onload!;
  h.message(packet('CLOSE')); h.post.mockClear();
  (lateLoad as (event: Event) => void)(new Event('load'));
  expect(h.Constructor).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled(); h.dispose();
  const failed = harness(); failed.init();
  failed.doc.scripts[0].dispatchEvent(new Event('error'));
  expect(failed.post).toHaveBeenLastCalledWith(packet('ERROR'), origin); failed.dispose();
});

test.each(['', 'short', 'a'.repeat(65), `${nonce}&document_id=x`])('invalid fragment %s does not handshake/load', hash => {
  const h = harness(hash); h.init(); h.load();
  expect(h.post).not.toHaveBeenCalled();
  expect(h.Constructor).not.toHaveBeenCalled(); h.dispose();
});

test('parent helpers strictly validate identifiers, all message variants, and cryptographic nonce', () => {
  expect(createRecoveryBridgeInit(nonce, ids)).toEqual(packet('INIT', ids));
  expect(createRecoveryBridgeClose(nonce)).toEqual(packet('CLOSE'));
  const random = createRecoveryBridgeNonce();
  expect(isRecoveryBridgeNonce(random)).toBe(true);
  expect(random).not.toBe(createRecoveryBridgeNonce());
  for (const value of ['a', 'x'.repeat(128), ...Object.values(ids)]) expect(isRecoveryBridgeId(value)).toBe(true);
  for (const value of [...invalidIds, undefined, null, 1]) expect(isRecoveryBridgeId(value)).toBe(false);
  for (const type of ['READY', 'CHANGED', 'ERROR', 'CLOSE']) {
    expect(isRecoveryBridgeMessage(packet(type))).toBe(true);
    expect(isRecoveryBridgeMessage(packet(type, { documentId: 'untrusted' }))).toBe(false);
  }
  for (const value of [null, [], {}, packet('SEND'), packet('CHANGED', { status: 'completed' })]) {
    expect(isRecoveryBridgeMessage(value)).toBe(false);
  }
  for (const documentId of invalidIds) expect(() => createRecoveryBridgeInit(nonce, { ...ids, documentId })).toThrow();
  expect(() => createRecoveryBridgeClose('bad')).toThrow();
  expect(() => createRecoveryBridgeInit(nonce, { ...ids, nonce } as typeof ids)).toThrow();
});

test('parent event guard binds exact origin, iframe window, nonce and response direction', () => {
  const h = harness();
  const peer = { source: h.realm, origin, nonce };
  const event = (data = packet('CHANGED'), source: MessageEventSource | null = h.realm, from = origin) =>
    new MessageEvent('message', { data, source, origin: from });
  expect(isRecoveryBridgeEvent(event(), peer)).toBe(true);
  expect(isRecoveryBridgeEvent(event(packet('ERROR')), peer)).toBe(true);
  expect(isRecoveryBridgeEvent(event(packet('READY')), peer)).toBe(true);
  for (const forged of [event(undefined, window), event(undefined, null), event(undefined, h.realm, 'https://evil.example'),
    event(packet('INIT', ids)), event(packet('CLOSE')), event(packet('CHANGED', { access_token: 'fixture' })),
    event({ ...packet('CHANGED'), nonce: 'b'.repeat(64) })]) expect(isRecoveryBridgeEvent(forged, peer)).toBe(false);
  expect(isRecoveryBridgeEvent(event(), { ...peer, source: null })).toBe(false);
  h.dispose();
});

test.each(['a', 'x'.repeat(128)])('boundary-length identifiers initialize successfully', value => {
  const h = harness(); h.init({ companyId: value, templateId: value, documentId: value }); h.load();
  expect(h.open).toHaveBeenCalledTimes(1); h.dispose();
});

test('standalone bridge never handshakes or loads vendor code', () => {
  const realm = { location: { origin, hash: `#${nonce}` }, parent: null as unknown, addEventListener: jest.fn(), postMessage: jest.fn() };
  realm.parent = realm;
  runInNewContext(runtime, { window: realm, document: { createElement: jest.fn() } });
  expect(realm.postMessage).not.toHaveBeenCalled();
});

test.each([
  ['isEmbedding', {}, { message: null }],
  ['saveSuccess', { code: '-1' }, { code: -1 }],
  ['errorMessage', { code: 'E', message: 'fixture error' }, { code: 'E', message: null }],
  ['actionCallback', { data: [{ action: 'send' }] }, {}],
  ['setStorage', { message: { access_token: 'fixture', refresh_token: 'fixture' } }, { message: null }],
  ['getTokenInfo', { message: { role: 'member' } }, { message: { role: 1 } }],
])('%s permits its supported shape and blocks malformed command fields', (fn, good, bad) => {
  const h = harness(); h.init(); h.load(); h.post.mockClear();
  const source = h.doc.querySelector('iframe')!.contentWindow;
  h.message(JSON.stringify({ type: 'document', fn, ...bad }), source, 'https://www.eformsign.com');
  expect(h.received).not.toHaveBeenCalled();
  h.message(JSON.stringify({ type: 'document', fn, ...good }), source, 'https://www.eformsign.com');
  expect(h.received).toHaveBeenCalledTimes(1);
  expect(h.post).not.toHaveBeenCalled(); h.dispose();
});

test('navigation and arbitrary SDK targets cannot leave the controlled realm or claim success', () => {
  const h = harness(); h.init(); h.load(); h.post.mockClear();
  const source = h.doc.querySelector('iframe')!.contentWindow;
  for (const message of [null, {}, { redirect_url: 1 }, { redirect_url: '%GG' },
    { redirect_url: 'javascript:alert(1)' }, { redirect_url: 'data:text/html,fixture' },
    { redirect_url: 'https://evil.example' }, { redirect_url: 'https://www.eformsign.com/eform/account/login.html' }]) {
    h.message(JSON.stringify({ type: 'document', fn: 'redirectMessage', message }), source, 'https://www.eformsign.com');
  }
  expect(h.received).not.toHaveBeenCalled();
  expect(h.post.mock.calls).toEqual(Array.from({ length: 8 }, () => [packet('ERROR'), origin]));
  h.post.mockClear();
  for (const fn of ['userCallback', 'getBatchSignInfo', 'completeWriteDocument', 'addRecipientCallback', 'hideAuthHeader', 'unknown']) {
    h.message(JSON.stringify({ type: 'document', fn, target: 'success_callback', code: '-1', message: {} }), source, 'https://www.eformsign.com');
  }
  expect(h.received).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
  h.message(packet('CLOSE')); h.post.mockClear();
  h.message(JSON.stringify({ fn: 'redirectMessage', message: null }), source, 'https://www.eformsign.com');
  expect(h.post).not.toHaveBeenCalled(); h.dispose();
});
