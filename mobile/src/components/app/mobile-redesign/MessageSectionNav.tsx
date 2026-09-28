"use client";

import { useMemo } from "react";
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

import { useMessagesPermissionGuard } from "@/app/(shell)/messages/MessagesPermissionGuard";
import { MobileSectionNav } from "@/components/app/mobile-redesign/primitives";
import { canManageBranch } from "@/lib/auth/branch-role-policy";
import { useInitialUser } from "@/providers/UserProvider";

const SOURCE_COMPONENT = "MessageSectionNav";

interface MessageNavigationItem {
  id: MessageSectionId;
  title: string;
  href: string;
  icon: LucideIcon;
}

const MESSAGE_NAVIGATION_PRESENTATION: Record<MessageSectionId, LucideIcon> = {
  send: Send,
  scheduled: Clock3,
  history: History,
  templates: FileText,
  triggers: Workflow,
  settings: Settings2,
};

export const MESSAGE_NAVIGATION_ITEMS: MessageNavigationItem[] =
  MESSAGE_SECTION_DEFINITIONS.map((section) => ({
    id: section.id,
    title: section.label,
    href: section.mobilePath,
    icon: MESSAGE_NAVIGATION_PRESENTATION[section.id],
  }));

// Templates remain owner-only. Trigger rules are branch-management controls and
// are available to an owner or an admin/manager of the active branch.
// "scheduled" no longer has a nav entry (folded into the merged 발송 기록
// screen) and "history" is gated only by sending approval below, so neither
// belongs in this set anymore.
const OWNER_ONLY_SECTION_IDS = new Set<MessageSectionId>(["templates"]);
const BRANCH_MANAGEMENT_SECTION_IDS = new Set<MessageSectionId>(["triggers"]);
const SENDER_APPROVAL_EXEMPT_SECTION_IDS = new Set<MessageSectionId>(["send", "settings"]);

export function MessageSectionNav({
  "data-component": dataComponent,
  activeId,
}: {
  "data-component": string;
  activeId: MessageSectionId;
}) {
  const router = useRouter();
  const user = useInitialUser();
  const isOwner = user?.role === "owner";
  const canManageBranchMessages = canManageBranch(user);
  const { isLoading, needsSenderApproval } = useMessagesPermissionGuard();

  const sectionNavItems = useMemo(
    () =>
      MESSAGE_NAVIGATION_ITEMS.map((item) => ({
        id: item.id,
        label: item.title,
        icon: item.icon,
        disabled:
          (needsSenderApproval && !SENDER_APPROVAL_EXEMPT_SECTION_IDS.has(item.id)) ||
          (OWNER_ONLY_SECTION_IDS.has(item.id) && !isOwner) ||
          (BRANCH_MANAGEMENT_SECTION_IDS.has(item.id) && !canManageBranchMessages),
      })),
    [canManageBranchMessages, isOwner, needsSenderApproval],
  );

  const handleSectionSelect = (sectionId: MessageSectionId) => {
    const selectedItem = MESSAGE_NAVIGATION_ITEMS.find((item) => item.id === sectionId);
    if (selectedItem) router.push(selectedItem.href);
  };

  return (
    <MobileSectionNav
      data-component={dataComponent}
      sourceComponent={SOURCE_COMPONENT}
      ariaLabel="메시지 기능"
      items={sectionNavItems}
      activeId={activeId}
      onSelect={handleSectionSelect}
      isLoading={isLoading}
    />
  );
}
