"use client";
import { useSyncExternalStore } from 'react';
import { FormDialogShell } from '@/components/app/ui/FormDialogShell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useManualDocumentJobRecovery } from '@/features/document-jobs/useManualDocumentJobRecovery';
import { RECOVERY_BRIDGE_PATH } from '@/lib/eformsign/recovery-bridge';
import { useIsMobile } from '@/hooks/useIsMobile';

export interface ManualDocumentJobRecoveryDialogProps {
  jobId: string; onClose: () => void; 'data-component'?: string; onCloseAutoFocus?: (event: Event) => void;
}
function subscribeViewport(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}
function viewportSnapshot(): 'desktop' | 'mobile' {
  // Match useIsMobile's lg breakpoint while guarding its initial false value.
  return window.innerWidth < 1024 ? 'mobile' : 'desktop';
}
function focusJobsTrigger(event: Event) {
  const trigger = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="document-jobs-trigger"]'))
    .find(node => node.isConnected && !node.closest('[inert]') && !node.hasAttribute('disabled'));
  if (trigger) { event.preventDefault(); trigger.focus({ preventScroll: true }); }
}
export function ManualDocumentJobRecoveryDialog(props: ManualDocumentJobRecoveryDialogProps) {
  const isMobile = useIsMobile();
  const viewport = useSyncExternalStore<'pending' | 'desktop' | 'mobile'>(subscribeViewport, viewportSnapshot, () => 'pending');
  const onCloseAutoFocus = props.onCloseAutoFocus ?? focusJobsTrigger;
  if (viewport === 'pending') return null;
  if (isMobile || viewport === 'mobile') {
    const base = props['data-component'];
    return <Dialog open onOpenChange={open => { if (!open) props.onClose(); }}>
      <FormDialogShell size="compact" title="전자문서 수동 처리" description="PC에서 수동 전송 화면을 확인해 주세요."
        data-component={base} onCloseAutoFocus={onCloseAutoFocus}
        footer={<Button variant="neutral" data-component={base ? `${base}_close` : undefined} onClick={props.onClose}>닫기</Button>}>
        <Alert data-component={base ? `${base}_mobile-notice` : undefined}><AlertDescription>수동 전송은 PC에서 확인해 주세요.</AlertDescription></Alert>
      </FormDialogShell>
    </Dialog>;
  }
  return <DesktopManualDocumentJobRecoveryDialog {...props} onCloseAutoFocus={onCloseAutoFocus} />;
}
function DesktopManualDocumentJobRecoveryDialog({ jobId, onClose, onCloseAutoFocus, 'data-component': base }: ManualDocumentJobRecoveryDialogProps) {
  const { session, nonce, status, notice, busy, setFrame, onLoad, verify, close: closeSession } = useManualDocumentJobRecovery(jobId);
  const sub = (suffix: string) => base ? `${base}_${suffix}` : undefined;
  const close = () => { closeSession(); onClose(); };
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <FormDialogShell size="recovery" title="전자문서 수동 처리" description="전자문서 화면에서 처리한 뒤 서버에서 결과를 확인합니다."
      data-component={base} onCloseAutoFocus={onCloseAutoFocus}
      footer={<>
        <Button variant="neutral" onClick={close} data-component={sub('close')}>닫기</Button>
        {session && status !== 'verified' ? <Button onClick={() => void verify()} disabled={busy} data-component={sub('verify')}>
          {busy ? '확인 중…' : '결과 확인'}
        </Button> : null}
      </>}>
      <div data-component={sub('body')} data-slot="manual-recovery-body" data-source-component="ManualDocumentJobRecoveryDialog" className="flex h-full min-h-0 flex-col gap-3">
        {status === 'loading' ? <div role="status" aria-label="작업 불러오는 중"><Spinner size="sm" /></div> : null}
        <Alert data-component={sub('notice')}><AlertDescription>{notice}</AlertDescription></Alert>
        {nonce ? <iframe ref={setFrame} src={`${RECOVERY_BRIDGE_PATH}#${nonce}`} title="이폼사인 수동 전송"
          sandbox="allow-scripts allow-same-origin allow-forms" onLoad={onLoad}
          data-component={sub('frame')} data-slot="manual-recovery-frame" data-source-component="ManualDocumentJobRecoveryDialog"
          className="min-h-0 w-full flex-1 border-0" /> : null}
      </div>
    </FormDialogShell>
  </Dialog>;
}
