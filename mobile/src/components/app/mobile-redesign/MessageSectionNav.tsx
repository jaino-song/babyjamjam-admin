"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCheck,
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
import { canManageBranchFromAuthQuery } from "@/lib/auth/branch-role-policy";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";

const SOURCE_COMPONENT = "MessageSectionNav";

type MobileMessageSectionId = MessageSectionId | "complete";

interface MessageNavigationItem {
  id: MobileMessageSectionId;
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

export const MESSAGE_NAVIGATION_ITEMS: MessageNavigationItem[] = [
  { id: "complete", title: "메세지 제작", href: "/messages/compose", icon: CheckCheck },
  ...MESSAGE_SECTION_DEFINITIONS.map((section) => ({
    id: section.id,
    title: section.label,
    href: section.mobilePath,
    icon: MESSAGE_NAVIGATION_PRESENTATION[section.id],
  })),
];

// Templates remain owner-only. Trigger rules are branch-management controls and
// are available to an owner or an admin/manager of the active branch.
// "scheduled" no longer has a nav entry (folded into the merged 발송 기록
// screen) and "history" is gated only by sending approval below, so neither
// belongs in this set anymore.
const OWNER_ONLY_SECTION_IDS = new Set<MobileMessageSectionId>(["templates"]);
const BRANCH_MANAGEMENT_SECTION_IDS = new Set<MobileMessageSectionId>(["triggers"]);
const SENDER_APPROVAL_EXEMPT_SECTION_IDS = new Set<MobileMessageSectionId>(["complete", "settings"]);

export function MessageSectionNav({
  "data-component": dataComponent,
  activeId,
}: {
  "data-component": string;
  activeId: MobileMessageSectionId;
}) {
  const router = useRouter();
  const authUserQuery = useGetAuthUser();
  const user = authUserQuery.data;
  const isOwner = user?.role === "owner";
  const canManageBranchMessages = canManageBranchFromAuthQuery(authUserQuery);
  const { isLoading, needsSenderApproval } = useMessagesPermissionGuard();

  const sectionNavItems = useMemo(
    () =>
      MESSAGE_NAVIGATION_ITEMS.map((item) => ({
        id: item.id,
        label: item.title,
        icon: item.icon,
        disabled:
          ((isLoading || needsSenderApproval) && !SENDER_APPROVAL_EXEMPT_SECTION_IDS.has(item.id)) ||
          (OWNER_ONLY_SECTION_IDS.has(item.id) && !isOwner) ||
          (BRANCH_MANAGEMENT_SECTION_IDS.has(item.id) && !canManageBranchMessages),
      })),
    [canManageBranchMessages, isOwner, isLoading, needsSenderApproval],
  );

  const handleSectionSelect = (sectionId: MobileMessageSectionId) => {
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
    />
  );
}
