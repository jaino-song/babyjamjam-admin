import { NextRequest, NextResponse } from 'next/server';
import { serverAPIClient } from '@/lib/api/server';
import { getAuthHeaders, getAuthToken, NO_STORE_CACHE_CONTROL } from '@/lib/api/route-utils';
import {
  manualRecoveryJobIdSchema, matchesManualRecoveryClaim, openManualRecoveryResponseSchema,
  sanitizeManualRecoveryError, verifyManualRecoveryRequestSchema, verifyManualRecoveryResponseSchema,
  type ManualRecoveryError, type OpenManualRecoveryResponse, type VerifyManualRecoveryRequest, type VerifyManualRecoveryResponse,
} from '@/lib/eformsign/manual-recovery-contract';

type RouteParams = { params: Promise<{ jobId: string }> };
function json(data: ManualRecoveryError | OpenManualRecoveryResponse | VerifyManualRecoveryResponse, status: number) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': NO_STORE_CACHE_CONTROL } });
}
function unavailable() { return json({ code: 'RECOVERY_UNAVAILABLE' }, 502); }

/** Fixed same-contract proxies; neither caller data nor upstream data chooses a target. */
export async function manualRecoveryPost(request: NextRequest, { params }: RouteParams, action: 'open' | 'verify') {
  const token = getAuthToken(request);
  if (!token) return json({ code: 'AUTH_REQUIRED' }, 401);
  const { jobId } = await params;
  if (!manualRecoveryJobIdSchema.safeParse(jobId).success) return json({ code: 'VALIDATION_FAILED' }, 400);
  let body: VerifyManualRecoveryRequest | undefined;
  try {
    const text = await request.text();
    if (action === 'open') {
      if (text.length !== 0) return json({ code: 'VALIDATION_FAILED' }, 400);
    } else {
      const parsed = verifyManualRecoveryRequestSchema.safeParse(JSON.parse(text));
      if (!parsed.success) return json({ code: 'VALIDATION_FAILED' }, 400);
      body = parsed.data;
    }
  } catch { return json({ code: 'VALIDATION_FAILED' }, 400); }
  try {
    const response = await serverAPIClient.post<unknown>(`/eformsign-docs/jobs/${encodeURIComponent(jobId)}/recovery/${action}`, body, {
      headers: getAuthHeaders(token),
      timeout: 170_000,
    });
    if (response.status !== 200) return unavailable();
    const parsed = action === 'open' ? openManualRecoveryResponseSchema.safeParse(response.data) : verifyManualRecoveryResponseSchema.safeParse(response.data);
    if (!parsed.success || !matchesManualRecoveryClaim(parsed.data, jobId, body?.claimEpoch)) return unavailable();
    return json(parsed.data, 200);
  } catch (error) {
    const response = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
    if (typeof response?.status !== 'number' || ![401, 403, 404, 409, 410, 503].includes(response.status) ||
        response.data === null || typeof response.data !== 'object' || Array.isArray(response.data)) return unavailable();
    return json(sanitizeManualRecoveryError(response.data), response.status);
  }
}
