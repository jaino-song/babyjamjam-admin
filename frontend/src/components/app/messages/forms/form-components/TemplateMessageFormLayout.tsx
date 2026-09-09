import { type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { TemplateFieldGrid } from "./TemplateFieldGrid";

export type TemplateMessageDeliveryMode = "sms" | "service-feedback-link";

export interface ServiceRecordLinkPreparation {
  scheduleId: number;
  serviceStartDate: string;
  serviceRecordUrl: string;
  preparedLinkToken: string;
  expiresAt: string;
  recipientPhone: string;
}

export interface TemplateMessageFormLayoutArgs {
  fields: ReactNode;
  messageCard: ReactNode;
  requiresRecipientName: boolean;
  deliveryMode: TemplateMessageDeliveryMode;
  serviceRecordLinkPreparation?: ServiceRecordLinkPreparation | null;
  /** False while the branch-effective system template is loading or failed. */
  templateReady?: boolean;
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
  templateReady?: boolean;
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
  templateReady = true,
  renderLayout,
}: TemplateMessageFormFrameProps) {
  if (renderLayout) {
    return <>{renderLayout({
      fields,
      messageCard,
      requiresRecipientName,
      deliveryMode,
      serviceRecordLinkPreparation,
      templateReady,
    })}</>;
  }

  return (
    <div data-component={dataComponent} className={cn("flex flex-col gap-4 animate-fade-in", className)}>
      {fields ? <TemplateFieldGrid layout={fieldsLayout}>{fields}</TemplateFieldGrid> : null}
      {messageCard}
    </div>
  );
}
