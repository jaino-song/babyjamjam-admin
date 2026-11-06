import { act, renderHook, waitFor } from '@testing-library/react';
import { randomUUID } from 'node:crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { fetchAllBackupDocuments, useEformsignBackupAccess, useEformsignBackups } from '../useEformsignBackups';
import { eformsignBackups } from '@/services/eformsign-backups';
import { BackupApiError, backupRunSchema, backupDocumentSchema, type BackupRun, type BackupDocument } from '@/lib/eformsign-backup-api';
import { defaultDocumentScope } from '@/lib/eformsign-backup-view';

let mockBranch = '10000000-0000-4000-8000-000000000001';
let mockUser = { id: '10000000-0000-4000-8000-000000000010', branchId: mockBranch, role: 'owner', branchRole: 'owner' };
let mockAligned = true;
let mockAuthError: unknown = null;
const mockRefetch = jest.fn();
jest.mock('@/providers/UserProvider', () => ({ useInitialUser: () => null }));
jest.mock('@/hooks/useGetAuthUser', () => ({ useGetAuthUser: () => ({ data: mockUser, error: mockAuthError, refetch: mockRefetch }) }));
jest.mock('@/features/system-templates/branch-context', () => ({ useActiveBranchId: () => mockBranch, isBranchContextAligned: (branch: string) => mockAligned && branch === mockBranch }));
jest.mock('@/services/eformsign-backups', () => ({ eformsignBackups: { list: jest.fn(), get: jest.fn(), documents: jest.fn(), request: jest.fn() } }));
const service = jest.mocked(eformsignBackups);
const id = '20000000-0000-4000-8000-000000000001';
const at = '2026-11-05T00:00:00.000Z';
const run: BackupRun = { id, status: 'unverified', scope: defaultDocumentScope(), cut: at, createdAt: at, startedAt: at, finishedAt: at,
  summary: { target: 121, saved: 0, attention: 0, metadataOnly: 121, local: { state: 'excluded', saved: 0 }, drive: { state: 'excluded', saved: 0 } },
  coverage: 'unverified', backupComplete: false, failureCode: null };
const documents: BackupDocument[] = Array.from({ length: 121 }, (_, i) => ({ documentId: `document-${i}`, ordinal: i + 1, kind: 'contract',
  currentMilestone: 'created', documentCreatedAt: at, classification: 'excluded_by_policy', local: 'metadata_only', drive: 'metadata_only' }));
