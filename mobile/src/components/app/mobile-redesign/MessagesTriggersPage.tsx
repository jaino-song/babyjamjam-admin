"use client";

import { MessageTriggerList } from "@/components/app/mobile-redesign/MessageTriggerList";
import { ClientRegistrationPolicySettings } from "@/components/app/mobile-redesign/ClientRegistrationPolicySettings";
import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { ListCard } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

export function MessagesTriggersPage() {
  return (
    <section data-component="messages" className="messages-page">
      <div
        className="shell-content flex-col gap-[calc(8px*var(--glint-ui-scale,1))]"
        data-component="messages-content"
      >
        <MessageSectionNav activeId="triggers" />
        <ListCard
          title="자동 전송"
          filters={[]}
          beforeScroll={<ClientRegistrationPolicySettings />}
        >
          <MessageTriggerList />
        </ListCard>
      </div>
    </section>
  );
}
