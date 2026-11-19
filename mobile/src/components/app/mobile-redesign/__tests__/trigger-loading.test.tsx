import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";

import type { MessageTriggerRule } from "@/features/message-triggers/types";
import { messageRuleGroupsApi } from "@/services/api";

import { MessageTriggerEditor } from "../MessageTriggerEditor";
import { MessageTriggerList } from "../MessageTriggerList";

let mockPending = false;
jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: () => ({ data: { branchId: "qa-branch", role: "owner" } }) }));
jest.mock("@/services/api", () => ({ settingsApi: { getMessageAutomationConfig: jest.fn() }, messageRuleGroupsApi: { list: jest.fn(), update: jest.fn() } }));
jest.mock("@/lib/messages/logs", () => ({ fetchAllMessageLogs: () => new Promise(() => {}) }));
jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useUpdateMessageTriggerRule: () => ({ isPending: mockPending, mutate: jest.fn(), mutateAsync: jest.fn() }),
  useDeleteMessageTriggerRule: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useUpdateMessageTriggerRuleBranchActivation: () => ({ isPending: false, mutate: jest.fn() }),
  useMessageTriggerTemplates: () => ({ isLoading: false, data: [{ key: "SERVICE_INFO", name: "서비스 안내", allowedEventTypes: ["SERVICE_START"], allowedRecipientTypes: ["CLIENT"], requiredVariables: [], providers: { sms: { templateKey: "SERVICE_INFO" } } }] }),
}));

const rule: MessageTriggerRule = {
  id: "qa-rule", branchId: "qa-branch", name: "QA 안내 규칙", isActive: true, eventType: "SERVICE_START", offsetType: "BEFORE_DAYS", offsetDays: 1,
  recipientType: "CLIENT", templateKey: "SERVICE_INFO", targetClientStatus: "all", retryOnFailure: true,
  createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", sendTime: "09:00",
};

it("shows only the centered spinner while the trigger editor saves", () => {
  mockPending = true;
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}>
    <MessageTriggerEditor data-component="mobile_messages_automation_editor" rule={rule} onClose={jest.fn()} />
  </QueryClientProvider>);
  const button = screen.getByRole("button", { name: "저장 중" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveTextContent("규칙 저장");
  expect(button.querySelector('[data-slot="button-spinner"]')).toBeInTheDocument();
  view.unmount();
  client.clear();
});

it("renders the trigger count loading state inline while keeping timing information", async () => {
  mockPending = false;
  jest.mocked(messageRuleGroupsApi.list).mockResolvedValue({ groups: [], standaloneRules: [rule] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>
    <MessageTriggerList data-component="mobile_messages_automation_list" canManage onEdit={jest.fn()} />
  </QueryClientProvider>);
  const status = await screen.findByRole("status", { name: "발송 건수 집계 중" });
  expect(status.tagName).toBe("SPAN");
  expect(status).toHaveClass("inline-flex");
  expect(within(status).getByText("발송 건수 집계 중")).toHaveClass("sr-only");
  expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(status.parentElement).toHaveTextContent("SMS");
  expect(status).toHaveAttribute("data-component", "mobile_messages_automation_list_item-qa-rule_copy_subtitle_count-loading");
  view.unmount();
  client.clear();
});
