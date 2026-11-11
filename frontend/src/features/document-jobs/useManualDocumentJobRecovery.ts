"use client";

import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { eformsignApi } from '@/services/eformsign';
import { createRecoveryBridgeClose, createRecoveryBridgeInit, createRecoveryBridgeNonce, isRecoveryBridgeEvent } from '@/lib/eformsign/recovery-bridge';
import { matchesManualRecoveryClaim, openManualRecoveryResponseSchema, verifyManualRecoveryResponseSchema, type OpenManualRecoveryResponse } from '@/lib/eformsign/manual-recovery-contract';
import { useDocumentJobs } from './DocumentJobsProvider';

function openFailure(error: unknown): string {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  const code = isAxiosError(error) ? error.response?.data?.code : undefined;
  if (status === 401) return '로그인이 필요해요. 다시 로그인한 뒤 작업을 열어 주세요.';
  if (status === 403) return '이 작업은 관리자 권한이 필요해요. 지점 관리자에게 요청해 주세요.';
  if (code === 'RECOVERY_UNSUPPORTED') return '이전 방식으로 생성됐거나 수동 화면을 지원하지 않는 작업이에요. 관리자에게 확인해 주세요.';
  if (status === 410) return '복구 내용을 보관하는 기간이 지났어요. 관리자에게 확인해 주세요.';
  if (status === 409) return '다른 곳에서 처리 중이거나 작업 상태가 바뀌었어요. 목록에서 다시 확인해 주세요.';
  return '작업을 불러오지 못했어요. 창을 닫고 잠시 후 다시 열어 주세요.';
}

