import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CanceledAutomationRetryRoutine } from "@babyjamjam/shared/types/message";
import { messagePolicyApi } from "@/services/settings";
import { CanceledAutomationRetrySettings } from "../CanceledAutomationRetrySettings";

let activeBranch = "A";
jest.mock("@/features/system-templates/branch-context", () => ({
  isBranchContextAligned: (branch: string) => branch === activeBranch,
}));
jest.mock("@/services/settings", () => ({
  messagePolicyApi: { listCanceledAutomationRetries: jest.fn(), updateCanceledAutomationRetry: jest.fn() },
}));

const api = jest.mocked(messagePolicyApi);
const sharedRoutine: CanceledAutomationRetryRoutine = {
  id: "shared-info",
  label: "고객 안내",
  eligible: true,
  unavailableReason: null,
  recoverableReasons: ["target_client_status_not_met"],
  enabled: false,
  enabledAt: null,
};
const saved = { ...sharedRoutine, enabled: true, enabledAt: "2026-11-23T08:00:00.123Z" };
const switchName = "고객 안내 취소 자동화 재시도";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function settingsView(branch: string, canManageActivation = true, client = createQueryClient()) {
  return (
    <QueryClientProvider client={client}>
      <CanceledAutomationRetrySettings
        key={branch}
        branchId={branch}
        canManageActivation={canManageActivation}
        data-component="desktop_messages_sections_split-layout_detail-panel-2_canceled-retry"
      />
    </QueryClientProvider>
  );
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

beforeEach(() => {
  jest.resetAllMocks();
  activeBranch = "A";
});

it("renders only catalog routines, independently labels each switch and explains unavailable entries", async () => {
  api.listCanceledAutomationRetries.mockResolvedValue({
    canManageActivation: true,
    routines: [
      sharedRoutine,
      { ...sharedRoutine, id: "disabled", label: "꺼진 루틴", eligible: false, unavailableReason: "routine_disabled" },
      { ...sharedRoutine, id: "unsupported", label: "제공인력 안내", eligible: false, unavailableReason: "unsupported", recoverableReasons: [] },
    ],
  });
  render(settingsView("A"));

  const enabledControl = await screen.findByRole("switch", { name: switchName });
  expect(enabledControl).toBeEnabled();
  expect(enabledControl).not.toBeChecked();
  expect(screen.getByText("대상 고객 상태 불일치")).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "꺼진 루틴 취소 자동화 재시도" })).toBeDisabled();
  expect(screen.getByText("이 루틴이 꺼져 있어요.")).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "제공인력 안내 취소 자동화 재시도" })).toBeDisabled();
  expect(screen.getByText("이 루틴은 취소 후 재시도를 지원하지 않아요.")).toBeInTheDocument();
  expect(screen.getAllByRole("switch")).toHaveLength(3);
});

it.each([[false, true], [true, false]])("is read-only with policy permission %s and catalog permission %s", async (policyPermission, catalogPermission) => {
  api.listCanceledAutomationRetries.mockResolvedValue({ canManageActivation: catalogPermission, routines: [saved] });
  render(settingsView("A", policyPermission));

  const control = await screen.findByRole("switch", { name: switchName });
  expect(control).toBeChecked();
  expect(control).toBeDisabled();
  fireEvent.click(control);
  expect(api.updateCanceledAutomationRetry).not.toHaveBeenCalled();
});

