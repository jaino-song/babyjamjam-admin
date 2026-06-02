"use client";

import { useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, MessageCircle, X } from "lucide-react";

import { useMessageTemplates } from "@/hooks/use-message-templates";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

import styles from "./page.module.css";

interface SendResponse {
  result?: string;
  message?: string;
}

interface RecipientChip {
  id: string;
  name: string;
  phone: string;
  initial: string;
  tone: "primary" | "orange";
}

interface TemplateOption {
  id: string;
  name: string;
  meta: string;
  body: string;
}

type Channel = "alimtalk" | "sms";

const PHONE_REGEX = /^[0-9,\-\s]+$/;
const MAX_BODY = 2000;
const MAX_TITLE = 44;

const DEFAULT_BODY = `안녕하세요 #{clientName} 고객님,

내일 오전 9시 #{employeeName} 매니저가 방문 예정입니다. 준비물은 별도로 안내드린 사항을 참고해 주세요.

문의사항이 있으시면 언제든지 연락 주세요.

아가잼잼 #{branchName}`;

const DEFAULT_RECIPIENTS: RecipientChip[] = [
  {
    id: "park-seoyeon",
    name: "박서연",
    phone: "010-1234-5678",
    initial: "박",
    tone: "primary",
  },
  {
    id: "kim-doyoon",
    name: "김도윤",
    phone: "010-2345-6789",
    initial: "김",
    tone: "orange",
  },
];

const FALLBACK_TEMPLATE_OPTIONS: TemplateOption[] = [
  {
    id: "service-start-d-1",
    name: "서비스 시작 D-1 안내",
    meta: "서비스 시작 (D-1)",
    body: DEFAULT_BODY,
  },
  {
    id: "visit-change",
    name: "방문 일정 변경 안내",
    meta: "사용자 작성",
    body: "방문 일정이 변경되어 안내드립니다. 확인 후 문의사항이 있으시면 연락 주세요.",
  },
  {
    id: "satisfaction",
    name: "서비스 만족도 조사",
    meta: "사용자 작성",
    body: "서비스 이용 경험에 대한 만족도 조사를 부탁드립니다. 소중한 의견은 서비스 개선에 반영하겠습니다.",
  },
  {
    id: "custom",
    name: "직접 작성",
    meta: "템플릿 없이 작성",
    body: "",
  },
];

const VARIABLE_CHIPS = ["#{clientName}", "#{employeeName}", "#{serviceStartDate}", "#{branchName}"] as const;

function normalizePhone(raw: string) {
  return raw.replace(/[^0-9\-,]/g, "");
}

function hasUnreplacedVariables(text: string) {
  return /#\{[^}]+\}/.test(text);
}

function buildPreview(body: string) {
  return body
    .replaceAll("#{clientName}", "박서연")
    .replaceAll("#{employeeName}", "김민지")
    .replaceAll("#{serviceStartDate}", "내일")
    .replaceAll("#{branchName}", "인천점");
}

