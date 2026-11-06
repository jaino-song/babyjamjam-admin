import { api } from '@/lib/api/client';
import { backupRunSchema, backupRunsSchema, backupDocumentsSchema, safeBackupError, BackupApiError,
  type BackupRequest, type BackupRun, type BackupRuns, type BackupDocuments } from '@/lib/eformsign-backup-api';

async function parsed<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, work: () => Promise<{ data: unknown }>): Promise<T> {
  let value: unknown;
  try { value = (await work()).data; } catch (error) { throw safeBackupError(error); }
  const result = schema.safeParse(value);
  if (!result.success) throw new BackupApiError();
  return result.data;
}
export const eformsignBackups = {
  list: (cursor?: string, signal?: AbortSignal): Promise<BackupRuns> => parsed(backupRunsSchema,
    () => api.get('/eformsign-backups/runs', { params: { limit: 100, ...(cursor ? { cursor } : {}) }, signal })),
  get: (id: string, signal?: AbortSignal): Promise<BackupRun> => parsed(backupRunSchema,
    () => api.get(`/eformsign-backups/runs/${id}`, { signal })),
  documents: (id: string, cursor?: string, signal?: AbortSignal): Promise<BackupDocuments> => parsed(backupDocumentsSchema,
    () => api.get(`/eformsign-backups/runs/${id}/documents`, { params: { limit: 100, ...(cursor ? { cursor } : {}) }, signal })),
  request: (body: BackupRequest, signal?: AbortSignal): Promise<BackupRun> => parsed(backupRunSchema,
    () => api.post('/eformsign-backups/runs', body, { signal })),
};