it("shows pending, success and persisted state after reload, then reports a rejected save and can retry", async () => {
  const first = deferred<CanceledAutomationRetryRoutine>();
  const second = deferred<CanceledAutomationRetryRoutine>();
  let stored = sharedRoutine;
  api.listCanceledAutomationRetries.mockImplementation(async () => ({ canManageActivation: true, routines: [stored] }));
  api.updateCanceledAutomationRetry.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const original = render(settingsView("A"));
  const control = await screen.findByRole("switch", { name: switchName });

  fireEvent.click(control);
  expect(await screen.findByRole("status", { name: `${switchName} 설정 저장 중` })).toBeInTheDocument();
  expect(control).toBeDisabled();
  expect(api.updateCanceledAutomationRetry).toHaveBeenCalledWith("shared-info", { enabled: true }, "A");
  stored = saved;
  await act(async () => first.resolve(saved));
  expect(await screen.findByText("설정을 저장했어요.")).toBeInTheDocument();
  expect(control).toBeChecked();
  original.unmount();

  render(settingsView("A"));
  const reloaded = await screen.findByRole("switch", { name: switchName });
  expect(reloaded).toBeChecked();
  fireEvent.click(reloaded);

  await waitFor(() => expect(api.updateCanceledAutomationRetry).toHaveBeenLastCalledWith("shared-info", { enabled: false }, "A"));
  await act(async () => second.reject(new Error("save rejected")));
  expect(await screen.findByRole("alert")).toHaveTextContent("설정을 저장하지 못했어요.");
  expect(reloaded).toBeChecked();
  expect(reloaded).toBeEnabled();

  api.updateCanceledAutomationRetry.mockImplementationOnce(async () => {
    stored = sharedRoutine;
    return stored;
  });
  fireEvent.click(reloaded);
  expect(await screen.findByText("설정을 저장했어요.")).toBeInTheDocument();
  expect(reloaded).not.toBeChecked();
});

it("reports a catalog load failure and reloads on request", async () => {
  api.listCanceledAutomationRetries
    .mockRejectedValueOnce(new Error("read rejected"))
    .mockResolvedValueOnce({ canManageActivation: true, routines: [sharedRoutine] });
  render(settingsView("A"));
  expect(await screen.findByRole("alert")).toHaveTextContent("취소 자동화 재시도 설정을 불러오지 못했어요");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(await screen.findByRole("switch", { name: switchName })).not.toBeChecked();
});

it("never applies an old save response to the same shared routine in another branch", async () => {
  const pending = deferred<CanceledAutomationRetryRoutine>();
  api.listCanceledAutomationRetries.mockResolvedValue({ canManageActivation: true, routines: [sharedRoutine] });
  api.updateCanceledAutomationRetry.mockReturnValueOnce(pending.promise);
  const client = createQueryClient();
  const view = render(settingsView("A", true, client));
  fireEvent.click(await screen.findByRole("switch", { name: switchName }));
  await waitFor(() => expect(api.updateCanceledAutomationRetry).toHaveBeenCalledWith("shared-info", { enabled: true }, "A"));

  activeBranch = "B";
  view.rerender(settingsView("B", true, client));
  const nextControl = await screen.findByRole("switch", { name: switchName });
  expect(nextControl).not.toBeChecked();
  await act(async () => pending.resolve(saved));
  expect(nextControl).toBeEnabled();
  expect(nextControl).not.toBeChecked();
  expect(screen.queryByText("설정을 저장했어요.")).not.toBeInTheDocument();
  expect(api.updateCanceledAutomationRetry).toHaveBeenCalledTimes(1);
  expect(api.listCanceledAutomationRetries).toHaveBeenLastCalledWith("B", expect.any(AbortSignal));
});

it("reads current settings after returning to the submitted branch before an old response", async () => {
  const pending = deferred<CanceledAutomationRetryRoutine>();
  let stored = sharedRoutine;
  api.listCanceledAutomationRetries.mockImplementation(async (branchId) => ({
    canManageActivation: true,
    routines: [branchId === "A" ? stored : sharedRoutine],
  }));
  api.updateCanceledAutomationRetry.mockReturnValueOnce(pending.promise).mockImplementationOnce(async () => {
    stored = sharedRoutine;
    return stored;
  });
  const client = createQueryClient();
  const view = render(settingsView("A", true, client));
  fireEvent.click(await screen.findByRole("switch", { name: switchName }));
  await waitFor(() => expect(api.updateCanceledAutomationRetry).toHaveBeenCalledTimes(1));
  stored = saved;

  activeBranch = "B";
  view.rerender(settingsView("B", true, client));
  expect(await screen.findByRole("switch", { name: switchName })).not.toBeChecked();
  activeBranch = "A";
  view.rerender(settingsView("A", true, client));
  const control = await screen.findByRole("switch", { name: switchName });
  await waitFor(() => expect(control).toBeChecked());
  fireEvent.click(control);
  expect(await screen.findByText("설정을 저장했어요.")).toBeInTheDocument();
  expect(control).not.toBeChecked();

  await act(async () => pending.resolve(saved));
  expect(control).not.toBeChecked();
  expect(api.updateCanceledAutomationRetry).toHaveBeenLastCalledWith("shared-info", { enabled: false }, "A");
});
