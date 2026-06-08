import { memo, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Copy } from "lucide-react";

import { InfoCard, InfoRow } from "@/components/app/v3";
import { Button } from "@/components/ui/button";

import { MsgField } from "./MsgField";

export interface GeneratedMsgMetaItem {
  label: string;
  value: ReactNode;
}

export interface GeneratedMsgVariableItem {
  token: string;
  label: string;
  value: string;
}

interface GeneratedMsgProps {
  title: string;
  copyButtonText: string;
  message: string;
  onMessageChange?: (value: string) => void;
  handleCopy: () => void;
  children?: ReactNode;
  bodyTitle?: string;
  bodyDescription?: string;
  metaTitle?: string;
  metaItems?: GeneratedMsgMetaItem[];
  variableTitle?: string;
  variableItems?: GeneratedMsgVariableItem[];
  variableEmptyText?: string;
}

export const GeneratedMsg = memo(function GeneratedMsg({
  title,
  copyButtonText,
  message,
  onMessageChange,
  handleCopy,
  children,
  bodyTitle = "메시지 본문",
  bodyDescription = "생성된 문구를 바로 검토하고 수정한 뒤 복사할 수 있습니다.",
  metaTitle = "메시지 정보",
  metaItems,
  variableTitle = "변수",
  variableItems,
  variableEmptyText = "변수 정보가 없습니다.",
}: GeneratedMsgProps) {
  const fallbackMetaItems: GeneratedMsgMetaItem[] = [
    { label: "구성 영역", value: title },
    { label: "메시지 길이", value: `${message.length}자` },
    { label: "문단 수", value: `${message.split("\n").filter((line) => line.trim().length > 0).length}개` },
    { label: "편집 상태", value: onMessageChange ? "수정 가능" : "읽기 전용" },
  ];
  const resolvedMetaItems = metaItems?.length ? metaItems : fallbackMetaItems;
  const hasVariableItems = Boolean(variableItems?.length);

  return (
    <motion.div
      initial={{ opacity: 0, filter: "blur(10px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.8 }}
      data-component="messages-generated-msg-panel"
      className=""
    >
      <div data-component="messages-generated-msg-detail" className="space-y-4">
        <div
          data-component="messages-generated-msg-detail-grid"
          className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]"
        >
          <div
            data-component="messages-generated-msg-detail-content"
            className="scrollbar-hide flex flex-col rounded-[20px] border border-v3-border bg-v3-dim-white/30 p-5"
          >
            <div
              data-component="messages-generated-msg-detail-content-header"
              className="mb-4 flex items-start justify-between gap-4"
            >
              <div data-component="messages-generated-msg-detail-content-title" className="min-w-0">
                <h3 className="text-[0.9rem] font-bold text-v3-dark">{bodyTitle}</h3>
                <p className="mt-0.5 text-[0.75rem] text-v3-text-muted">{bodyDescription}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 rounded-full px-3"
                onClick={handleCopy}
                data-component="messages-generated-msg-copy"
              >
                <Copy className="h-4 w-4" />
                {copyButtonText}
              </Button>
            </div>

            <div
              data-component="messages-generated-msg-detail-content-body"
              className="flex min-h-[320px] flex-1 rounded-[18px] border border-v3-border bg-white p-4"
            >
              <MsgField value={message} onChange={onMessageChange} />
            </div>
          </div>

          <div
            data-component="messages-generated-msg-detail-side"
            className="flex flex-col gap-3 self-start"
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
        </div>

        {children ? (
          <div
            data-component="messages-generated-msg-actions"
            className="rounded-[20px] border border-v3-border bg-white p-5"
          >
            {children}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
});
