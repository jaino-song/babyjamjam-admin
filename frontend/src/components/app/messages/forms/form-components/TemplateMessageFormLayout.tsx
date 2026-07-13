import { type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { TemplateFieldGrid } from "./TemplateFieldGrid";

export type TemplateMessageDeliveryMode = "sms" | "service-feedback-link";

export interface ServiceFeedbackLinkPreparation {
  scheduleId: number;
  feedbackUrl: string;
  preparedLinkToken: string;
  expiresAt: string;
}

export interface TemplateMessageFormLayoutArgs {
  fields: ReactNode;
  messageCard: ReactNode;
  requiresRecipientName: boolean;
  deliveryMode: TemplateMessageDeliveryMode;
  serviceFeedbackLinkPreparation?: ServiceFeedbackLinkPreparation | null;
}

export type TemplateMessageFormLayout = (args: TemplateMessageFormLayoutArgs) => ReactNode;

interface TemplateMessageFormFrameProps {
  dataComponent: string;
  className?: string;
  fields: ReactNode;
  messageCard: ReactNode;
  requiresRecipientName?: boolean;
  deliveryMode?: TemplateMessageDeliveryMode;
  serviceFeedbackLinkPreparation?: ServiceFeedbackLinkPreparation | null;
  renderLayout?: TemplateMessageFormLayout;
}

export function TemplateMessageFormFrame({
  dataComponent,
  className,
  fields,
  messageCard,
  requiresRecipientName = false,
  deliveryMode = "sms",
  serviceFeedbackLinkPreparation,
  renderLayout,
}: TemplateMessageFormFrameProps) {
  if (renderLayout) {
    return <>{renderLayout({
      fields,
      messageCard,
      requiresRecipientName,
      deliveryMode,
      serviceFeedbackLinkPreparation,
    })}</>;
  }

  return (
    <div data-component={dataComponent} className={cn("flex flex-col gap-4 animate-fade-in", className)}>
      {fields ? <TemplateFieldGrid>{fields}</TemplateFieldGrid> : null}
      {messageCard}
    </div>
  );
}
