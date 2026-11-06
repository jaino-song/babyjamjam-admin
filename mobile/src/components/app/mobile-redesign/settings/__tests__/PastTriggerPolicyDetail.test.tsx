import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MessageAutomationPolicyConfigResponse, MessageAutomationPolicyConfiguration, MessageTriggerRule } from "@babyjamjam/shared/types/message";
import MessageSettingsPage from "@/app/(shell)/messages/settings/page";
import { settingsApi } from "@/services/api";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockItem = "past-trigger";
let mockBranch = "branch-1";
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams({ item: mockItem }), useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }) }));
jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: () => ({ data: { branchId: mockBranch, role: "owner" } }) }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/components/app/mobile-redesign/settings/use-client-registration-policy", () => ({ useClientRegistrationPolicy: () => ({ policy: { clientAutoRegistration: true }, isLoading: false, updatePolicy: { mutate: jest.fn(), isPending: false } }) }));
jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({ useMessageTriggerRules: () => ({ data: mockRules, isLoading: false, isError: false }), useUpdateMessageTriggerRuleBranchActivation: () => ({ mutate: jest.fn(), isPending: false }) }));
jest.mock("@/services/api", () => ({ settingsApi: { getMessageAutomationConfig: jest.fn(), updateMessageAutomationConfig: jest.fn(), previewMessageAutomationConfig: jest.fn(), getMessageSenderApproval: jest.fn(), getMessageAutomationPolicies: jest.fn(), updateMessageSettingsPolicyActivation: jest.fn() } }));
const api = jest.mocked(settingsApi);
const CONFIG: MessageAutomationPolicyConfiguration = { schemaVersion: 1, dispatchCheckIntervalMinutes: 5, defaultRuleSendTime: "09:00", triggerRetryIntervalMinutes: 5, processingReclaimMinutes: 10, smsRetryIntervalMinutes: 5, pastExpiryHours: 72, pastSendIntervalMinutes: 5, pastRuleOrder: ["hidden", "one", "two"], duplicateWindowHours: 72, quietHours: { enabled: false, start: "21:00", end: "08:00", recipientGroups: ["CLIENT"], action: "DEFER", timezone: "Asia/Seoul" } };
const response = (configuration = CONFIG, version: string | null = "v1"): MessageAutomationPolicyConfigResponse => ({ version, configuration, permissions: { canRead: true, canWrite: true }, warnings: [] });
const rule = (id: string, templateKey: MessageTriggerRule["templateKey"] = "SERVICE_INFO", active = true): MessageTriggerRule => ({ id, branchId: "branch-1", name: id === "one" ? "첫 번째 규칙" : id === "two" ? "두 번째 규칙" : id, isActive: active, eventType: "SERVICE_START", offsetType: "BEFORE_DAYS", offsetDays: 1, recipientType: "CLIENT", templateKey, targetClientStatus: "all", retryOnFailure: true, createdAt: "2026-08-01", updatedAt: "2026-08-01" });
const mockRules = [rule("one"), rule("two", "REMINDER"), rule("inactive", "THANKS", false), rule("hidden", "CLIENT_WELCOME")];
const cacheKey = ["settings", "message-automation-config", "branch-1"];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MessageSettingsPage /></QueryClientProvider>;
  const view = render(tree());
  return { ...view, client, rerenderPage: () => view.rerender(tree()) };
}
async function interval() { return screen.findByLabelText("늦은 등록 자동 전송 간격"); }
async function edit(value: string) { fireEvent.change(await interval(), { target: { value } }); }
function save() { fireEvent.click(screen.getByRole("button", { name: "저장", exact: true })); }

beforeAll(() => {
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => false });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: () => undefined });
});
beforeEach(() => {
  jest.clearAllMocks(); mockItem = "past-trigger"; mockBranch = "branch-1";
  api.getMessageAutomationConfig.mockResolvedValue(response());
  api.updateMessageAutomationConfig.mockImplementation(async (input) => response(input.configuration, "v2"));
  api.getMessageSenderApproval.mockResolvedValue({ isApproved: true, approvalStatus: "approved", canRequest: true, requestedAt: null, approvedAt: null });
  api.getMessageAutomationPolicies.mockResolvedValue({ policies: ["trigger-dispatch", "trigger-job-retry", "sms-retry", "past-trigger", "service-feedback-link"].map((id) => ({ id, title: id, description: id, active: true, requiresApproval: false, rows: [{ id: "target", label: "대상", value: "늦게 등록된 고객" }] })), pastTriggerConfig: { sendIntervalMinutes: 5, ruleOrder: CONFIG.pastRuleOrder } });
  api.previewMessageAutomationConfig.mockResolvedValue({ version: "v1", deferredCount: 3, canceledCount: 1, reevaluateAt: "2026-11-07T00:00:00.000Z", futureProviderReservations: 2, canEnableQuietHours: true, warnings: [] });
});

