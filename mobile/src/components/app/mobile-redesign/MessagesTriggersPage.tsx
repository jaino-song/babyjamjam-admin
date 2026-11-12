"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ClientRegistrationPolicySettings } from "@/components/app/mobile-redesign/ClientRegistrationPolicySettings";
import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { MessageTriggerEditor } from "@/components/app/mobile-redesign/MessageTriggerEditor";
import { MessageTriggerList } from "@/components/app/mobile-redesign/MessageTriggerList";
import { SlidingCard } from "@/components/app/mobile-redesign/sliding-card";
import { useQuery } from "@tanstack/react-query";
import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import { messageRuleGroupsApi } from "@/services/api";
import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { canManageBranch, canManageBranchFromAuthQuery } from "@/lib/auth/branch-role-policy";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";

import "@/components/app/mobile-redesign/redesign.css";

const AUTOMATION_PAGE_BASE = "mobile_messages_automation_page";
const SLIDING_CARD_BASE = `${AUTOMATION_PAGE_BASE}_screen_content_sliding-card`;
const AUTOMATION_LIST_BASE = `${SLIDING_CARD_BASE}_stage_list-pane_automation-list`;
const DETAIL_BODY_BASE = `${SLIDING_CARD_BASE}_stage_detail-pane_body`;
const NEW_RULE_ITEM_ID = "new";

export function MessagesTriggersPage(): ReactElement {
  const router = useRouter();
  const selectedItemId = useSearchParams().get("item");
  const authUserQuery = useGetAuthUser();
  const canManage = canManageBranchFromAuthQuery(authUserQuery);
  const didPushDetailRef = useRef(false);
  const lastClearedItemRef = useRef<string | null>(null);
  const branchId = authUserQuery.data?.branchId ?? null;
  const rulesQuery = useQuery({ queryKey: [...messageTriggerKeys.all, "rule-groups", branchId], queryFn: () => messageRuleGroupsApi.list(branchId!), enabled: Boolean(branchId) });
  const [editorDirty, setEditorDirty] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveAction = useRef<(() => void) | null>(null);
  const guardNavigation = (action: () => void) => { if (editorDirty) { leaveAction.current = action; setLeaveOpen(true); } else action(); };
  useEffect(() => {
    if (!editorDirty) return;
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.origin !== window.location.origin || anchor.target === "_blank" || event.ctrlKey || event.metaKey || anchor.href === window.location.href) return;
      event.preventDefault(); event.stopPropagation();
      leaveAction.current = () => router.push(anchor.pathname + anchor.search + anchor.hash);
      setLeaveOpen(true);
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, [editorDirty, router]);
  const rules = useMemo(
    () => rulesQuery.data?.standaloneRules ?? [],
    [rulesQuery.data],
  );
  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedItemId && rule.branchId !== null),
    [rules, selectedItemId],
  );
  const selectedGroup = rulesQuery.data?.groups.find((group) => group.id === selectedItemId);
  const isCreating = selectedItemId === NEW_RULE_ITEM_ID;
  const authoritySettled = !authUserQuery.isPending
    && !authUserQuery.isLoading
    && !authUserQuery.isFetching
    && !authUserQuery.isError;
  const canRenderAuthorizedDetail = canManage || (
    canManageBranch(authUserQuery.data)
    && !authUserQuery.isPending
    && !authUserQuery.isLoading
    && !authUserQuery.isError
    && authUserQuery.isFetching
  );
  const isOpen = canRenderAuthorizedDetail
    && (isCreating || selectedRule !== undefined || selectedGroup !== undefined);

  useEffect(() => {
    if (selectedItemId === null) {
      didPushDetailRef.current = false;
      lastClearedItemRef.current = null;
    }
  }, [selectedItemId]);

  useEffect(() => {
    if (canManage) {
      lastClearedItemRef.current = null;
    }
  }, [canManage]);

  useEffect(() => {
    if (
      !authoritySettled ||
      selectedItemId === null ||
      (canManage && (
        rulesQuery.isLoading ||
        rulesQuery.isFetching ||
        rulesQuery.isError ||
        isCreating ||
        selectedRule !== undefined ||
        selectedGroup !== undefined
      ))
    ) {
      return;
    }

    if (lastClearedItemRef.current === selectedItemId) {
      return;
    }

    lastClearedItemRef.current = selectedItemId;

    router.replace("/messages/automation", { scroll: false });
  }, [authoritySettled, canManage, isCreating, router, rulesQuery.isError, rulesQuery.isFetching, rulesQuery.isLoading, selectedItemId, selectedRule, selectedGroup]);

  const openItem = (id: string) => {
    if (id === selectedItemId) return;

    guardNavigation(() => { router.push(`?item=${encodeURIComponent(id)}`, { scroll: false }); didPushDetailRef.current = true; });
  };

  const closeDetail = () => guardNavigation(() => {
    if (didPushDetailRef.current) {
      router.back();
      return;
    }

    router.replace("/messages/automation", { scroll: false });
  });

  const detail = isOpen ? (
    <MessageTriggerEditor
      key={`${branchId}-${selectedItemId}`}
      data-component={`${DETAIL_BODY_BASE}_${isCreating ? "new-rule" : `rule-${selectedGroup?.id ?? selectedRule?.id}`}_editor`}
      rule={selectedRule ?? null}
      group={selectedGroup ?? null}
      onDirtyChange={setEditorDirty}
      onCancel={closeDetail}
      onClose={() => { setEditorDirty(false); if (didPushDetailRef.current) router.back(); else router.replace("/messages/automation", { scroll: false }); }}
    />
  ) : null;

  return (
    <>
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
                canManage={canManage}
                selectedId={selectedItemId}
                onCreate={() => openItem(NEW_RULE_ITEM_ID)}
                onEdit={(rule) => openItem(rule.id)}
                onEditGroup={(group) => openItem(group.id)}
                beforeItems={canManage ? (
                  <ClientRegistrationPolicySettings
                    data-component={`${AUTOMATION_LIST_BASE}_client-registration-policy`}
                  />
                ) : undefined}
              />
            )}
            detail={detail}
          />
        </div>
      </div>
    </section>
    <ApprovalTwoButtonModal data-component={`${AUTOMATION_PAGE_BASE}_leave-modal`} open={leaveOpen} onOpenChange={setLeaveOpen} title="변경 내용을 취소할까요?" description="저장하지 않은 변경 내용은 취소됩니다." isDescriptionVisuallyHidden={false} approvalLabel="변경 취소" onApprove={() => { setEditorDirty(false); setLeaveOpen(false); const action = leaveAction.current; leaveAction.current = null; action?.(); }} />
    </>
  );
}
