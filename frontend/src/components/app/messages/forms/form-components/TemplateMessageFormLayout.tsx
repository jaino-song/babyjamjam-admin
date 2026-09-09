import { type ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { ReceiptLinkPreparation as ReceiptLinkPreparationResponse } from "@/services/api";
import { TemplateFieldGrid } from "./TemplateFieldGrid";

export type TemplateMessageDeliveryMode = "sms" | "service-feedback-link" | "receipt-link";

export interface ServiceRecordLinkPreparation {
  scheduleId: number;
  serviceStartDate: string;
  serviceRecordUrl: string;
  preparedLinkToken: string;
  expiresAt: string;
  recipientPhone: string;
}

export type ReceiptLinkPreparation = ReceiptLinkPreparationResponse;

export interface TemplateMessageFormLayoutArgs {
  fields: ReactNode;
  messageCard: ReactNode;
  requiresRecipientName: boolean;
  deliveryMode: TemplateMessageDeliveryMode;
  serviceRecordLinkPreparation?: ServiceRecordLinkPreparation | null;
  receiptLinkPreparation?: ReceiptLinkPreparation | null;
}

export type TemplateMessageFormLayout = (args: TemplateMessageFormLayoutArgs) => ReactNode;

interface TemplateMessageFormFrameProps {
  dataComponent: string;
  className?: string;
  fields: ReactNode;
  fieldsLayout?: "grid" | "stack";
  messageCard: ReactNode;
  requiresRecipientName?: boolean;
  deliveryMode?: TemplateMessageDeliveryMode;
  serviceRecordLinkPreparation?: ServiceRecordLinkPreparation | null;
  receiptLinkPreparation?: ReceiptLinkPreparation | null;
  renderLayout?: TemplateMessageFormLayout;
}

export function TemplateMessageFormFrame({
  dataComponent,
  className,
  fields,
  fieldsLayout = "grid",
  messageCard,
  requiresRecipientName = false,
  deliveryMode = "sms",
  serviceRecordLinkPreparation,
  receiptLinkPreparation,
  renderLayout,
}: TemplateMessageFormFrameProps) {
  if (renderLayout) {
    return <>{renderLayout({
      fields,
      messageCard,
      requiresRecipientName,
      deliveryMode,
      serviceRecordLinkPreparation,
      receiptLinkPreparation,
    })}</>;
  }

  return (
    <div data-component={dataComponent} className={cn("flex flex-col gap-4 animate-fade-in", className)}>
      {fields ? <TemplateFieldGrid layout={fieldsLayout}>{fields}</TemplateFieldGrid> : null}
      {messageCard}
    </div>
  );
}
