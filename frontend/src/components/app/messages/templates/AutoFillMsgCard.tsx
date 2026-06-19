import { memo, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Copy } from "lucide-react";

import { HeaderActionButton, InfoCard, InfoRow } from "@/components/app/v3";
import { cn } from "@/lib/utils";

import { MsgField } from "./MsgField";

export interface AutoFillMsgCardMetaItem {
  label: string;
  value: ReactNode;
}

export interface AutoFillMsgCardVariableItem {
  token: string;
  label: string;
  value: string;
}

export type AutoFillMsgCardLayout = "grouped" | "flat";

export interface AutoFillMsgCardProps {
  title: string;
  copyButtonText: string;
  message: string;
  onMessageChange?: (value: string) => void;
  handleCopy: () => void;
  children?: ReactNode;
  bodyTitle?: string;
  bodyDescription?: string;
  metaTitle?: string;
  metaItems?: AutoFillMsgCardMetaItem[];
  variableTitle?: string;
  variableItems?: AutoFillMsgCardVariableItem[];
  variableEmptyText?: string;
  layout?: AutoFillMsgCardLayout;
  showSide?: boolean;
}

export interface AutoFillMsgCardSideProps {
  title: string;
  message: string;
  onMessageChange?: (value: string) => void;
  metaTitle?: string;
  metaItems?: AutoFillMsgCardMetaItem[];
  variableTitle?: string;
  variableItems?: AutoFillMsgCardVariableItem[];
  variableEmptyText?: string;
  className?: string;
}

export function AutoFillMsgCardSide({
  title,
  message,
  onMessageChange,
  metaTitle = "메시지 정보",
  metaItems,
  variableTitle = "변수",
  variableItems,
  variableEmptyText = "변수 정보가 없습니다.",
  className,
}: AutoFillMsgCardSideProps) {
  const fallbackMetaItems: AutoFillMsgCardMetaItem[] = [
    { label: "구성 영역", value: title },
    { label: "메시지 길이", value: `${message.length}자` },
    { label: "문단 수", value: `${message.split("\n").filter((line) => line.trim().length > 0).length}개` },
    { label: "편집 상태", value: onMessageChange ? "수정 가능" : "읽기 전용" },
  ];
  const resolvedMetaItems = metaItems?.length ? metaItems : fallbackMetaItems;
  const hasVariableItems = Boolean(variableItems?.length);

  return (
    <div
      data-component="messages-generated-msg-detail-side"
      className={cn("flex flex-col gap-3 self-start", className)}
    >
      <InfoCard
        data-component="messages-generated-msg-detail-meta"
        title={metaTitle}
        className="h-fit"
      >
        <div
          data-component="messages-generated-msg-detail-meta-list"
          className="-mt-1"
        >
          {resolvedMetaItems.map((item) => (
            <InfoRow
              key={`${item.label}`}
              data-component="messages-generated-msg-detail-meta-item"
              label={item.label}
              value={item.value}
            />
          ))}
        </div>
      </InfoCard>

      <InfoCard
        data-component="messages-generated-msg-detail-variables"
        title={variableTitle}
        className="h-fit"
      >
        <div
          data-component="messages-generated-msg-detail-variables-body"
          className="-mt-1"
        >
          {hasVariableItems ? (
            <div
              data-component="messages-generated-msg-detail-variable-list"
              className="space-y-1"
            >
              {variableItems?.map((item) => (
                <div
                  key={`${item.token}-${item.label}`}
                  data-component="messages-generated-msg-detail-variable-item"
                  className="flex items-center justify-between gap-3 border-b border-v3-border py-2.5 text-[0.75rem] last:border-b-0"
                >
                  <div
                    data-component="messages-generated-msg-detail-variable-meta"
                    className="flex min-w-0 flex-wrap items-center gap-2"
                  >
                    <span
                      data-component="messages-generated-msg-detail-variable-label"
                      className="text-v3-text-muted"
                    >
                      {item.label}
                    </span>
                    <span
                      data-component="messages-generated-msg-detail-variable-token"
                      className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
                    >
                      {item.token}
                    </span>
                  </div>
                  <p
                    data-component="messages-generated-msg-detail-variable-value"
                    className="shrink-0 text-right text-[0.75rem] font-semibold text-v3-dark"
                  >
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[0.75rem] text-v3-text-muted">{variableEmptyText}</p>
          )}
        </div>
      </InfoCard>
    </div>
  );
}

export const AutoFillMsgCard = memo(function AutoFillMsgCard({
  title,
  copyButtonText,
  message,
  onMessageChange,
  handleCopy,
  children,
  bodyTitle = "메시지 본문",
  bodyDescription = "메시지 내용을 수정할 수 있어요.",
  metaTitle = "메시지 정보",
  metaItems,
  variableTitle = "변수",
  variableItems,
  variableEmptyText = "변수 정보가 없습니다.",
  layout = "grouped",
  showSide = true,
}: AutoFillMsgCardProps) {
  const detailGridContent = (
    <>
      <div
        data-component="messages-generated-msg-detail-content"
        className="scrollbar-hide flex h-full min-h-0 flex-col rounded-[20px] bg-v3-dim-white p-5"
      >
        <div
          data-component="messages-generated-msg-detail-content-header"
          className="mb-4 flex items-start justify-between gap-4"
        >
          <div data-component="messages-generated-msg-detail-content-title" className="min-w-0">
            <h3 className="text-[0.9rem] font-bold text-v3-dark">{bodyTitle}</h3>
            <p className="mt-0.5 text-[0.75rem] text-v3-text-muted">{bodyDescription}</p>
          </div>
          <HeaderActionButton
            icon={Copy}
            label={copyButtonText}
            onClick={handleCopy}
            data-component="messages-generated-msg-copy"
            className="text-[12px]"
          />
        </div>

        <div
          data-component="messages-generated-msg-detail-content-body"
          className="flex min-h-[320px] flex-1 rounded-[18px] bg-white p-4"
        >
          <MsgField value={message} onChange={onMessageChange} />
        </div>
      </div>

      {showSide ? (
        <AutoFillMsgCardSide
          title={title}
          message={message}
          onMessageChange={onMessageChange}
          metaTitle={metaTitle}
          metaItems={metaItems}
          variableTitle={variableTitle}
          variableItems={variableItems}
          variableEmptyText={variableEmptyText}
        />
      ) : null}
    </>
  );

  if (layout === "flat") {
    return (
      <>
        {detailGridContent}
        {children ? (
          <div
            data-component="messages-generated-msg-actions"
            className="rounded-[20px] border border-v3-border bg-white p-5 xl:col-span-2"
          >
            {children}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, filter: "blur(10px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.8 }}
      data-component="messages-generated-msg-panel"
      className="min-h-0 space-y-4"
    >
      <div
        data-component="messages-generated-msg-detail-grid"
        className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]"
      >
        {detailGridContent}
      </div>

      {children ? (
        <div
          data-component="messages-generated-msg-actions"
          className="rounded-[20px] border border-v3-border bg-white p-5"
        >
          {children}
        </div>
      ) : null}
    </motion.div>
  );
});
