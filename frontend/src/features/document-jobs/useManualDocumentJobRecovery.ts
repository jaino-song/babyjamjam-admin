"use client";

import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';

import { toast } from '@/hooks/use-toast';
import { eformsignApi } from '@/services/eformsign';
import { createRecoveryBridgeClose, createRecoveryBridgeInit, createRecoveryBridgeNonce, isRecoveryBridgeEvent } from '@/lib/eformsign/recovery-bridge';
import { matchesManualRecoveryClaim, openManualRecoveryResponseSchema, verifyManualRecoveryResponseSchema, type OpenManualRecoveryResponse } from '@/lib/eformsign/manual-recovery-contract';

import { useDocumentJobs } from './DocumentJobsProvider';

const COPY = {
  sent: '전자문서를 전송했어요',
  uncertain: '이폼사인 상태를 확인하지 못했어요. 잠시 후 다시 눌러 주세요.',
  expired: '10분이 지나 화면이 닫혔어요. 수동 전송 버튼을 다시 누르면 이어서 진행할 수 있어요.',
  bridge: '이폼사인 연결에 실패했어요. 잠시 후 다시 시도해 주세요.',
  checkFailed: '전송 결과를 확인하지 못했어요. 잠시 후 수동 전송을 다시 눌러 주세요.',
};
function openFailure(error: unknown): string {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  const code = isAxiosError(error) ? error.response?.data?.code : undefined;
  if (status === 503) return COPY.uncertain;
  if (status === 401) return '로그인이 필요해요. 다시 로그인한 뒤 작업을 열어 주세요.';
  if (status === 403) return '이 작업은 관리자 권한이 필요해요. 지점 관리자에게 요청해 주세요.';
  if (code === 'RECOVERY_UNSUPPORTED') return '이전 방식으로 생성됐거나 수동 화면을 지원하지 않는 작업이에요. 관리자에게 확인해 주세요.';
  if (status === 410) return '복구 내용을 보관하는 기간이 지났어요. 관리자에게 확인해 주세요.';
  if (status === 409) return '다른 곳에서 처리 중이거나 작업 상태가 바뀌었어요. 목록에서 다시 확인해 주세요.';
  return '작업을 불러오지 못했어요. 창을 닫고 잠시 후 다시 열어 주세요.';
}
function notify(sent: boolean, fallback: string) {
  toast({ variant: sent ? 'success' : 'destructive', description: sent ? COPY.sent : fallback });
}

