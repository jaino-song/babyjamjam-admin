"use client";

import { useRef, useState } from "react";
import { getUserErrorMessage } from "@babyjamjam/shared";

import { useToast } from "@/hooks/use-toast";
import { describeReceiptLinkError } from "@/lib/receipt-link";
import { eformsignApi } from "@/services/api";

/**
 * Sends the service-end receipt notification for one selected client.
 *
 * Preparation is intentionally a separate step: the backend resolves the
 * signed document and recipient, and the send request pins that identity so a
 * stale detail selection cannot send a receipt to another client.
 */
export function useSendClientReceipt(): {
  isSending: boolean;
  sendReceipt: (clientId: number) => Promise<void>;
} {
  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);
  const sendingRef = useRef(false);

  const sendReceipt = async (clientId: number): Promise<void> => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setIsSending(true);

    try {
      const prepared = await eformsignApi.prepareReceiptLink(clientId);
      if (prepared.clientId !== clientId || !prepared.documentId || !prepared.recipientPhone) {
        throw new Error("Receipt preparation identity mismatch");
      }

      const result = await eformsignApi.sendReceiptLink(prepared.documentId, {
        clientId,
        recipientPhone: prepared.recipientPhone,
      });

      toast({
        variant: "success",
        title: "본인부담금 영수증 발송 예약",
        description: `${result.clientName} 산모님께 본인부담금 영수증 안내 메시지 발송이 예약되었습니다.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "본인부담금 영수증 발송 실패",
        description: getUserErrorMessage(describeReceiptLinkError(error)),
      });
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  };

  return { isSending, sendReceipt };
}
