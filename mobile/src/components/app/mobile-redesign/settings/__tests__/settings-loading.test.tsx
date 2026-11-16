import type { MessageAutomationPolicyConfiguration } from "@babyjamjam/shared/types/message";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { settingsApi } from "@/services/api";

import { PastTriggerPolicyDetail } from "../PastTriggerPolicyDetail";
import { SenderApprovalDetail } from "../SenderApprovalDetail";

jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: () => ({ data: { branchName: "QA 지점" } }) }));
jest.mock("@/providers/UserProvider", () => ({ useInitialUser: () => null }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({ useMessageTriggerRules: () => ({ data: [], isLoading: true, isError: false }) }));
jest.mock("@/services/api", () => ({ settingsApi: { getMessageSenderApproval: jest.fn(), requestMessageSenderApproval: jest.fn(), previewMessageAutomationConfig: jest.fn() } }));

beforeAll(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class { observe() {} unobserve() {} disconnect() {} },
  });
});

const configuration: MessageAutomationPolicyConfiguration = {
  schemaVersion: 1, dispatchCheckIntervalMinutes: 5, defaultRuleSendTime: "09:00",
  triggerRetryIntervalMinutes: 5, processingReclaimMinutes: 10, smsRetryIntervalMinutes: 5,
  pastExpiryHours: 72, pastSendIntervalMinutes: 5, pastRuleOrder: [], duplicateWindowHours: 72,
  quietHours: { enabled: false, start: "21:00", end: "08:00", recipientGroups: ["CLIENT"], action: "DEFER", timezone: "Asia/Seoul" },
};

it("uses an accessible loading state for ordering rules and a hidden save busy label", () => {
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}>
    <PastTriggerPolicyDetail data-component="mobile_messages_settings_policy" itemId="past-trigger" configuration={configuration}
      branchId="qa-branch" version="v1" canWrite isPending dirty error={null} onChange={jest.fn()} onSave={jest.fn()} onCancel={jest.fn()} />
  </QueryClientProvider>);
  const status = screen.getByRole("status", { name: "자동 전송 루틴을 불러오는 중" });
  expect(screen.getByText("자동 전송 루틴을 불러오는 중")).toHaveClass("sr-only");
  expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  const button = screen.getByRole("button", { name: "저장 중" });
  expect(button).toBeDisabled();
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveTextContent("저장");
  view.unmount();
  client.clear();
});

it("replaces the sender request label with a spinner until the request finishes", async () => {
  jest.mocked(settingsApi.getMessageSenderApproval).mockResolvedValue({ approvalStatus: "not_requested", isApproved: false, canRequest: true, requestedAt: null, approvedAt: null });
  jest.mocked(settingsApi.requestMessageSenderApproval).mockReturnValue(new Promise(() => {}));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><SenderApprovalDetail data-component="mobile_messages_settings_sender-approval-detail" /></QueryClientProvider>);
  const checkboxes = await screen.findAllByRole("checkbox");
  await waitFor(() => expect(checkboxes[0]).toBeEnabled());
  checkboxes.forEach((checkbox) => fireEvent.click(checkbox));
  fireEvent.click(screen.getByRole("button", { name: "신청하기" }));
  const button = await screen.findByRole("button", { name: "신청 중" });
  expect(button).toBeDisabled();
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
  expect(button.querySelector('[data-slot="button-spinner"]')).toBeInTheDocument();
  fireEvent.click(button);
  expect(settingsApi.requestMessageSenderApproval).toHaveBeenCalledTimes(1);
  view.unmount();
  client.clear();
});
