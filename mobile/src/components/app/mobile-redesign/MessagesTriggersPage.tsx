"use client";

import Link from "next/link";

import { MessageTriggerList } from "@/components/app/mobile-redesign/MessageTriggerList";
import "@/components/app/mobile-redesign/redesign.css";

export function MessagesTriggersPage() {
  return (
    <section data-component="messages" className="messages-page">
      <div data-component="messages-shell" className="messages-page">
        <div className="shell-content" data-component="messages-content">
          <div className="list-card pop-up message-trigger-card" data-component="message-trigger-card">
            <Link href="/messages" aria-label="메시지로 돌아가기" className="message-data-back mt-2">
              돌아가기
            </Link>
            <div className="message-data-header">
              <div>
                <h1>자동 전송</h1>
                <p>고객 일정에 맞춘 자동 발송 규칙을 관리합니다.</p>
              </div>
            </div>
            <MessageTriggerList />
          </div>
        </div>
      </div>
    </section>
  );
}
