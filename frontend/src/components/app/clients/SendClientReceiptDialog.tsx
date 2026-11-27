"use client";

import { useId } from "react";

import { Alert } from "@/components/ui/alert";
import { FormField, FormTextInput } from "@/components/app/ui/form-section";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import type { useSendClientReceipt } from "@/features/clients/hooks/use-send-client-receipt";

type ReceiptDialog = NonNullable<ReturnType<typeof useSendClientReceipt>["dialog"]>;

export function SendClientReceiptDialog({
  "data-component": dataComponent,
  dialog,
}: { "data-component": string; dialog: ReceiptDialog }) {
  const inputId = useId();
  const fieldComponent = `${dataComponent}_body_received-date`;

  return (
    <TwoButtonModal
      data-component={dataComponent}
      open
      onOpenChange={(open) => { if (!open) dialog.dismiss(); }}
      title="본인부담금 영수증 발송"
      description="본인부담금 납부일을 입력한 뒤 전송해 주세요."
      approvalLabel="전송"
      pendingLabel="영수증 발송 요청 중"
      isPending={dialog.isPending}
      approvalDisabled={!dialog.canSubmit}
      onApprove={() => void dialog.submit()}
      size="detail"
    >
      <FormField data-component={fieldComponent} htmlFor={inputId} label="본인부담금 납부일">
        <FormTextInput
          data-component={`${fieldComponent}_input`}
          id={inputId}
          type="text"
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          value={dialog.date}
          onChange={(event) => dialog.editDate(event.target.value)}
          disabled={dialog.isPending}
        />
      </FormField>
      {dialog.error ? (
        <Alert data-component={`${dataComponent}_body_error`} variant="destructive" className="mt-2">
          {dialog.error}
        </Alert>
      ) : null}
    </TwoButtonModal>
  );
}
