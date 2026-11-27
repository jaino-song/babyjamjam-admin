"use client";

import { useId } from "react";

import { Alert } from "@/components/ui/alert";
import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { InputField } from "@/components/app/v3";
import type { useSendClientReceipt } from "@/hooks/use-send-client-receipt";

type ReceiptDialog = NonNullable<ReturnType<typeof useSendClientReceipt>["dialog"]>;

export function SendClientReceiptDialog({
  "data-component": dataComponent,
  dialog,
}: { "data-component": string; dialog: ReceiptDialog }) {
  const inputId = useId();
  const fieldComponent = `${dataComponent}_body_received-date`;
  const errorComponent = `${dataComponent}_body_error`;

  return (
    <ApprovalTwoButtonModal
      data-component={dataComponent}
      open
      onOpenChange={(open) => { if (!open) dialog.dismiss(); }}
      title="본인부담금 영수증 발송"
      description="본인부담금 납부일을 입력한 뒤 전송해 주세요."
      approvalLabel="전송"
      pendingLabel="영수증 발송 요청 중"
      isPending={dialog.isPending}
      approvalDisabled={!dialog.canSubmit}
      onApprove={dialog.submit}
      size="detail"
    >
      <InputField
        data-component={fieldComponent}
        title="본인부담금 납부일"
        inputProps={{
          "data-component": `${fieldComponent}_input`,
          id: inputId,
          type: "text",
          inputMode: "numeric",
          placeholder: "YYYY-MM-DD",
          value: dialog.date,
          onChange: (event) => dialog.editDate(event.target.value),
          disabled: dialog.isPending,
        }}
      />
      {dialog.error ? (
        <Alert
          data-component={errorComponent}
          dataComponents={{ icon: `${errorComponent}_icon`, content: `${errorComponent}_content` }}
          variant="destructive"
          className="mt-2"
        >
          {dialog.error}
        </Alert>
      ) : null}
    </ApprovalTwoButtonModal>
  );
}
