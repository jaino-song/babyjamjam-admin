"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
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

import { MobileSectionNav } from "@/components/app/mobile-redesign/primitives";

import "@/components/app/mobile-redesign/redesign.css";

interface MessageNavigationItem {
  id: MessageSectionId;
  title: string;
  href: string;
  icon: LucideIcon;
}

const MESSAGE_NAVIGATION_PRESENTATION: Record<
  MessageSectionId,
  Pick<MessageNavigationItem, "icon">
> = {
  send: {
    icon: Send,
  },
  scheduled: {
    icon: Clock3,
  },
  history: {
    icon: History,
  },
  templates: {
    icon: FileText,
  },
  triggers: {
    icon: Workflow,
  },
  settings: {
    icon: Settings2,
  },
};

export const MESSAGE_NAVIGATION_ITEMS: MessageNavigationItem[] =
  MESSAGE_SECTION_DEFINITIONS.map((section) => ({
    id: section.id,
    title: section.label,
    href: section.mobilePath,
    ...MESSAGE_NAVIGATION_PRESENTATION[section.id],
  }));

const MESSAGE_SECTION_NAV_ITEMS = MESSAGE_NAVIGATION_ITEMS.map((item) => ({
  id: item.id,
  label: item.title,
  icon: item.icon,
}));

export function MessagesAutomationPage() {
  const router = useRouter();

  const handleSectionSelect = (sectionId: MessageSectionId) => {
    const selectedItem = MESSAGE_NAVIGATION_ITEMS.find((item) => item.id === sectionId);
    if (selectedItem) router.push(selectedItem.href);
  };

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

          <MobileSectionNav
            ariaLabel="메시지 기능"
            items={MESSAGE_SECTION_NAV_ITEMS}
            activeId="send"
            onSelect={handleSectionSelect}
          />
        </div>
      </div>
    </section>
  );
}
