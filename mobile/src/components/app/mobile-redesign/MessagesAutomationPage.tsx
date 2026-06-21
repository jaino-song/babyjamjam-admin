"use client";

import { useRouter } from "next/navigation";

import { AlimtalkTriggerList } from "@/components/app/mobile-redesign/AlimtalkTriggerList";
import "@/components/app/mobile-redesign/redesign.css";

export function MessagesAutomationPage() {
  const router = useRouter();

  return (
    <section data-component="alimtalk" className="alimtalk-page">
      <div className="shell-content" data-component="alimtalk-content">
        <div className="list-card pop-up alimtalk-trigger-card" data-component="alimtalk-trigger-card">
          <div className="list-title" data-component="alimtalk-trigger-card-title">
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

          <AlimtalkTriggerList />
        </div>
      </div>
    </section>
  );
}