const clients: QueryClient[] = [];
function setup<T>(hook: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
  return renderHook(hook, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
beforeEach(() => {
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: randomUUID });
  jest.clearAllMocks(); mockBranch = '10000000-0000-4000-8000-000000000001';
  mockUser = { id: '10000000-0000-4000-8000-000000000010', branchId: mockBranch, role: 'owner', branchRole: 'owner' };
  mockAligned = true; mockAuthError = null;
  mockRefetch.mockImplementation(async () => ({ data: mockUser, error: mockAuthError }));
  service.list.mockResolvedValue({ items: [run], nextCursor: null }); service.get.mockResolvedValue(run);
  service.documents.mockImplementation(async (_id, cursor) => cursor ? { items: documents.slice(100), nextCursor: null } : { items: documents.slice(0, 100), nextCursor: 'cursor-100' });
  service.request.mockResolvedValue(run);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(async () => { for (const client of clients.splice(0)) { await client.cancelQueries(); client.clear(); } jest.useRealTimers(); });

describe('reactive backup access', () => {
  it('forces a fresh me and requires verified user/branch alignment', async () => {
    const { result, rerender } = setup(useEformsignBackupAccess);
    expect(result.current.isManager).toBe(false);
    await waitFor(() => expect(result.current.isManager).toBe(true));
    expect(mockRefetch).toHaveBeenCalledWith({ cancelRefetch: false });
    mockBranch = '10000000-0000-4000-8000-000000000002'; rerender();
    expect(result.current.ready).toBe(false); expect(result.current.identity).toBeNull();
    mockUser = { ...mockUser, branchId: mockBranch }; rerender();
    // A response from the prior branch never grants access to the next one.
    expect(result.current.isManager).toBe(false);
  });
  it('does not treat a global admin without a branch manager role as a manager', async () => {
    mockUser = { ...mockUser, role: 'admin', branchRole: 'user' };
    const { result } = setup(useEformsignBackupAccess);
    await waitFor(() => expect(result.current.ready).toBe(true)); expect(result.current.isManager).toBe(false);
  });
  it('deduplicates overlapping fresh me requests', async () => {
    let resolve!: (value: unknown) => void;
    mockRefetch.mockImplementation(() => new Promise(r => { resolve = r; }));
    const { result } = setup(() => [useEformsignBackupAccess(), useEformsignBackupAccess()]);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ data: mockUser }); });
    await waitFor(() => expect(result.current.every(a => a.isManager)).toBe(true));
  });
});
describe('backup query lifecycle', () => {
  it('loads all 100+21 selected documents and enables terminal download only afterwards', async () => {
    const { result } = setup(useEformsignBackups);
    await waitFor(() => expect(result.current.runs).toHaveLength(1));
    expect(service.documents).not.toHaveBeenCalled();
    act(() => result.current.selectRun(id));
    expect(result.current.downloadReady).toBe(false);
    await waitFor(() => expect(result.current.documents).toHaveLength(121));
    expect(result.current.downloadReady).toBe(true);
    expect(service.documents.mock.calls.map(call => call[1])).toEqual([undefined, 'cursor-100']);
  });
  it('serializes only the selected public terminal run and all 121 distinct documents, then revokes its Blob URL', async () => {
    const selected = backupRunSchema.parse({ ...run, id: '20000000-0000-4000-8000-000000000002',
      companyId: 'PRIVATE_CANARY', actorUserId: 'PRIVATE_CANARY', leaseToken: 'PRIVATE_CANARY',
      summary: { ...run.summary, report: 'PRIVATE_CANARY', local: { ...run.summary.local, path: 'PRIVATE_CANARY' } } });
    const publicDocuments = documents.map(d => backupDocumentSchema.parse({ ...d,
      source: 'PRIVATE_CANARY', report: 'PRIVATE_CANARY', localPath: 'PRIVATE_CANARY' }));
    service.list.mockResolvedValue({ items: [run, selected], nextCursor: null });
    service.get.mockResolvedValue(selected);
    let finishPage!: (page: { items: BackupDocument[]; nextCursor: null }) => void;
    service.documents.mockImplementation(async (_id, cursor) => cursor
      ? new Promise(resolve => { finishPage = resolve; })
      : { items: publicDocuments.slice(0, 100), nextCursor: 'cursor-100' });
    const createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const blobs: Blob[] = [];
    const create = jest.fn((blob: Blob) => { blobs.push(blob); return 'blob:owned-backup'; });
    const revoke = jest.fn();
    const clicks: { filename: string; href: string; attached: boolean }[] = [];
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ filename: this.download, href: this.href, attached: document.body.contains(this) });
    });
    const { result, unmount } = setup(useEformsignBackups);
    try {
      await waitFor(() => expect(result.current.runs).toHaveLength(2));
      act(() => result.current.selectRun(selected.id));
      await waitFor(() => expect(service.documents).toHaveBeenCalledTimes(2));
      expect(result.current.downloadReady).toBe(false);
      await act(async () => { await result.current.download(selected.id); });
      expect(create).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
      await act(async () => { finishPage({ items: publicDocuments.slice(100), nextCursor: null }); });
      await waitFor(() => expect(result.current.downloadReady).toBe(true));
      await act(async () => { await result.current.download(run.id); });
      expect(create).not.toHaveBeenCalled();
      await act(async () => { await result.current.download(selected.id); });
      expect(create).toHaveBeenCalledTimes(1);
      expect(blobs[0]?.type).toBe('application/json');
      const bytes = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject;
        reader.readAsText(blobs[0]!);
      });
      const report = JSON.parse(bytes) as { run: BackupRun; documents: BackupDocument[] };
      expect(Object.keys(report).sort()).toEqual(['documents', 'run']);
      expect(report.run).toEqual(selected); expect(report.run.id).not.toBe(run.id);
      expect(report.documents).toEqual(publicDocuments);
      expect(report.documents).toHaveLength(121);
      expect(new Set(report.documents.map(d => d.documentId)).size).toBe(121);
      expect(bytes).not.toContain('PRIVATE_CANARY');
      expect(clicks).toEqual([{ filename: `backup-${selected.id}.json`, href: 'blob:owned-backup', attached: true }]);
      expect(document.querySelector('a[download]')).toBeNull();
      expect(revoke).toHaveBeenCalledWith('blob:owned-backup');
      click.mockImplementationOnce(() => { throw new Error('synthetic click failure'); });
      await act(async () => { await expect(result.current.download(selected.id)).rejects.toThrow('synthetic click failure'); });
      expect(document.querySelector('a[download]')).toBeNull();
      expect(revoke).toHaveBeenCalledTimes(2);
      unmount(); expect(revoke).toHaveBeenCalledTimes(2);
    } finally {
      unmount(); click.mockRestore();
      if (createDescriptor) Object.defineProperty(URL, 'createObjectURL', createDescriptor); else Reflect.deleteProperty(URL, 'createObjectURL');
      if (revokeDescriptor) Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor); else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });
  it('never creates a report for an active run even after every document page is ready', async () => {
    service.get.mockResolvedValue({ ...run, status: 'running', finishedAt: null });
    const { result } = setup(useEformsignBackups);
    await waitFor(() => expect(result.current.runs).toHaveLength(1));
    act(() => result.current.selectRun(id));
    await waitFor(() => expect(result.current.documents).toHaveLength(121));
    expect(result.current.downloadReady).toBe(false);
    // jsdom has no createObjectURL: calling it here would fail this assertion.
    await expect(result.current.download(id)).resolves.toBeUndefined();
  });
  it('hides cached history and selection immediately on branch transition', async () => {
    const { result, rerender } = setup(useEformsignBackups);
    await waitFor(() => expect(result.current.runs).toHaveLength(1)); act(() => result.current.selectRun(id));
    mockBranch = '10000000-0000-4000-8000-000000000002'; rerender();
    expect(result.current.selectedId).toBeNull(); expect(result.current.runs).toEqual([]); expect(result.current.run).toBeUndefined();
  });
  it('keeps a request key on lost response, refreshes history, and rotates it after success', async () => {
    service.request.mockRejectedValueOnce(new BackupApiError()).mockResolvedValue(run);
    const { result } = setup(useEformsignBackups); await waitFor(() => expect(result.current.state).toBe('ready'));
    await act(async () => { await expect(result.current.requestRun(defaultDocumentScope())).rejects.toBeInstanceOf(BackupApiError); });
    expect(service.list.mock.calls.length).toBeGreaterThan(1);
    await act(async () => { await result.current.requestRun(defaultDocumentScope()); });
    expect(service.request.mock.calls[0]?.[0].requestKey).toBe(service.request.mock.calls[1]?.[0].requestKey);
    await act(async () => { await result.current.requestRun(defaultDocumentScope()); });
    expect(service.request.mock.calls[2]?.[0].requestKey).not.toBe(service.request.mock.calls[1]?.[0].requestKey);
  });
  it('rejects a stale successful create response after branch transition', async () => {
    let resolve!: (value: BackupRun) => void;
    service.request.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const { result, rerender } = setup(useEformsignBackups); await waitFor(() => expect(result.current.state).toBe('ready'));
    let action!: Promise<void>; act(() => { action = result.current.requestRun(defaultDocumentScope()); });
    const signal = service.request.mock.calls[0]?.[1];
    mockBranch = '10000000-0000-4000-8000-000000000002'; rerender();
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve(run); await action; });
    expect(result.current.selectedId).toBeNull(); expect(result.current.runs).toEqual([]);
  });
  it('hides cached data and stops requests after a forbidden result', async () => {
    service.list.mockRejectedValue(new BackupApiError('FORBIDDEN', 403));
    const { result } = setup(useEformsignBackups); await waitFor(() => expect(service.list).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.state).toBe('unavailable'));
    expect(result.current.runs).toEqual([]); expect(result.current.requestReady).toBe(false);
  });
  it('stops polling while the page is hidden and cancels on unmount', async () => {
    jest.useFakeTimers();
    const { result, unmount } = setup(useEformsignBackups);
    await act(async () => { await jest.advanceTimersByTimeAsync(1); });
    await act(async () => { await jest.advanceTimersByTimeAsync(10); });
    expect(result.current.state).toBe('ready');
    const before = service.list.mock.calls.length;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => { await jest.advanceTimersByTimeAsync(31_000); });
    expect(service.list).toHaveBeenCalledTimes(before);
    unmount(); await act(async () => { await jest.advanceTimersByTimeAsync(31_000); });
    expect(service.list).toHaveBeenCalledTimes(before);
  });
});
describe('complete document snapshot validation', () => {
  it.each(['duplicate', 'loop', 'nonprogress'] as const)('rejects %s pages without returning a partial report', async kind => {
    service.documents.mockImplementation(async (_id, cursor) => cursor
      ? { items: kind === 'duplicate' ? documents.slice(0, 21) : kind === 'nonprogress' ? [] : documents.slice(100), nextCursor: kind === 'duplicate' ? null : 'loop' }
      : { items: documents.slice(0, 100), nextCursor: 'loop' });
    await expect(fetchAllBackupDocuments(run, new AbortController().signal, () => true)).rejects.toBeInstanceOf(BackupApiError);
  });
});
