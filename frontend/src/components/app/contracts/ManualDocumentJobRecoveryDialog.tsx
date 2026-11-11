"use client";

import { useCallback, useRef, useSyncExternalStore } from 'react';

import { FormDialogShell } from '@/components/app/ui/FormDialogShell';
import { Dialog } from '@/components/ui/dialog';
import { useManualDocumentJobRecovery } from '@/features/document-jobs/useManualDocumentJobRecovery';
import { RECOVERY_BRIDGE_PATH } from '@/lib/eformsign/recovery-bridge';

export interface ManualDocumentJobRecoveryDialogProps {
  jobId: string; onClose: () => void; 'data-component'?: string; onCloseAutoFocus?: (event: Event) => void;
}
const subscribeHydration = () => () => {};
function focusJobsTrigger(event: Event) {
  const trigger = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="document-jobs-trigger"]'))
    .find(node => node.isConnected && !node.closest('[inert]') && !node.hasAttribute('disabled'));
  if (trigger) { event.preventDefault(); trigger.focus({ preventScroll: true }); }
}
export function ManualDocumentJobRecoveryDialog(props: ManualDocumentJobRecoveryDialogProps): React.ReactElement | null {
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  return hydrated ? <EmbeddedManualDocumentJobRecoveryDialog {...props} onCloseAutoFocus={props.onCloseAutoFocus ?? focusJobsTrigger} /> : null;
}
function EmbeddedManualDocumentJobRecoveryDialog({ jobId, onClose, onCloseAutoFocus, 'data-component': base }: ManualDocumentJobRecoveryDialogProps) {
  const dialogMounted = useRef(false);
  const { nonce, setFrame, onLoad, close } = useManualDocumentJobRecovery(jobId, () => {
    onClose();
    // Without a mounted Dialog, Radix cannot restore focus. Wait for the panes to lose inert.
    if (!dialogMounted.current) setTimeout(() => {
      // Radix normally pauses the parent focus trap while the nested Dialog returns focus.
      const keepReturnedFocus = (event: FocusEvent) => event.stopPropagation();
      document.addEventListener('focusin', keepReturnedFocus, true);
      try { onCloseAutoFocus?.(new Event('closeAutoFocus', { cancelable: true })); }
      finally { document.removeEventListener('focusin', keepReturnedFocus, true); }
    }, 0);
  });
  const setEditorFrame = useCallback((node: HTMLIFrameElement | null) => {
    if (node) dialogMounted.current = true;
    setFrame(node);
  }, [setFrame]);
  const sub = (suffix: string) => base ? `${base}_${suffix}` : undefined;
  if (!nonce) return null;
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <FormDialogShell size="recovery" title="전자문서 수동 전송" description="전자문서 화면에서 전송하면 자동으로 닫혀요."
      data-component={base} onCloseAutoFocus={onCloseAutoFocus}>
      <div data-component={sub('body')} data-slot="manual-recovery-body" data-source-component="ManualDocumentJobRecoveryDialog" className="flex h-full min-h-0 flex-col">
        <iframe ref={setEditorFrame} src={`${RECOVERY_BRIDGE_PATH}#${nonce}`} title="이폼사인 수동 전송"
          sandbox="allow-scripts allow-same-origin allow-forms" onLoad={onLoad}
          data-component={sub('frame')} data-slot="manual-recovery-frame" data-source-component="ManualDocumentJobRecoveryDialog"
          className="min-h-0 w-full flex-1 border-0" />
      </div>
    </FormDialogShell>
  </Dialog>;
}
