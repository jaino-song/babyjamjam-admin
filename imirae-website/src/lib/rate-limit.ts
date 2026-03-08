const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 5;

const ipRequestMap = new Map<string, number[]>();

export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = ipRequestMap.get(ip) ?? [];

  // Remove expired timestamps
  const valid = timestamps.filter((t) => now - t < WINDOW_MS);

  if (valid.length >= MAX_REQUESTS) {
    ipRequestMap.set(ip, valid);
    return true;
  }

  valid.push(now);
  ipRequestMap.set(ip, valid);
  return false;
}
