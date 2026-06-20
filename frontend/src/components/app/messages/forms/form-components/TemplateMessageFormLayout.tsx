import { type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { TemplateFieldGrid } from "./TemplateFieldGrid";

export interface TemplateMessageFormLayoutArgs {
  fields: ReactNode;
  messageCard: ReactNode;
  requiresRecipientName: boolean;
}

export type TemplateMessageFormLayout = (args: TemplateMessageFormLayoutArgs) => ReactNode;

interface TemplateMessageFormFrameProps {
  dataComponent: string;
  className?: string;
  fields: ReactNode;
  messageCard: ReactNode;
  requiresRecipientName?: boolean;
  renderLayout?: TemplateMessageFormLayout;
}

export function TemplateMessageFormFrame({
  dataComponent,
  className,
  fields,
  messageCard,
  requiresRecipientName = false,
  renderLayout,
}: TemplateMessageFormFrameProps) {
  if (renderLayout) {
    return <>{renderLayout({ fields, messageCard, requiresRecipientName })}</>;
  }

  return (
    <div data-component={dataComponent} className={cn("flex flex-col gap-4 animate-fade-in", className)}>
      {fields ? <TemplateFieldGrid>{fields}</TemplateFieldGrid> : null}
      {messageCard}
    </div>
  );
}
