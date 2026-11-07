'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useInitialUser } from '@/providers/UserProvider';
import { useGetAuthUser, type AuthUser } from '@/hooks/useGetAuthUser';
import { isBranchContextAligned, useActiveBranchId } from '@/features/system-templates/branch-context';
import { eformsignBackups } from '@/services/eformsign-backups';
import { BackupApiError, backupIsTerminal, type BackupRun, type BackupDocument } from '@/lib/eformsign-backup-api';
import { cloneDocumentScope, type DocumentMilestoneScope } from '@/lib/eformsign-backup-view';

const authRefreshes = new WeakMap<QueryClient, Map<string, Promise<AuthUser | null>>>();
function refreshAuth(client: QueryClient, branch: string, refetch: ReturnType<typeof useGetAuthUser>['refetch']): Promise<AuthUser | null> {
  let pending = authRefreshes.get(client);
  if (!pending) { pending = new Map(); authRefreshes.set(client, pending); }
  const existing = pending.get(branch);
  if (existing) return existing;
  const promise = refetch({ cancelRefetch: false }).then(result => {
    if (result.error) throw new BackupApiError('UNAUTHORIZED', 401);
    return result.data ?? null;
  });
  pending.set(branch, promise);
  void promise.finally(() => { if (pending.get(branch) === promise) pending.delete(branch); }).catch(() => undefined);
  return promise;
}
export function useEformsignBackupAccess() {
  const initial = useInitialUser();
  const branchId = useActiveBranchId();
  const aligned = isBranchContextAligned(branchId);
  const auth = useGetAuthUser({ initialData: initial?.branchId === branchId ? initial : undefined });
  const client = useQueryClient();
  const contextTag = useMemo(() => ({ branchId, aligned, userId: auth.data?.id, dataBranchId: auth.data?.branchId }),
    [branchId, aligned, auth.data?.id, auth.data?.branchId]);
  const [verified, setVerified] = useState<{ tag: typeof contextTag; branch: string; user: string } | null>(null);
  const { refetch } = auth;
  useEffect(() => {
    let live = true;
    if (branchId && aligned) void refreshAuth(client, branchId, refetch).then(user => {
      if (live && isBranchContextAligned(branchId) && user?.branchId === branchId) {
        setVerified({ tag: contextTag, branch: branchId, user: user.id });
      }
    }).catch(() => { if (live) setVerified(null); });
    return () => { live = false; };
  }, [branchId, aligned, client, refetch, contextTag]);
  const user = auth.data;
  const ready = Boolean(!auth.error && aligned && verified?.tag === contextTag && verified.branch === branchId && verified.user === user?.id && user?.branchId === branchId);
  const isManager = ready && (user?.role === 'owner' || user?.branchRole === 'admin' || user?.branchRole === 'manager');
  return { ready, isManager, userId: ready ? user?.id ?? null : null, branchId,
    identity: ready && user && branchId ? `${user.id}:${branchId}` : null };
}
const visible = () => typeof document !== 'undefined' && document.visibilityState === 'visible';
function subscribeVisibility(fn: () => void) { document.addEventListener('visibilitychange', fn); return () => document.removeEventListener('visibilitychange', fn); }
const serverVisible = () => false;
const denied = (e: unknown) => e instanceof BackupApiError && (e.status === 401 || e.status === 403);
const retry = (attempt: number, e: unknown) => !denied(e) && attempt < 1;
const running = (run: BackupRun) => !backupIsTerminal(run);
export const backupQueryKeys = {
  identity: (user: string | null, branch: string | null) => ['eformsign-backups', user, branch] as const,
};
export async function fetchAllBackupDocuments(run: BackupRun, signal: AbortSignal, aligned: () => boolean): Promise<BackupDocument[]> {
  const documents: BackupDocument[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    if (signal.aborted || !aligned()) throw new BackupApiError();
    const page = await eformsignBackups.documents(run.id, cursor, signal);
    if (signal.aborted || !aligned()) throw new BackupApiError();
    for (const document of page.items) {
      if (ids.has(document.documentId) || document.ordinal !== documents.length + 1) throw new BackupApiError();
      ids.add(document.documentId); documents.push(document);
    }
    if (documents.length > run.summary.target) throw new BackupApiError();
    if (!page.nextCursor) {
      if (documents.length !== run.summary.target) throw new BackupApiError();
      return documents;
    }
    if (!page.items.length || cursors.has(page.nextCursor)) throw new BackupApiError();
    cursors.add(page.nextCursor); cursor = page.nextCursor;
  }
}
export function useEformsignBackups() {
  const access = useEformsignBackupAccess();
  const pageVisible = useSyncExternalStore(subscribeVisibility, visible, serverVisible);
  const client = useQueryClient();
  const { identity, branchId, userId } = access;
  const contextTag = useMemo(() => ({ identity, userId, branchId }), [identity, userId, branchId]);
  const current = useRef(contextTag);
  useLayoutEffect(() => { current.current = contextTag; }, [contextTag]);
  const [selection, select] = useState<{ identity: string; id: string; tag: typeof contextTag } | null>(null);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [pendingIdentity, setPendingIdentity] = useState<string | null>(null);
  const pending = useRef<{ identity: string; abort: AbortController } | null>(null);
  const intent = useRef<{ identity: string; signature: string; requestKey: string } | null>(null);
  const prefix = backupQueryKeys.identity(userId, branchId);
  const available = Boolean(access.isManager && identity && forbidden !== identity);
  const enabled = available && pageVisible;
  const same = () => Boolean(identity && current.current === contextTag && isBranchContextAligned(branchId));
  const history = useInfiniteQuery({
    queryKey: [...prefix, 'history'], initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      if (!same()) throw new BackupApiError();
      const page = await eformsignBackups.list(pageParam, signal);
      if (!same()) throw new BackupApiError();
      return page;
    },
    getNextPageParam: (last, pages) => {
      if (last.nextCursor && pages.slice(0, -1).some(p => p.nextCursor === last.nextCursor)) return undefined;
      return last.nextCursor ?? undefined;
    },
    enabled, retry, refetchOnWindowFocus: false,
    refetchInterval: q => enabled && !denied(q.state.error) ? (q.state.data?.pages.some(p => p.items.some(running)) ? 3000 : 15000) : false,
  });
  const selectedId = selection?.identity === identity && selection.tag === contextTag && available ? selection.id : null;
  const detail = useQuery({ queryKey: [...prefix, 'run', selectedId], enabled: enabled && Boolean(selectedId), retry,
    queryFn: async ({ signal }) => {
      if (!selectedId || !same()) throw new BackupApiError();
      const run = await eformsignBackups.get(selectedId, signal);
      if (!same() || run.id !== selectedId) throw new BackupApiError();
      return run;
    },
    refetchOnWindowFocus: false,
    refetchInterval: q => enabled && !denied(q.state.error) ? (q.state.data && running(q.state.data) ? 3000 : 15000) : false,
  });
  const run = detail.data;
  const snapshot = run ? `${run.id}:${run.status}:${run.finishedAt ?? ''}` : null;
  const docs = useQuery({ queryKey: [...prefix, 'documents', snapshot], enabled: enabled && Boolean(run && selectedId), retry,
    queryFn: ({ signal }) => { if (!run || run.id !== selectedId) throw new BackupApiError(); return fetchAllBackupDocuments(run, signal, same); },
    refetchOnWindowFocus: false,
    refetchInterval: q => enabled && !denied(q.state.error) ? (run && running(run) ? 3000 : 15000) : false,
  });
  const authDenied = denied(history.error) || denied(detail.error) || denied(docs.error);
  useEffect(() => { if (authDenied && identity) setForbidden(identity); }, [authDenied, identity]);
  useEffect(() => {
    return () => {
      void client.cancelQueries({ queryKey: backupQueryKeys.identity(userId, branchId) });
      if (pending.current?.identity === identity) { pending.current.abort.abort(); pending.current = null; }
      if (intent.current?.identity === identity) intent.current = null;
    };
  }, [identity, userId, branchId, client, contextTag]);
  const safe = available && !authDenied;
  const runs = safe ? history.data?.pages.flatMap(p => p.items) ?? [] : [];
  const duplicateHistory = new Set(runs.map(r => r.id)).size !== runs.length;
  const selectRun = (id: string | null) => { select(id && identity && safe ? { identity, id, tag: contextTag } : null); };
  const requestRun = async (scope: DocumentMilestoneScope) => {
    if (!safe || !identity || !same() || !pageVisible || pending.current?.identity === identity) return;
    const cloned = cloneDocumentScope(scope);
    const signature = JSON.stringify(cloned);
    if (intent.current?.identity !== identity || intent.current.signature !== signature) intent.current = { identity, signature, requestKey: crypto.randomUUID() };
    const requestKey = intent.current.requestKey;
    const abort = new AbortController(); pending.current = { identity, abort }; setPendingIdentity(identity);
    let accepted: BackupRun | undefined;
    let failure: unknown;
    try { accepted = await eformsignBackups.request({ scope: cloned, requestKey }, abort.signal); }
    catch (error) { failure = error; if (denied(error)) setForbidden(identity); }
    finally {
      await client.invalidateQueries({ queryKey: [...prefix, 'history'], ...(denied(failure) ? { refetchType: 'none' as const } : {}) });
      if (pending.current?.abort === abort) pending.current = null;
      setPendingIdentity(value => value === identity ? null : value);
    }
    if (!same()) return;
    if (accepted) { intent.current = null; select({ identity, id: accepted.id, tag: contextTag }); }
    if (failure) throw failure instanceof BackupApiError ? failure : new BackupApiError();
  };
  const documentsReady = Boolean(safe && run && run.id === selectedId && docs.data && !docs.error && !docs.isFetching && docs.data.length === run.summary.target);
  const downloadReady = documentsReady && Boolean(run && backupIsTerminal(run));
  const urls = useRef(new Set<string>());
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); }, [identity]);
  const download = async (id: string) => {
    if (!downloadReady || !same() || !run || id !== selectedId || run.id !== id || !docs.data || !backupIsTerminal(run)) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ run, documents: docs.data }, null, 2)], { type: 'application/json' }));
    urls.current.add(url);
    const anchor = document.createElement('a');
    try {
      anchor.href = url; anchor.download = `backup-${run.id}.json`;
      document.body.appendChild(anchor); anchor.click();
    } finally { anchor.remove(); URL.revokeObjectURL(url); urls.current.delete(url); }
  };
  return { access, identity, selectedId: safe ? selectedId : null, selectRun, runs: duplicateHistory ? [] : runs,
    run: safe && run?.id === selectedId ? run : undefined, documents: safe ? docs.data : undefined,
    state: !safe ? 'unavailable' as const : history.isPending ? 'loading' as const : history.error || duplicateHistory ? 'error' as const : 'ready' as const,
    detailState: detail.error || docs.error ? 'error' as const : detail.isPending || docs.isPending ? 'loading' as const : 'ready' as const,
    hasMore: safe && Boolean(history.hasNextPage), isFetchingMore: history.isFetchingNextPage,
    loadMore: () => { if (enabled && !history.isFetchingNextPage) void history.fetchNextPage(); },
    requestRun, download, downloadReady, requestReady: safe && pendingIdentity !== identity,
  };
}
