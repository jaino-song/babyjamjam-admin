import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { fetchLeaseHealth, verifyProductionProvider } from './verify-production-provider.mjs';

function payload(provider = 'lightnode', held = false) {
  return { mode: 'required', holderId: provider, held, provider, eligible: true, eligibilityReason: 'provider_match' };
}

for (const provider of ['lightnode', 'lightsail']) {
  for (const held of [true, false]) {
    test(`${provider} accepts eligible owner with held=${held} during handover`, () => {
      verifyProductionProvider(JSON.stringify(payload(provider, held)), provider);
    });
  }
}

const good = payload();
for (const [label, value] of Object.entries({
  'old runtime': { mode: 'required', holderId: 'lightnode', held: false },
  'other provider': payload('lightsail'),
  'missing provider': { ...good, provider: null },
  'ineligible': { ...good, eligible: false },
  'string boolean': { ...good, eligible: 'true' },
  'string held': { ...good, held: 'false' },
  'off bypass': { ...good, mode: 'off' },
  'passive': { ...good, mode: 'standby' },
  'wrong identity': { ...good, holderId: 'lightsail' },
  'wrong reason': { ...good, eligibilityReason: 'provider_holder_mismatch' },
  'unknown field': { ...good, extra: 'private text' },
  'nested field': { ...good, provider: { provider: 'lightnode' } },
  'array': [good], 'null': null,
})) {
  test(`refuses ${label}`, () => assert.throws(() => verifyProductionProvider(JSON.stringify(value), 'lightnode')));
}
for (const body of ['not JSON', '{} trailing', '', ' '.repeat(4097),
  JSON.stringify(good).replace('"eligible":true', '"eligible":false,"eligible":true'),
  JSON.stringify(good).replace('"eligible":true', '"eligible":false,"\\u0065ligible":true'),
]) {
  test(`refuses malformed, oversized or duplicated JSON (${body.length} bytes)`, () => {
    assert.throws(() => verifyProductionProvider(body, 'lightnode'));
  });
}
test('invalid targets are refused before transport', () => {
  for (const target of [undefined, '', 'none', 'cloudrun', 'invalid']) {
    assert.throws(() => verifyProductionProvider(JSON.stringify(good), target));
  }
});

function transport(status, body, options = {}) {
  return (url, config, callback) => {
    assert.equal(url, 'https://api.babyjamjam.com/health/lease');
    assert.equal(config.rejectUnauthorized, true);
    const request = new EventEmitter();
    request.destroy = () => {};
    process.nextTick(() => {
      if (options.networkError) {
        request.emit('error', new Error('private network diagnostic'));
        return;
      }
      const response = new EventEmitter();
      response.statusCode = status;
      response.destroy = () => {};
      callback(response);
      response.emit('data', Buffer.from(body));
      if (options.aborted) response.emit('aborted');
      else response.emit('end');
    });
    return request;
  };
}

test('fetches bounded TLS health without provider calls in tests', async () => {
  const body = JSON.stringify(good);
  assert.equal(await fetchLeaseHealth(transport(200, body)), body);
});
for (const [label, request] of [
  ['redirect', transport(302, '')], ['error status', transport(503, 'private error')],
  ['oversize', transport(200, 'x'.repeat(4097))],
  ['aborted', transport(200, '{}', { aborted: true })],
  ['network error', transport(200, '', { networkError: true })],
]) {
  test(`fetch refuses ${label} with a sanitized error`, async () => {
    await assert.rejects(fetchLeaseHealth(request), { message: 'Lease health HTTPS verification failed' });
  });
}
test('total deadline terminates a hung transport', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let destroyed = false;
  const promise = fetchLeaseHealth(() => {
    const request = new EventEmitter();
    request.destroy = () => { destroyed = true; };
    return request;
  });
  const refused = assert.rejects(promise, { message: 'Lease health HTTPS verification failed' });
  t.mock.timers.tick(10_000);
  await refused;
  assert.equal(destroyed, true);
});
