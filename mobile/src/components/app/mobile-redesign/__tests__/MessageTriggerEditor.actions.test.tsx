import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MessageTriggerRule } from "@/features/message-triggers/types";

import { MessageTriggerEditor } from "../MessageTriggerEditor";

const mockUpdate = jest.fn();
jest.mock("@/services/api", () => ({ settingsApi: { getMessageAutomationConfig: jest.fn() }, messageRuleGroupsApi: {} }));
jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: () => ({ data: { branchId: "branch-1" } }) }));
jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageTriggerTemplates: () => ({ data: [{ key: "SERVICE_INFO", name: "서비스 안내", allowedEventTypes: ["SERVICE_START"], allowedRecipientTypes: ["CLIENT"], providers: { sms: { templateKey: "SERVICE_INFO" } } }], isLoading: false }),
  useUpdateMessageTriggerRule: () => {
    const { useMutation } = jest.requireActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
    return useMutation({ mutationFn: mockUpdate });
  },
  useDeleteMessageTriggerRule: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const rule: MessageTriggerRule = {
  id: "rule-1", branchId: "branch-1", name: "QA-규칙", isActive: true, isDefault: true,
  eventType: "SERVICE_START", offsetType: "BEFORE_DAYS", offsetDays: 3, sendTime: "10:30",
  recipientType: "CLIENT", templateKey: "SERVICE_INFO", targetClientStatus: "all", retryOnFailure: true,
  createdAt: "2026-11-01", updatedAt: "2026-11-01",
};

function renderEditor(storedRule: MessageTriggerRule = rule) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCancel = jest.fn();
  render(<QueryClientProvider client={client}><MessageTriggerEditor data-component="mobile_messages_test_editor" rule={storedRule} onCancel={onCancel} onClose={jest.fn()} /></QueryClientProvider>);
  return { onCancel };
}

it("puts cancel before the raw save action at one third and two thirds, including while busy", async () => {
  let resolveSave!: () => void;
  mockUpdate.mockReturnValueOnce(new Promise<void>((resolve) => { resolveSave = resolve; }));
  const { onCancel } = renderEditor();
  const cancel = screen.getByRole("button", { name: "취소" });
  const save = screen.getByRole("button", { name: "규칙 저장" });
  expect(Array.from(save.parentElement!.children)).toEqual([cancel, save]);
  expect(cancel).toHaveClass("flex-1");
  expect(save.parentElement).toHaveClass("grid!", "grid-cols-[minmax(0,1fr)_minmax(0,2fr)]");
  expect(save).toHaveClass("btn", "btn-primary", "flex-[2]!");
  fireEvent.click(cancel);
  expect(onCancel).toHaveBeenCalledTimes(1);
  fireEvent.click(save);
  const busy = await screen.findByRole("button", { name: "저장 중" });
  expect(busy).toBe(save);
  expect(busy).toHaveClass("relative", "flex-[2]!");
  expect(busy).toHaveAttribute("aria-busy", "true");
  expect(busy).toHaveAttribute("data-loading", "");
  expect(busy).toBeDisabled();
  expect(cancel).toBeDisabled();
  expect(busy.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
  expect(busy.querySelector('[data-slot="button-spinner"]')).toBeInTheDocument();
  await act(async () => { resolveSave(); });
  await waitFor(() => expect(screen.getByRole("button", { name: "규칙 저장" })).toBeEnabled());
});

it("keeps delete between cancel and save in the existing three-action layout", () => {
  renderEditor({ ...rule, isDefault: false });
  const cancel = screen.getByRole("button", { name: "취소" });
  const remove = screen.getByRole("button", { name: "규칙 삭제" });
  const save = screen.getByRole("button", { name: "규칙 저장" });
  expect(Array.from(save.parentElement!.children)).toEqual([cancel, remove, save]);
  expect(cancel).not.toHaveClass("flex-1");
  expect(remove).toHaveClass("btn-secondary");
  expect(save).toHaveClass("flex-1");
});
