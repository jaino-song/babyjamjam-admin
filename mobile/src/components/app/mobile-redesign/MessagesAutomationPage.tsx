"use client";

import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { ListCard } from "@/components/app/mobile-redesign/primitives";

export { MESSAGE_NAVIGATION_ITEMS } from "@/components/app/mobile-redesign/MessageSectionNav";

import "@/components/app/mobile-redesign/redesign.css";

export function MessagesAutomationPage() {
  return (
    <section data-component="messages" className="messages-page">
      <div
        className="shell-content flex-col gap-[calc(8px*var(--glint-ui-scale,1))]"
        data-component="messages-content"
      >
        <MessageSectionNav activeId="send" />

        <ListCard
          title="메시지"
          actionLabel="+ 새 메시지"
          actionHref="/messages/new"
          filters={[]}
        >
          <p className="message-navigation-intro">
            메시지 전송과 관리 기능을 한곳에서 이용할 수 있습니다.
          </p>
        </ListCard>
      </div>
    </section>
  );
}
