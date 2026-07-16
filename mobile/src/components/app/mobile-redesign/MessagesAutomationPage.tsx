"use client";

import Link from "next/link";
import {
  ChevronRight,
  Clock3,
  FileText,
  History,
  Send,
  Settings2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  MESSAGE_SECTION_DEFINITIONS,
  type MessageSectionId,
} from "@babyjamjam/shared";

import "@/components/app/mobile-redesign/redesign.css";

interface MessageNavigationItem {
  id: MessageSectionId;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: "primary" | "orange" | "green" | "purple" | "slate";
}

const MESSAGE_NAVIGATION_PRESENTATION: Record<
  MessageSectionId,
  Pick<MessageNavigationItem, "description" | "icon" | "tone">
> = {
  send: {
    description: "고객과 제공인력에게 새 메시지를 보냅니다.",
    icon: Send,
    tone: "primary",
  },
  scheduled: {
    description: "예약되어 있는 SMS 발송 일정을 확인합니다.",
    icon: Clock3,
    tone: "orange",
  },
  history: {
    description: "전송 결과와 실패 사유를 포함한 내역을 확인합니다.",
    icon: History,
    tone: "green",
  },
  templates: {
    description: "기본 템플릿과 지점 템플릿을 관리합니다.",
    icon: FileText,
    tone: "purple",
  },
  triggers: {
    description: "고객 일정에 맞춘 자동 발송 규칙을 관리합니다.",
    icon: Workflow,
    tone: "primary",
  },
  settings: {
    description: "메시지 발송 권한과 발신번호 상태를 확인합니다.",
    icon: Settings2,
    tone: "slate",
  },
};

export const MESSAGE_NAVIGATION_ITEMS: MessageNavigationItem[] =
  MESSAGE_SECTION_DEFINITIONS.map((section) => ({
    id: section.id,
    title: section.label,
    href: section.mobilePath,
    ...MESSAGE_NAVIGATION_PRESENTATION[section.id],
  }));

export function MessagesAutomationPage() {
  return (
    <section data-component="messages" className="messages-page">
      <div className="shell-content" data-component="messages-content">
        <div className="list-card pop-up message-navigation-card" data-component="mobile-messages-navigation">
          <div className="list-title" data-component="message-trigger-card-title">
            <span className="list-title-text">메시지</span>
            <Link
              className="list-action"
              data-component="mobile-messages-new"
              href="/messages/new"
            >
              + 새 메시지
            </Link>
          </div>

          <p className="message-navigation-intro">
            메시지 전송과 관리 기능을 한곳에서 이용할 수 있습니다.
          </p>

          <nav className="message-navigation-list" aria-label="메시지 기능">
            {MESSAGE_NAVIGATION_ITEMS.map((item) => {
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="message-navigation-row"
                  data-component="mobile-messages-navigation-item"
                >
                  <span className={`message-navigation-icon message-navigation-icon-${item.tone}`}>
                    <Icon size={19} strokeWidth={2.3} aria-hidden="true" />
                  </span>
                  <span className="message-navigation-copy">
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" />
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </section>
  );
}