export default function NewMessagePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialBody = searchParams.get("body") ?? DEFAULT_BODY;
  const initialTemplateId = searchParams.get("template") ?? FALLBACK_TEMPLATE_OPTIONS[0].id;
  const initialClientId = Number(searchParams.get("clientId"));

  const [channel, setChannel] = useState<Channel>("alimtalk");
  const [receiver, setReceiver] = useState("");
  const [recipients, setRecipients] = useState<RecipientChip[]>(DEFAULT_RECIPIENTS);
  const [recipientName, setRecipientName] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState(initialBody);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(initialTemplateId);

  const { data: userTemplates = [] } = useMessageTemplates();

  const templateOptions = useMemo<TemplateOption[]>(() => {
    const userOptions = userTemplates.slice(0, 2).map((template) => ({
      id: template.id,
      name: template.name,
      meta: "사용자 작성",
      body: template.content,
    }));

    return [
      FALLBACK_TEMPLATE_OPTIONS[0],
      userOptions[0] ?? FALLBACK_TEMPLATE_OPTIONS[1],
      userOptions[1] ?? FALLBACK_TEMPLATE_OPTIONS[2],
      FALLBACK_TEMPLATE_OPTIONS[3],
    ];
  }, [userTemplates]);

  const receiverPayload = useMemo(() => {
    if (recipients.length > 0) {
      return recipients.map((recipient) => recipient.phone).join(",");
    }
    return receiver.trim();
  }, [receiver, recipients]);

  const showVariableHint = useMemo(() => hasUnreplacedVariables(body), [body]);
  const previewBody = useMemo(() => buildPreview(body), [body]);

  const validationError = useMemo(() => {
    if (!receiverPayload) return "수신자를 입력해 주세요.";
    if (!PHONE_REGEX.test(receiverPayload)) return "수신자 연락처 형식이 올바르지 않습니다. (숫자, '-', ',' 만 허용)";
    if (!body.trim()) return "메시지 본문을 입력해 주세요.";
    if (body.length > MAX_BODY) return `본문은 최대 ${MAX_BODY}자까지 입력할 수 있습니다.`;
    if (title.length > MAX_TITLE) return `제목은 최대 ${MAX_TITLE}자까지 입력할 수 있습니다.`;
    return null;
  }, [receiverPayload, body, title]);

  const sendMutation = useMutation<SendResponse, unknown, void>({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        receiver: receiverPayload,
        message: body.trim(),
        triggerType: "immediate",
      };
      if (Number.isFinite(initialClientId) && initialClientId > 0) payload.clientId = initialClientId;
      if (title.trim()) payload.title = title.trim();
      if (recipientName.trim()) payload.recipientName = recipientName.trim();
      const res = await api.post<SendResponse>("/message-deliveries/sms", payload);
      return res.data;
    },
    onSuccess: () => {
      setErrorMessage(null);
      setSuccessMessage("메시지 발송 요청이 접수되었습니다.");
      setReceiver("");
      setRecipients([]);
      setRecipientName("");
      setTitle("");
      setBody("");
    },
    onError: (err) => {
      setSuccessMessage(null);
      if (isAxiosError<{ error?: string; message?: string | string[] }>(err)) {
        const data = err.response?.data;
        const msg = Array.isArray(data?.message) ? data?.message.join(", ") : data?.message;
        setErrorMessage(msg ?? data?.error ?? "발송에 실패했습니다.");
        return;
      }
      setErrorMessage("발송에 실패했습니다.");
    },
  });

  const addManualRecipient = () => {
    const normalized = normalizePhone(receiver);
    if (!normalized || !PHONE_REGEX.test(normalized)) return;
    setRecipients((current) => [
      ...current,
      {
        id: `manual-${normalized}-${current.length}`,
        name: recipientName.trim() || normalized,
        phone: normalized,
        initial: recipientName.trim().slice(0, 1) || "수",
        tone: "primary",
      },
    ]);
    setReceiver("");
    setRecipientName("");
  };

  const handleTemplateSelect = (option: TemplateOption) => {
    setSelectedTemplateId(option.id);
    setBody(option.body);
  };

  const insertVariable = (variable: string) => {
    setBody((current) => `${current}${current.endsWith("\n") || !current ? "" : " "}${variable}`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError || sendMutation.isPending) {
      if (validationError) setErrorMessage(validationError);
      return;
    }
    sendMutation.mutate();
  };

  const primaryActionLabel =
    recipients.length > 0 ? `${recipients.length}명에게 발송` : "즉시 발송";

  return (
    <section data-component="messages-new-page" className={styles.pageRoot}>
      <div data-component="messages-new-screen" className={styles.phoneScreen}>
        <form data-component="messages-new-form" onSubmit={handleSubmit} className={styles.navPage}>
          <header data-component="messages-new-header" className={styles.detailHeader}>
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="메시지 목록으로 돌아가기"
              className={styles.detailBack}
            >
              <ChevronLeft aria-hidden="true" size={22} strokeWidth={2.5} />
              <span>메시지</span>
            </button>
            <div data-component="messages-new-title" className={styles.detailTitle}>새 메시지</div>
          </header>

          <div data-component="messages-new-scroll" className={styles.msgScroll}>
            <section data-component="messages-new-recipient-card" className={styles.formCard}>
              <div data-component="messages-new-recipient-row" className={styles.formRow}>
                <label htmlFor="receiver" className={styles.formLabel}>
                  수신자 <span className={styles.required}>*</span>
                </label>
                <input
                  id="receiver"
                  type="tel"
                  inputMode="numeric"
                  placeholder="고객 이름, 연락처 검색"
                  autoComplete="off"
                  value={receiver}
                  onBlur={addManualRecipient}
                  onChange={(e) => setReceiver(normalizePhone(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addManualRecipient();
                    }
                  }}
                  className={styles.formInput}
                />
                <div data-component="messages-new-recipient-chips" className={styles.recipientChips}>
                  {recipients.map((recipient) => (
                    <span key={recipient.id} className={styles.recipientChip}>
                      <span className={cn(styles.recipientChipAvatar, styles[`recipient_${recipient.tone}`])}>
                        {recipient.initial}
                      </span>
                      {recipient.name}
                      <button
                        type="button"
                        aria-label={`${recipient.name} 수신자 제거`}
                        className={styles.recipientChipX}
                        onClick={() => setRecipients((current) => current.filter((item) => item.id !== recipient.id))}
                      >
                        <X aria-hidden="true" size={10} strokeWidth={3} />
                      </button>
                    </span>
                  ))}
                </div>
                <div data-component="messages-new-recipient-helper" className={styles.formHelper}>총 {recipients.length}명 선택됨 · 한 번에 최대 50명까지 발송 가능</div>
              </div>
            </section>

            <section data-component="messages-new-template-card" className={styles.formCard}>
              <div data-component="messages-new-channel-row" className={styles.formRow}>
                <span className={styles.formLabel}>채널</span>
                <div data-component="messages-new-channel-options" className={styles.channelToggleRow}>
                  <button
                    type="button"
                    className={cn(styles.channelToggle, channel === "alimtalk" && styles.channelSelected)}
                    onClick={() => setChannel("alimtalk")}
                  >
                    <MessageCircle aria-hidden="true" size={14} strokeWidth={2.5} />
                    알림톡
                  </button>
                  <button
                    type="button"
                    className={cn(styles.channelToggle, channel === "sms" && styles.channelSelected)}
                    onClick={() => setChannel("sms")}
                  >
                    <MessageCircle aria-hidden="true" size={14} strokeWidth={2.5} />
                    SMS
                  </button>
                </div>
              </div>

              <div data-component="messages-new-template-row" className={styles.formRow}>
                <span className={styles.formLabel}>템플릿 선택</span>
                <div data-component="messages-new-template-list" className={styles.templatePickList}>
                  {templateOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={cn(styles.templatePick, selectedTemplateId === option.id && styles.templateSelected)}
                      onClick={() => handleTemplateSelect(option)}
                    >
                      <span className={styles.templatePickRadio} />
                      <span className={styles.templatePickInfo}>
                        <span className={styles.templatePickName}>{option.name}</span>
                        <span className={styles.templatePickMeta}>{option.meta}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section data-component="messages-new-body-card" className={styles.formCard}>
              <div data-component="messages-new-body-row" className={styles.formRow}>
                <label htmlFor="body" className={styles.formLabel}>
                  메시지 본문
                </label>
                <textarea
                  id="body"
                  maxLength={MAX_BODY}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className={styles.formTextarea}
                />
                <div data-component="messages-new-body-helper" className={styles.formHelper}>변수는 수신자 정보로 자동 치환됩니다. 칩을 탭하면 본문에 삽입됩니다.</div>
                <div data-component="messages-new-variable-chips" className={styles.variableChips}>
                  {VARIABLE_CHIPS.map((variable) => (
                    <button
                      key={variable}
                      type="button"
                      className={styles.variableChip}
                      onClick={() => insertVariable(variable)}
                    >
                      {variable}
                    </button>
                  ))}
                </div>
                {showVariableHint ? (
                  <p data-component="messages-new-variable-hint" className={styles.screenReaderNote}>
                    템플릿 변수가 포함되어 있습니다.
                  </p>
                ) : null}
              </div>
            </section>

            <section data-component="messages-new-preview-card" className={styles.formCard}>
              <div data-component="messages-new-preview-title" className={styles.infoCardTitle}>미리보기 · 박서연 기준</div>
              <div data-component="messages-new-preview-body" className={styles.previewCard}>
                <div data-component="messages-new-preview-label" className={styles.previewCardLabel}>{channel === "alimtalk" ? "알림톡" : "SMS"} 미리보기</div>
                {previewBody}
              </div>
            </section>

            {errorMessage ? (
              <div data-component="messages-new-error" className={styles.errorCard}>
                {errorMessage}
              </div>
            ) : null}

            {successMessage ? (
              <div data-component="messages-new-success" className={styles.successCard}>
                {successMessage}
              </div>
            ) : null}
          </div>

          <div data-component="messages-new-actions" className={styles.msgActions}>
            <button type="button" className={cn(styles.msgButton, styles.secondaryButton)}>
              임시저장
            </button>
            <button
              type="submit"
              data-component="messages-new-submit"
              disabled={sendMutation.isPending}
              className={cn(styles.msgButton, styles.primaryButton)}
            >
              {sendMutation.isPending ? "발송 중..." : primaryActionLabel}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
