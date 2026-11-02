'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getUserErrorMessage } from '@babyjamjam/shared';

import { messageTriggerKeys } from '@/features/message-triggers/hooks/keys';
import { useToast } from '@/hooks/use-toast';
import { describeReceiptLinkError } from '@/lib/receipt-link';
import { eformsignApi } from '@/services/api';

export function useSendClientReceipt(): {
  isSending: boolean;
  sendReceipt: (clientId: number) => Promise<void>;
} {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSending, setIsSending] = useState(false);
  const sendingRef = useRef(false);

  const sendReceipt = async (clientId: number): Promise<void> => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setIsSending(true);

    try {
      // 클릭한 고객을 고정하고 서버가 준비한 문서와 수신자를 함께 검증한다.
      const prepared = await eformsignApi.prepareReceiptLink(clientId);
      if (prepared.clientId !== clientId || !prepared.documentId || !prepared.recipientPhone) {
        throw new Error('Receipt preparation identity mismatch');
      }
      const result = await eformsignApi.sendReceiptLink(prepared.documentId, {
        clientId,
        recipientPhone: prepared.recipientPhone,
      });
      // 서버가 방금 만든 대기 job이 30초 폴링을 기다리지 않고 알림 발송 목록에 바로 보이게 한다.
      void queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
      void queryClient.invalidateQueries({ queryKey: messageTriggerKeys.clientHistory(clientId) });
      toast({
        variant: 'success',
        title: '본인부담금 영수증 발송 예약',
        description: `${result.clientName} 산모님께 서비스 종료 안내가 1분 내 발송됩니다.`,
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '본인부담금 영수증 발송 실패',
        description: getUserErrorMessage(describeReceiptLinkError(error)),
      });
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  };

  return { isSending, sendReceipt };
}