export function useManualDocumentJobRecovery(jobId: string) {
  const { refetchSummary, refetchJobs } = useDocumentJobs();
  const [session, setSession] = useState<OpenManualRecoveryResponse | null>(null);
  const [nonce, setNonce] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'pending' | 'verified' | 'error'>('loading');
  const [notice, setNotice] = useState('작업을 불러오는 중이에요.');
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const frameWindow = useRef<Window | null>(null);
  const setFrame = useCallback((node: HTMLIFrameElement | null) => {
    frameRef.current = node;
    if (node) frameWindow.current = node.contentWindow;
  }, []);
  const live = useRef(false), busyRef = useRef(false), verified = useRef(false);
  const current = useRef<OpenManualRecoveryResponse | null>(null);
  const frameNonce = useRef<string | null>(null), initialized = useRef(false), loaded = useRef(false);
  const opening = useRef<{ jobId: string; promise: Promise<OpenManualRecoveryResponse> } | null>(null);
  const dispose = useRef(() => {});
  const refresh = useRef(() => {});
  useEffect(() => { refresh.current = () => { refetchSummary(); refetchJobs(); }; }, [refetchSummary, refetchJobs]);

  const stopFrame = useCallback((clear = true) => {
    if (frameNonce.current) frameWindow.current?.postMessage(createRecoveryBridgeClose(frameNonce.current), window.location.origin);
    frameWindow.current = null;
    frameNonce.current = null; initialized.current = false; loaded.current = false;
    if (clear) setNonce(null);
  }, []);
  const close = useCallback(() => { dispose.current(); stopFrame(); }, [stopFrame]);
  const initialize = useCallback(() => {
    const claim = current.current, value = frameNonce.current, target = frameRef.current?.contentWindow;
    if (!live.current || !target || !value || initialized.current || claim?.kind !== 'editable') return;
    if (Date.parse(claim.claimExpiresAt) <= Date.now()) return;
    initialized.current = true;
    target.postMessage(createRecoveryBridgeInit(value, claim.document), window.location.origin);
  }, []);
  const onLoad = useCallback(() => { loaded.current = true; initialize(); }, [initialize]);
  const verify = useCallback(async () => {
    const claim = current.current;
    if (!live.current || !claim || busyRef.current || verified.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const parsed = verifyManualRecoveryResponseSchema.safeParse(await eformsignApi.verifyDocumentJobRecovery(jobId, claim.claimEpoch));
      if (!live.current || current.current !== claim) return;
      if (!parsed.success || !matchesManualRecoveryClaim(parsed.data, jobId, claim.claimEpoch)) throw new Error('invalid response');
      if (parsed.data.kind === 'verified') {
        verified.current = true; stopFrame(); setStatus('verified'); setNotice('서버에서 전송 결과를 확인했어요.'); refresh.current();
      } else { setStatus('pending'); setNotice('아직 전송 결과가 확인되지 않았어요. 확인 후 다시 눌러 주세요.'); }
    } catch (error) {
      if (live.current && current.current === claim) {
        const denied = isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0);
        if (denied) stopFrame();
        setStatus('error'); setNotice(denied ? openFailure(error) : '결과를 확인하지 못했어요. 잠시 후 결과 확인을 다시 눌러 주세요.');
      }
    } finally {
      busyRef.current = false;
      if (live.current && current.current === claim) setBusy(false);
    }
  }, [jobId, stopFrame]);

  useEffect(() => {
    live.current = true;
    let subscribed = true, timer: ReturnType<typeof setTimeout> | undefined;
    const receive = (event: MessageEvent) => {
      const value = frameNonce.current;
      if (!live.current || !value || !isRecoveryBridgeEvent(event, { source: frameRef.current?.contentWindow ?? null, origin: window.location.origin, nonce: value })) return;
      if (current.current && Date.parse(current.current.claimExpiresAt) <= Date.now()) {
        stopFrame(); setExpired(true); setNotice('화면 이용 시간이 지났어요. 결과 확인으로 서버 상태를 확인해 주세요.'); return;
      }
      if (event.data.type === 'READY') initialize();
      else if (event.data.type === 'CHANGED') void verify();
      else setNotice('전자문서 화면을 확인하지 못했어요. 결과 확인을 눌러 서버 상태를 확인해 주세요.');
    };
    window.addEventListener('message', receive);
    if (opening.current?.jobId !== jobId) {
      current.current = null; verified.current = false; setSession(null); setNonce(null); setExpired(false); setStatus('loading');
      opening.current = { jobId, promise: eformsignApi.openDocumentJobRecovery(jobId) };
    }
    void opening.current.promise.then(data => {
      if (!subscribed || !live.current) return;
      const parsed = openManualRecoveryResponseSchema.safeParse(data);
      if (!parsed.success || !matchesManualRecoveryClaim(parsed.data, jobId)) throw new Error('invalid response');
      const claim = parsed.data;
      current.current = claim; setSession(claim); setStatus('ready');
      setNotice(claim.kind === 'verify_only' ? '이미 열린 문서가 있어 결과 확인만 할 수 있어요.' : '전자문서 화면에서 처리한 뒤 결과 확인을 눌러 주세요.');
      const schedule = () => {
        const remaining = Date.parse(claim.claimExpiresAt) - Date.now();
        if (verified.current) return;
        if (remaining <= 0) { stopFrame(); setExpired(true); setNotice('화면 이용 시간이 지났어요. 결과 확인으로 서버 상태를 확인해 주세요.'); }
        else timer = setTimeout(schedule, Math.min(remaining, 2147483647));
      };
      if (claim.kind === 'editable' && Date.parse(claim.claimExpiresAt) > Date.now()) {
        const nextNonce = createRecoveryBridgeNonce(); frameNonce.current = nextNonce; setNonce(nextNonce);
      }
      schedule();
      if (loaded.current) initialize();
    }).catch(error => {
      if (subscribed && live.current) { setStatus('error'); setNotice(openFailure(error)); }
    });
    const cleanup = () => { subscribed = false; live.current = false; window.removeEventListener('message', receive); clearTimeout(timer); stopFrame(false); };
    dispose.current = cleanup;
    return cleanup;
  }, [jobId, initialize, stopFrame, verify]);
  return { session, nonce, status, notice, busy, expired, setFrame, onLoad, verify, close };
}
