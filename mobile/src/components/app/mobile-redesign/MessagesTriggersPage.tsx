"use client";

import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ClientRegistrationPolicySettings } from "@/components/app/mobile-redesign/ClientRegistrationPolicySettings";
import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { MessageTriggerEditor } from "@/components/app/mobile-redesign/MessageTriggerEditor";
import { MessageTriggerList } from "@/components/app/mobile-redesign/MessageTriggerList";
import { SlidingCard } from "@/components/app/mobile-redesign/sliding-card";
import { useMessageTriggerRules } from "@/features/message-triggers/hooks/use-message-triggers";

import "@/components/app/mobile-redesign/redesign.css";

const AUTOMATION_PAGE_BASE = "mobile_messages_automation_page";
const SLIDING_CARD_BASE = `${AUTOMATION_PAGE_BASE}_screen_content_sliding-card`;
const AUTOMATION_LIST_BASE = `${SLIDING_CARD_BASE}_stage_list-pane_automation-list`;
const DETAIL_BODY_BASE = `${SLIDING_CARD_BASE}_stage_detail-pane_body`;
const NEW_RULE_ITEM_ID = "new";

export function MessagesTriggersPage(): ReactElement {
  const router = useRouter();
  const selectedItemId = useSearchParams().get("item");
  const didPushDetailRef = useRef(false);
  const rulesQuery = useMessageTriggerRules();
  const rules = useMemo(
    () => Array.isArray(rulesQuery.data) ? rulesQuery.data : [],
    [rulesQuery.data],
  );
  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedItemId && rule.branchId !== null),
    [rules, selectedItemId],
  );
  const isCreating = selectedItemId === NEW_RULE_ITEM_ID;
  const isOpen = isCreating || selectedRule !== undefined;

  useEffect(() => {
    if (selectedItemId === null) {
      didPushDetailRef.current = false;
    }
  }, [selectedItemId]);

  useEffect(() => {
    if (
      rulesQuery.isLoading ||
      rulesQuery.isError ||
      selectedItemId === null ||
      isCreating ||
      selectedRule !== undefined
    ) {
      return;
    }

    router.replace("/messages/automation", { scroll: false });
  }, [isCreating, router, rulesQuery.isError, rulesQuery.isLoading, selectedItemId, selectedRule]);

  const openItem = (id: string) => {
    if (id === selectedItemId) return;

    router.push(`?item=${encodeURIComponent(id)}`, { scroll: false });
    didPushDetailRef.current = true;
  };

  const closeDetail = () => {
    if (didPushDetailRef.current) {
      router.back();
      return;
    }

    router.replace("/messages/automation", { scroll: false });
  };

  const detail = isOpen ? (
    <MessageTriggerEditor
      key={selectedItemId}
      data-component={`${DETAIL_BODY_BASE}_${isCreating ? "new-rule" : `rule-${selectedRule?.id}`}_editor`}
      rule={selectedRule ?? null}
      onClose={closeDetail}
    />
  ) : null;

  return (
    <section
      data-component={AUTOMATION_PAGE_BASE}
      data-slot="messages-page"
      data-page="messages-automation"
      className="messages-page flex min-h-0 w-full flex-1"
    >
      <div
        data-component={`${AUTOMATION_PAGE_BASE}_screen`}
        className="relative flex min-h-0 w-full flex-1 overflow-hidden"
      >
        <div
          data-component={`${AUTOMATION_PAGE_BASE}_screen_content`}
          data-slot="messages-content"
          className="shell-content relative min-h-0 flex-1 flex-col gap-[calc(8px*var(--glint-ui-scale,1))] !overflow-hidden"
        >
          <MessageSectionNav
            data-component={`${AUTOMATION_PAGE_BASE}_screen_content_section-nav`}
            activeId="triggers"
          />

          <SlidingCard
            data-component={SLIDING_CARD_BASE}
            open={isOpen}
            onBack={closeDetail}
            backLabel="자동 전송"
            detailKey={selectedItemId}
            list={(
              <MessageTriggerList
                data-component={AUTOMATION_LIST_BASE}
                selectedId={selectedItemId}
                onCreate={() => openItem(NEW_RULE_ITEM_ID)}
                onEdit={(rule) => openItem(rule.id)}
                beforeItems={(
                  <ClientRegistrationPolicySettings
                    data-component={`${AUTOMATION_LIST_BASE}_client-registration-policy`}
                  />
                )}
              />
            )}
            detail={detail}
          />
        </div>
      </div>
    </section>
  );
}
