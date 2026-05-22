"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import Link from "next/link";
import { Bell, FileText, Home, Menu, Plus, Send, Sparkles, Users } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Spinner } from "@/components/ui/spinner";
import { CodeBlock } from "@/components/app/chat/CodeBlock";
import ClientRegistrationWizard, {
  type CreatedClient,
} from "@/components/app/chat/ClientRegistrationWizard";
import ContractSendWizard from "@/components/app/chat/ContractSendWizard";
import ContractStatusWizard, {
  type ContractStatusResult,
} from "@/components/app/chat/ContractStatusWizard";
import { useChatStream, type ChatMessage, type ChatState } from "@/hooks/useChatStream";
import { useInitialUser } from "@/providers/UserProvider";

import styles from "./chat.module.css";

interface ChatDisplayMessage extends ChatMessage {
  id: string;
  sources?: string[];
  timeLabel?: string;
}

const MOCKUP_MESSAGES: ChatDisplayMessage[] = [
  {
    id: "mockup-greeting",
    role: "assistant",
    content: "안녕하세요 송진호 님. 인천점 운영을 돕는 AI 어시스턴트예요. 오늘 어떤 걸 도와드릴까요?",
    timestamp: "2026-05-12T00:14:00.000Z",
    timeLabel: "오전 9:14",
  },
  {
    id: "mockup-user-1",
    role: "user",
    content: "이번 주 시작 예정인 고객들의 제공인력 배정 현황 보여줘",
    timestamp: "2026-05-12T00:15:00.000Z",
    timeLabel: "오전 9:15",
  },
  {
    id: "mockup-answer",
    role: "assistant",
    content:
      "이번 주(5/12-5/18) 시작 예정 고객은 총 3명입니다.\n\n· 송진호 (5/14, A통합1형) — 제공인력 미배정 ⚠\n· 윤지아 (5/21, B가1형) — 제공인력 미배정 ⚠\n· 박민수 (5/16, A라1형) — 김민지 매니저 배정됨 ✓\n\n미배정 2건은 시작일까지 D-3 이내라 우선 배정이 필요합니다.",
    timestamp: "2026-05-12T00:15:00.000Z",
    timeLabel: "오전 9:15",
    sources: ["고객 · 8건", "제공인력 · 12명"],
  },
  {
    id: "mockup-user-2",
    role: "user",
    content: "송진호 고객한테 가장 적합한 제공인력 추천해줘",
    timestamp: "2026-05-12T00:16:00.000Z",
    timeLabel: "오전 9:16",
  },
  {
    id: "mockup-typing",
    role: "assistant",
    content: "",
    timestamp: "2026-05-12T00:16:20.000Z",
    isStreaming: true,
  },
];

const navItems = [
  { href: "/dashboard", label: "홈", icon: Home },
  { href: "/clients", label: "고객", icon: Users },
  { href: "/chat", label: "어시스턴트", icon: Sparkles },
  { href: "/contracts", label: "계약", icon: FileText },
  { href: "/all", label: "전체", icon: Menu },
] as const;

