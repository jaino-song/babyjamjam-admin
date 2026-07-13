"use client";

import { useRouter } from "next/navigation";

import { MessageTriggerList } from "@/components/app/mobile-redesign/MessageTriggerList";
import "@/components/app/mobile-redesign/redesign.css";

export function MessagesAutomationPage() {
  const router = useRouter();

  return (
    <section data-component="alimtalk" className="alimtalk-page">
      <div className="shell-content" data-component="alimtalk-content">
        <div className="list-card pop-up message-trigger-card" data-component="message-trigger-card">
          <div className="list-title" data-component="message-trigger-card-title">
            <span className="list-title-text">메시지</span>
            <button
              type="button"
              className="list-action"
              data-component="mobile-messages-new"
              onClick={() => router.push("/messages/new")}
            >
              + 새 메시지
            </button>
          </div>

          <MessageTriggerList />
        </div>
      </div>
    </section>
  );
}
