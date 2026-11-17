"use client";

import { useMemo } from "react";
import { MESSAGE_SECTION_DEFINITIONS, type MessageSectionId as SharedMessageSectionId } from "@babyjamjam/shared";
import { Clock3, FileText, History, Send, Settings2, Workflow } from "lucide-react";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { canManageBranchFromAuthQuery } from "@/lib/auth/branch-role-policy";
import { useMessageSenderApproval } from "./MessageApprovalGate";

type MessageSectionId = SharedMessageSectionId;

const ICON_BY_SECTION_ID: Record<SharedMessageSectionId, typeof Send> = {
  send: Send,
  scheduled: Clock3,
  history: History,
  templates: FileText,
  triggers: Workflow,
  settings: Settings2,
};

export const MESSAGE_SECTIONS = MESSAGE_SECTION_DEFINITIONS.map((section) => ({
  ...section,
  icon: ICON_BY_SECTION_ID[section.id],
}));

// Only branch managers can open the unreleased trigger section.
const UNRELEASED_SECTION_IDS = new Set<MessageSectionId>([
  "triggers",
]);
const SENDER_APPROVAL_EXEMPT_SECTION_IDS = new Set<MessageSectionId>(["send", "settings", "templates"]);

export function useMessageSections() {
  const authUserQuery = useGetAuthUser();
  const canManageBranchMessages = canManageBranchFromAuthQuery(authUserQuery);
  const { data: senderApproval } = useMessageSenderApproval();
  const isSenderApprovalRequired = senderApproval?.isApproved === false;
  return useMemo(
    () => MESSAGE_SECTIONS.map((section) => ({
      ...section,
      disabled:
        (isSenderApprovalRequired && !SENDER_APPROVAL_EXEMPT_SECTION_IDS.has(section.id)) ||
        (UNRELEASED_SECTION_IDS.has(section.id) && !canManageBranchMessages),
    })),
    [canManageBranchMessages, isSenderApprovalRequired],
  );
}
