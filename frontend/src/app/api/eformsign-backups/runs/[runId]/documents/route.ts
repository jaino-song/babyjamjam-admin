import { NextRequest, NextResponse } from 'next/server';
import { serverAPIClient } from '@/lib/api/server';
import { authRequiredResponse, backendJsonResponse, errorResponse, getAuthHeaders, getAuthToken, withNoStore } from '@/lib/api/route-utils';
import { BackupApiError, backupPageQuery, backupUuidSchema, backupDocumentsSchema, safeBackupError } from '@/lib/eformsign-backup-api';

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const token = getAuthToken(request);
  if (!token) return authRequiredResponse();
  try {
    const { runId } = await context.params;
    if (!backupUuidSchema.safeParse(runId).success) throw new BackupApiError('INVALID_REQUEST', 400);
    const params = backupPageQuery(request.nextUrl.searchParams, true, runId);
    const response = await serverAPIClient.get(`/eformsign-backups/runs/${runId}/documents`, { headers: getAuthHeaders(token), params });
    const result = backupDocumentsSchema.safeParse(response.data);
    if (!result.success) throw new BackupApiError();
    return withNoStore(backendJsonResponse({ status: response.status, data: result.data }));
  } catch (error) {
    const safe = error instanceof BackupApiError ? error : safeBackupError(error);
    if (safe.code !== 'SERVICE_UNAVAILABLE') return withNoStore(NextResponse.json({ code: safe.code }, { status: safe.status }));
    return errorResponse({ response: { status: 503 } }, 'fetch backup documents', 'read');
  }
}