describe("actual settings route manual configuration", () => {
  it("renders policy information and only active SMS ordering rules", async () => {
    mount(); await interval();
    expect(screen.getByText("첫 번째 규칙")).toBeInTheDocument();
    expect(screen.getByText("두 번째 규칙")).toBeInTheDocument();
    expect(screen.queryByText("inactive")).not.toBeInTheDocument();
    expect(screen.queryByText("hidden")).not.toBeInTheDocument();
    expect(screen.getByText("늦게 등록된 고객")).toBeInTheDocument();
  });
  it("edits and reorders without autosaving, then submits one versioned configuration", async () => {
    mount(); await edit("15");
    fireEvent.click(screen.getByRole("button", { name: "첫 번째 규칙 아래로 이동" }));
    expect(api.updateMessageAutomationConfig).not.toHaveBeenCalled();
    save();
    await waitFor(() => expect(api.updateMessageAutomationConfig).toHaveBeenCalledTimes(1));
    expect(api.updateMessageAutomationConfig).toHaveBeenCalledWith({ expectedVersion: "v1", configuration: { ...CONFIG, pastSendIntervalMinutes: 15, pastRuleOrder: ["hidden", "two", "one"] } }, "branch-1");
  });
  it("coalesces rapid reorders locally and performs zero writes when restored", async () => {
    mount(); await interval();
    fireEvent.click(screen.getByRole("button", { name: "첫 번째 규칙 아래로 이동" }));
    fireEvent.click(screen.getByRole("button", { name: "두 번째 규칙 아래로 이동" }));
    expect(screen.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    expect(api.updateMessageAutomationConfig).not.toHaveBeenCalled();
  });
  it.each(["0", "1441", ""])("blocks invalid interval %s including reordered drafts", async (value) => {
    mount(); await edit(value);
    fireEvent.click(screen.getByRole("button", { name: "첫 번째 규칙 아래로 이동" }));
    expect(screen.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    expect(api.updateMessageAutomationConfig).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("1~1440");
  });
  it.each(["1", "1440"])("saves valid boundary interval %s explicitly", async (value) => {
    mount(); await edit(value); save();
    await waitFor(() => expect(api.updateMessageAutomationConfig).toHaveBeenCalledWith({ expectedVersion: "v1", configuration: { ...CONFIG, pastSendIntervalMinutes: Number(value) } }, "branch-1"));
  });
  it("Cancel restores persisted values without writing", async () => {
    mount(); await edit("15"); fireEvent.click(screen.getByRole("button", { name: "취소", exact: true }));
    expect(await interval()).toHaveValue(5); expect(api.updateMessageAutomationConfig).not.toHaveBeenCalled();
  });
  it("restores the persisted draft on failure and resets the pending state", async () => {
    api.updateMessageAutomationConfig.mockRejectedValue(new Error("save failed"));
    const { client } = mount(); await edit("15"); save();
    expect(await screen.findByRole("alert")).toHaveTextContent("저장하지 못했어요");
    expect(await interval()).toHaveValue(5); expect(client.getQueryData(cacheKey)).toEqual(response());
    expect(screen.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
  });
  it.each(["success", "failure"])("preserves newer pending edits after %s with no queued automatic write", async (outcome) => {
    let resolve!: (value: MessageAutomationPolicyConfigResponse) => void;
    let reject!: (reason: Error) => void;
    api.updateMessageAutomationConfig.mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    mount(); await edit("15"); save();
    await waitFor(() => expect(api.updateMessageAutomationConfig).toHaveBeenCalledTimes(1));
    await edit("20");
    await act(async () => { if (outcome === "success") resolve(response({ ...CONFIG, pastSendIntervalMinutes: 15 }, "v2")); else reject(new Error("save failed")); });
    expect(await interval()).toHaveValue(20); expect(api.updateMessageAutomationConfig).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
  });
  it("adopts idle refetch and preserves invalid local drafts through later refetch", async () => {
    const { client } = mount(); await interval();
    act(() => { client.setQueryData(cacheKey, response({ ...CONFIG, pastSendIntervalMinutes: 9 }, "v2")); });
    expect(await interval()).toHaveValue(9);
    await edit("");
    act(() => { client.setQueryData(cacheKey, response({ ...CONFIG, pastSendIntervalMinutes: 10 }, "v3")); });
    expect(await interval()).toHaveValue(null);
  });
  it("preserves a stale409 draft and does not overwrite the remote configuration", async () => {
    api.updateMessageAutomationConfig.mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
    const { client } = mount(); await edit("15"); save();
    expect(await screen.findByRole("alert")).toHaveTextContent("새로고침");
    expect(await interval()).toHaveValue(15); expect(client.getQueryData(cacheKey)).toEqual(response());
    expect(api.updateMessageAutomationConfig).toHaveBeenCalledTimes(1);
  });
  it("supports null version initialization", async () => {
    api.getMessageAutomationConfig.mockResolvedValue(response(CONFIG, null));
    mount(); await edit("15"); save();
    await waitFor(() => expect(api.updateMessageAutomationConfig).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: null }), "branch-1"));
  });
  it("retains dirty draft until item navigation is explicitly confirmed", async () => {
    mount(); await edit("15"); fireEvent.click(screen.getByText("중복 전송 확인"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument(); expect(mockPush).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "변경 취소", exact: true }));
    expect(mockPush).toHaveBeenCalledWith("?item=duplicate-send-confirmation", { scroll: false });
    expect(api.updateMessageAutomationConfig).not.toHaveBeenCalled();
  });
  it("does not expose editable fallback values after a503", async () => {
    api.getMessageAutomationConfig.mockRejectedValue(new Error("503"));
    mount(); expect(await screen.findByRole("alert")).toHaveTextContent("불러올 수 없습니다");
    expect(screen.queryByLabelText("늦은 등록 자동 전송 간격")).not.toBeInTheDocument();
    expect(screen.getByText("확인 불가")).toBeInTheDocument(); expect(api.updateMessageAutomationConfig).not.toHaveBeenCalled();
  });
  it("honors read-only permission", async () => {
    api.getMessageAutomationConfig.mockResolvedValue({ ...response(), permissions: { canRead: true, canWrite: false } });
    mount(); expect(await interval()).toBeDisabled();
    expect(screen.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
  });
  it.each([
    ["trigger-dispatch", "자동 전송 확인 간격 (분)", "1"], ["trigger-dispatch", "기본 발송 시각 (한국 시간)", "23:59"],
    ["trigger-job-retry", "자동 전송 재시도 간격 (분)", "1440"], ["trigger-job-retry", "처리 중 작업 재확인 간격 (분)", "10"],
    ["sms-retry", "SMS 재시도 간격 (분)", "1"], ["past-trigger", "지난 자동 전송 유효 기간 (시간)", "720"], ["duplicate-send-confirmation", "중복 전송 확인 범위 (시간)", "1"],
  ])("mounts canonical field %s/%s in its existing item", async (item, label, value) => {
    mockItem = item; mount(); const input = await screen.findByLabelText(label); fireEvent.change(input, { target: { value } });
    expect(api.updateMessageAutomationConfig).not.toHaveBeenCalled();
  });
  it("blocks reclaim7, equal quiet times, and quietON without targets", async () => {
    mockItem = "trigger-job-retry"; const view = mount();
    fireEvent.change(await screen.findByLabelText("처리 중 작업 재확인 간격 (분)"), { target: { value: "7" } });
    expect(screen.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    view.unmount(); mockItem = "quiet-hours"; mount();
    const start = await screen.findByLabelText("시작 시각 (한국 시간)");
    fireEvent.change(start, { target: { value: "08:00" } });
    expect(screen.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    fireEvent.change(start, { target: { value: "21:00" } });
    fireEvent.click(screen.getByRole("switch", { name: "심야 시간 메세지 전송 금지", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "고객", exact: true }));
    expect(screen.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    expect(api.updateMessageAutomationConfig).not.toHaveBeenCalled();
  });
  it("uses multi groups and reads server preview without saving or sending", async () => {
    mockItem = "quiet-hours"; mount(); await screen.findByLabelText("시작 시각 (한국 시간)");
    fireEvent.click(screen.getByRole("button", { name: "직원", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "제공인력", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "영향 미리보기" }));
    await waitFor(() => expect(api.previewMessageAutomationConfig).toHaveBeenCalledWith({ ...CONFIG, quietHours: { ...CONFIG.quietHours, recipientGroups: ["CLIENT", "STAFF", "CAREGIVER"] } }, "branch-1", "v1"));
    expect(await screen.findByText("3건")).toBeInTheDocument(); expect(api.updateMessageAutomationConfig).not.toHaveBeenCalled();
  });
  it("does not silently upgrade a dirty draft after a newer remote version arrives", async () => {
    const { client } = mount(); await edit("15");
    act(() => { client.setQueryData(cacheKey, response({ ...CONFIG, pastSendIntervalMinutes: 9 }, "v2")); });
    expect(await interval()).toHaveValue(15); save();
    await waitFor(() => expect(api.updateMessageAutomationConfig).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: "v1" }), "branch-1"));
  });

});
