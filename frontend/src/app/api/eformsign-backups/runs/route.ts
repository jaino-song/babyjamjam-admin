import { NextRequest, NextResponse } from 'next/server';
import { serverAPIClient } from '@/lib/api/server';
import { authRequiredResponse, backendJsonResponse, errorResponse, getAuthHeaders, getAuthToken,
  invalidJsonResponse, readJsonObjectBody, withNoStore } from '@/lib/api/route-utils';
import { BackupApiError, backupPageQuery, backupRequestSchema, backupRunSchema, backupRunsSchema, safeBackupError } from '@/lib/eformsign-backup-api';

function failure(error: unknown, mutation = false) {
  const safe = error instanceof BackupApiError ? error : safeBackupError(error);
  if (safe.code !== 'SERVICE_UNAVAILABLE') return withNoStore(NextResponse.json({ code: safe.code }, { status: safe.status }));
  return errorResponse({ response: { status: 503 } }, 'process backup request', mutation ? 'mutation' : 'read');
}
export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return authRequiredResponse();
  try {
    const params = backupPageQuery(request.nextUrl.searchParams);
    const response = await serverAPIClient.get('/eformsign-backups/runs', { headers: getAuthHeaders(token), params });
    const data = backupRunsSchema.safeParse(response.data);
    if (!data.success) throw new BackupApiError();
    return withNoStore(backendJsonResponse({ status: response.status, data: data.data }));
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return authRequiredResponse();
  try {
    if ([...request.nextUrl.searchParams.keys()].length) throw new BackupApiError('INVALID_REQUEST', 400);
    const body = backupRequestSchema.safeParse(await readJsonObjectBody(request));
    if (!body.success) throw new BackupApiError('INVALID_REQUEST', 400);
    const response = await serverAPIClient.post('/eformsign-backups/runs', body.data, { headers: getAuthHeaders(token) });
    const data = backupRunSchema.safeParse(response.data);
    if (!data.success) throw new BackupApiError();
    return withNoStore(backendJsonResponse({ status: response.status, data: data.data }));
  } catch (error) { return invalidJsonResponse(error) ?? failure(error, true); }
}