function formatMessageTime(message: ChatDisplayMessage) {
  if (message.timeLabel) return message.timeLabel;

  const date = new Date(message.timestamp);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function TypingIndicator() {
  return (
    <span className={styles.msgTyping} aria-label="응답 작성 중">
      <span />
      <span />
      <span />
    </span>
  );
}

function UserMessage({ message }: { message: ChatDisplayMessage }) {
  const timeLabel = formatMessageTime(message);

  return (
    <div className={`${styles.msgRow} ${styles.userRow}`} data-component="chat-message-user">
      <div className={`${styles.msgAvatar} ${styles.userAvatar}`} data-component="chat-message-user-avatar">송</div>
      <div data-component="chat-message-user-body">
        <div className={styles.msgBubble} data-component="chat-message-user-bubble">{message.content}</div>
        {timeLabel && <div className={styles.msgTime} data-component="chat-message-user-time">{timeLabel}</div>}
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatDisplayMessage }) {
  const wizardType = message.ui?.type;
  const [createdClient, setCreatedClient] = useState<CreatedClient | null>(null);
  const [contractStatus, setContractStatus] = useState<ContractStatusResult | null>(null);
  const [contractSendDone, setContractSendDone] = useState(false);

  const wizardContent = useMemo(() => {
    if (!wizardType) return null;

    switch (wizardType) {
      case "clientRegistrationWizard":
        if (createdClient) {
          return (
            <div data-component="chat-wizard-registration-success">
              산모 등록 완료: {createdClient.name} (ID: {createdClient.id})
            </div>
          );
        }

        return <ClientRegistrationWizard onCreated={(client) => setCreatedClient(client)} />;

      case "contractSendWizard":
        if (contractSendDone) {
          return <div data-component="chat-wizard-contract-send-success">계약서 전송 화면으로 이동했습니다.</div>;
        }

        return <ContractSendWizard onComplete={() => setContractSendDone(true)} />;

      case "contractStatusWizard":
        if (contractStatus) {
          return (
            <div data-component="chat-wizard-contract-status-result" className={styles.wizardResult}>
              <div data-component="chat-wizard-contract-status-state">
                계약서 상태: <strong>{String(contractStatus.documentStatus)}</strong>
              </div>
              <div data-component="chat-wizard-contract-status-client">
                산모: {contractStatus.clientName} (ID: {contractStatus.clientId})
              </div>
              {contractStatus.serviceStatus && (
                <div data-component="chat-wizard-contract-status-service">서비스 상태: {contractStatus.serviceStatus}</div>
              )}
            </div>
          );
        }

        return <ContractStatusWizard onCheck={(result) => setContractStatus(result)} />;

      default:
        return null;
    }
  }, [wizardType, createdClient, contractSendDone, contractStatus]);

  const timeLabel = formatMessageTime(message);
  const showTyping = message.isStreaming && !message.content && !wizardContent;

  return (
    <div className={styles.msgRow} data-component="chat-message-assistant">
      <div className={`${styles.msgAvatar} ${styles.aiAvatar}`} data-component="chat-message-assistant-avatar">AI</div>
      <div data-component="chat-message-assistant-body">
        {showTyping ? (
          <TypingIndicator />
        ) : (
          <div className={styles.msgBubble} data-component="chat-message-assistant-bubble">
            {wizardContent ? (
              wizardContent
            ) : (
              <div className={styles.chatMarkdown} data-component="chat-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code: ({ className, children, ref, ...props }) => {
                      void ref;
                      const match = /language-(\w+)/.exec(className || "");
                      const language = match ? match[1] : "";
                      const codeString = String(children).replace(/\n$/, "");

                      if (language) {
                        return <CodeBlock language={language}>{codeString}</CodeBlock>;
                      }

                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                    table: ({ children }) => (
                      <div className={styles.tableWrapper} data-component="chat-markdown-table-wrapper">
                        <table>{children}</table>
                      </div>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}
        {message.sources && (
          <div className={styles.msgSources} data-component="chat-message-sources">
            {message.sources.map((source) => (
              <span className={styles.msgSource} key={source}>
                {source}
              </span>
            ))}
          </div>
        )}
        {timeLabel && !showTyping && (
          <div className={styles.msgTime} data-component="chat-message-assistant-time">
            {timeLabel}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolExecutingIndicator({ toolName }: { toolName: string | null }) {
  return (
    <div className={styles.stateIndicator} data-component="chat-tool-executing-indicator">
      <Spinner size="sm" />
      <p>{toolName ? `${toolName} 실행 중...` : "처리 중..."}</p>
    </div>
  );
}

function StateIndicator({ state }: { state: ChatState }) {
  if (state !== "connecting") return null;

  return (
    <div className={styles.stateIndicator} data-component="chat-state-indicator">
      <Spinner size="sm" />
      <p>연결 중...</p>
    </div>
  );
}

function ChatComposer({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (message: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
  }, []);

  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, value]);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(event.target.value);
  };

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    void onSubmit(trimmed);
    setValue("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;

    event.preventDefault();
    handleSubmit();
  };

  return (
    <div className={styles.chatInputBar} data-component="chat-input-area">
      <textarea
        ref={textareaRef}
        className={styles.chatInput}
        placeholder="질문을 입력하세요..."
        rows={1}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        data-component="chat-input"
      />
      <button
        className={styles.chatSend}
        type="button"
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        aria-label="메시지 보내기"
      >
        <Send size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function ChatBottomNav() {
  return (
    <nav className={styles.bottomNav} data-component="mobile-bottom-nav" aria-label="주요 메뉴">
      {navItems.map((item) => {
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${styles.bottomNavItem} ${item.href === "/chat" ? styles.bottomNavItemActive : ""}`}
            data-component={item.href === "/chat" ? "mobile-bottom-nav-chat" : `mobile-bottom-nav-${item.href.slice(1)}`}
          >
            <Icon size={18} strokeWidth={item.href === "/chat" ? 2 : 2.5} />
            <span className={styles.navLabel}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export default function ChatPage() {
  const user = useInitialUser();
  const {
    messages,
    state,
    sendMessage,
    clearSession,
    isToolExecuting,
    currentTool,
    loadHistory,
    isLoadingHistory,
    hasMoreHistory,
  } = useChatStream();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef(0);
  const lastMessageRef = useRef<ChatMessage | null>(null);

  useEffect(() => {
    loadHistory(0);
  }, [loadHistory]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (container.scrollTop < 100 && hasMoreHistory && !isLoadingHistory) {
      prevScrollHeightRef.current = container.scrollHeight;
      loadHistory(messages.length);
    }
  }, [hasMoreHistory, isLoadingHistory, messages.length, loadHistory]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const lastMessage = messages[messages.length - 1];
    const isNewMessage = lastMessage !== lastMessageRef.current;

    if (!isNewMessage && container && prevScrollHeightRef.current > 0) {
      const diff = container.scrollHeight - prevScrollHeightRef.current;
      if (diff > 0) {
        requestAnimationFrame(() => {
          container.scrollTop = diff;
        });
      }
      prevScrollHeightRef.current = 0;
    } else if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: isNewMessage ? "smooth" : "auto" });
    }

    lastMessageRef.current = lastMessage || null;
  }, [messages]);

  const visibleMessages = useMemo<ChatDisplayMessage[]>(() => {
    if (messages.length === 0) return MOCKUP_MESSAGES;

    return messages.map((message, index) => ({
      ...message,
      id: `live-${index}-${message.timestamp}`,
    }));
  }, [messages]);

  const lastMessage = messages[messages.length - 1];
  const showConfirmButtons =
    lastMessage?.role === "assistant" &&
    !lastMessage.isStreaming &&
    (lastMessage.content.includes("하시겠습니까?") || lastMessage.content.includes("Would you like"));

  const userLabel = user?.name ? `${user.name} 님` : "송진호 님";
  const branchLabel = user?.branchName ?? "인천점";
  const isInputDisabled = state === "streaming" || state === "connecting";

  return (
    <section className={styles.chatShell} data-component="chat">
      <header className={styles.existingNavbar} data-component="chat-header">
        <div className={styles.navbarIdentity} data-component="chat-header-identity">
          <span className={styles.navbarUser}>{userLabel}</span>
          <span className={styles.navbarBranch}>{branchLabel}</span>
        </div>
        <div className={styles.navbarIcons} data-component="chat-header-icons">
          <button
            className={styles.navbarIconBtn}
            type="button"
            onClick={clearSession}
            title="새 대화"
            aria-label="새 대화"
          >
            <Plus size={18} strokeWidth={2.5} />
          </button>
          <button className={styles.navbarIconBtn} type="button" aria-label="알림">
            <Bell size={18} strokeWidth={2} />
            <span className={styles.dot} />
          </button>
        </div>
      </header>

      <div className={styles.chatContent} data-component="chat-content">
        <div className={styles.chatScroll} ref={scrollContainerRef} data-component="chat-messages">
          {isLoadingHistory && messages.length > 0 && (
            <div className={styles.historySpinner} data-component="chat-history-spinner">
              <Spinner size="sm" />
            </div>
          )}

          {visibleMessages.map((message) =>
            message.role === "user" ? (
              <UserMessage key={message.id} message={message} />
            ) : (
              <AssistantMessage key={message.id} message={message} />
            )
          )}

          {isToolExecuting && <ToolExecutingIndicator toolName={currentTool} />}
          <StateIndicator state={state} />

          {showConfirmButtons && (
            <div className={styles.confirmActions} data-component="chat-confirm-actions">
              <button type="button" onClick={() => sendMessage("확인")} disabled={isInputDisabled}>
                확인
              </button>
              <button type="button" onClick={() => sendMessage("취소")} disabled={isInputDisabled}>
                취소
              </button>
            </div>
          )}

          <div ref={messagesEndRef} data-component="chat-messages-end" />
        </div>
      </div>

      <ChatComposer onSubmit={sendMessage} disabled={isInputDisabled} />
      <ChatBottomNav />
    </section>
  );
}