/** The editor exists only for a live reservation; result checks outlive an automatic close. */
export function useManualDocumentJobRecovery(jobId: string, onClose: () => void) {
  const { refetchSummary, refetchJobs } = useDocumentJobs();
  const callbacks = useRef({ onClose, refetchSummary, refetchJobs });
  callbacks.current = { onClose, refetchSummary, refetchJobs };
  const [nonce, setNonce] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const frameWindow = useRef<Window | null>(null);
  const frameNonce = useRef<string | null>(null);
  const initialized = useRef(false);
  const live = useRef(false);
  const current = useRef<OpenManualRecoveryResponse | null>(null);
  const opening = useRef<{ jobId: string; promise: Promise<OpenManualRecoveryResponse> } | null>(null);
  const checking = useRef<Promise<boolean> | null>(null);
  const dispose = useRef(() => {});

  const stopFrame = useCallback((clear = true) => {
    if (frameNonce.current) frameWindow.current?.postMessage(createRecoveryBridgeClose(frameNonce.current), window.location.origin);
    frameNonce.current = null; frameWindow.current = null; initialized.current = false;
    if (clear) setNonce(null);
  }, []);
  const close = useCallback(() => {
    dispose.current(); stopFrame(); callbacks.current.onClose();
  }, [stopFrame]);
  const setFrame = useCallback((node: HTMLIFrameElement | null) => {
    frame.current = node;
    if (node) frameWindow.current = node.contentWindow;
  }, []);
  const initialize = useCallback(() => {
    const claim = current.current, value = frameNonce.current, target = frame.current?.contentWindow;
    if (!live.current || !target || !value || initialized.current || claim?.kind !== 'editable' || Date.parse(claim.claimExpiresAt) <= Date.now()) return;
    initialized.current = true;
    target.postMessage(createRecoveryBridgeInit(value, claim.document), window.location.origin);
  }, []);
  const requestVerification = useCallback((claim: OpenManualRecoveryResponse) => {
    if (!checking.current) {
      checking.current = (async () => {
        const result = verifyManualRecoveryResponseSchema.parse(await eformsignApi.verifyDocumentJobRecovery(jobId, claim.claimEpoch));
        if (!matchesManualRecoveryClaim(result, jobId, claim.claimEpoch)) throw new Error('Invalid recovery identity');
        return result.kind === 'verified';
      })();
    }
    return checking.current;
  }, [jobId]);

  useEffect(() => {
    live.current = true;
    let subscribed = true, timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { callbacks.current.refetchSummary(); void callbacks.current.refetchJobs()?.catch(() => {}); };
    const finish = (sent: boolean, fallback: string) => {
      if (!live.current) return;
      close(); notify(sent, fallback);
      if (sent) refresh();
    };
    const closeAndCheck = async (kind: 'verify_only' | 'expired' | 'bridge') => {
      const claim = current.current;
      if (!live.current || !claim) return;
      // Mark this terminal before close/unmount, so late bridge callbacks cannot schedule work.
      close();
      try {
        let sent: boolean;
        if (kind === 'bridge') {
          sent = await requestVerification(claim);
          if (sent) refresh();
        } else {
          callbacks.current.refetchSummary();
          const result = await callbacks.current.refetchJobs();
          if (!result?.data || result.error) throw new Error('Jobs unavailable');
          const jobs = result.data;
          sent = [...jobs.active, ...jobs.requiresAttention, ...jobs.recent].some(job => job.jobId === jobId && job.status === 'completed');
        }
        notify(sent, kind === 'verify_only' ? COPY.uncertain : COPY[kind]);
      } catch { notify(false, COPY.checkFailed); }
    };
    const verifyLive = async () => {
      const claim = current.current;
      if (!live.current || !claim || checking.current) return;
      const request = requestVerification(claim);
      try {
        const sent = await request;
        if (live.current && current.current === claim && sent) finish(true, COPY.checkFailed);
      } catch { if (live.current && current.current === claim) finish(false, COPY.checkFailed); }
      finally { if (checking.current === request) checking.current = null; }
    };
    const receive = (event: MessageEvent) => {
      const value = frameNonce.current;
      if (!live.current || !value || !isRecoveryBridgeEvent(event, { source: frame.current?.contentWindow ?? null, origin: window.location.origin, nonce: value })) return;
      if (current.current && Date.parse(current.current.claimExpiresAt) <= Date.now()) { void closeAndCheck('expired'); return; }
      if (event.data.type === 'READY') initialize();
      else if (event.data.type === 'CHANGED') void verifyLive();
      else void closeAndCheck('bridge');
    };
    const cleanup = () => {
      subscribed = false; live.current = false;
      window.removeEventListener('message', receive); clearTimeout(timer); stopFrame(false);
    };
    dispose.current = cleanup;
    window.addEventListener('message', receive);
    if (opening.current?.jobId !== jobId) {
      current.current = null; checking.current = null; setNonce(null);
      opening.current = { jobId, promise: eformsignApi.openDocumentJobRecovery(jobId) };
    }
    void opening.current.promise.then(data => {
      if (!subscribed || !live.current) return;
      const claim = openManualRecoveryResponseSchema.parse(data);
      if (!matchesManualRecoveryClaim(claim, jobId)) throw new Error('Invalid recovery identity');
      current.current = claim;
      if (claim.kind === 'verify_only') { void closeAndCheck('verify_only'); return; }
      const schedule = () => {
        const remaining = Date.parse(claim.claimExpiresAt) - Date.now();
        if (!live.current) return;
        if (remaining <= 0) void closeAndCheck('expired');
        else timer = setTimeout(schedule, Math.min(remaining, 2147483647));
      };
      if (Date.parse(claim.claimExpiresAt) > Date.now()) {
        const value = createRecoveryBridgeNonce(); frameNonce.current = value; setNonce(value);
      }
      schedule();
    }).catch(error => { if (subscribed && live.current) finish(false, openFailure(error)); });
    return cleanup;
  }, [jobId, close, initialize, requestVerification, stopFrame]);

  return { nonce, setFrame, onLoad: initialize, close };
}
