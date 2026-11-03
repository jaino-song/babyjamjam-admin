import { get } from 'node:https';
import { pathToFileURL } from 'node:url';

const ENDPOINT = 'https://api.babyjamjam.com/health/lease';
const MAX_BYTES = 4096;
const TIMEOUT_MS = 10_000;
const KEYS = ['eligible', 'eligibilityReason', 'held', 'holderId', 'mode', 'provider'].sort();

function assertTarget(target) {
  if (target !== 'lightnode' && target !== 'lightsail') {
    throw new Error('Expected a resolved production deployment provider');
  }
}

// This public response is deliberately flat. Refuse legacy responses, unknown fields,
// duplicate keys (including escaped spellings), coercion and malformed JSON.
export function verifyProductionProvider(body, target) {
  assertTarget(target);
  if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_BYTES) {
    throw new Error('Invalid lease health response');
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('Invalid lease health response');
  }
  const seen = new Set();
  for (const token of body.matchAll(/"(?:\\.|[^"\\])*"/g)) {
    if (!body.slice(token.index + token[0].length).trimStart().startsWith(':')) continue;
    const key = JSON.parse(token[0]);
    if (seen.has(key)) throw new Error('Invalid lease health response');
    seen.add(key);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object'
      || Object.keys(parsed).sort().join(',') !== KEYS.join(',')
      || parsed.mode !== 'required' || typeof parsed.held !== 'boolean'
      || parsed.holderId !== target || parsed.provider !== target
      || parsed.eligible !== true || parsed.eligibilityReason !== 'provider_match') {
    throw new Error('Production provider is not eligible for the resolved deployment target');
  }
}

// A fixed HTTPS endpoint, normal TLS verification, no redirects, a byte cap and a
// total deadline. Neither network errors nor response bodies are printed to CI logs.
export function fetchLeaseHealth(request = get) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, body) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(new Error('Lease health HTTPS verification failed'));
      else resolve(body);
    };
    const req = request(ENDPOINT, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      rejectUnauthorized: true,
    }, (response) => {
      if (response.statusCode !== 200) {
        finish(true);
        response.destroy();
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          finish(true);
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(false, Buffer.concat(chunks).toString('utf8')));
      response.on('error', () => finish(true));
      response.on('aborted', () => finish(true));
    });
    req.on('error', () => finish(true));
    timer = setTimeout(() => {
      finish(true);
      req.destroy();
    }, TIMEOUT_MS);
    // Test transports may answer synchronously; do not leave a deadline behind.
    if (settled) clearTimeout(timer);
  });
}

export async function main(target) {
  assertTarget(target);
  verifyProductionProvider(await fetchLeaseHealth(), target);
  process.stdout.write('Production provider eligibility verified\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) {
    process.stderr.write('Expected one resolved production deployment provider\n');
    process.exitCode = 1;
  } else {
    main(process.argv[2]).catch(() => {
      process.stderr.write('Production provider eligibility verification failed\n');
      process.exitCode = 1;
    });
  }
}
