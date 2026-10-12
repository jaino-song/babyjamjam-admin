import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ContractLinkConfirmSheet } from "./contract-link-confirm-sheet";
import { eformsignApi, type EformsignLinkConfirmation } from "@/services/api";

const mockUpdate = jest.fn();
const mockInvalidate = jest.fn();
jest.mock("@/hooks/useClients", () => ({
  useUpdateClient: () => ({ mutateAsync: mockUpdate }),
  clientQueryKeys: { all: ["clients"], detail: (id: number) => ["clients", "detail", id] },
}));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock("@/services/api", () => ({ eformsignApi: { adoptDocument: jest.fn() } }));

const entry: EformsignLinkConfirmation = {
  documentId: "doc-1", documentName: "A", statusType: "020", statusDetail: "", createdDate: "2026-10-13T00:00:00Z",
  document: { name: "계약 이름", phone: "01012345678", birthday: "1990-01-01" },
  client: { id: 7, name: "고객 이름", phone: "01012345678", birthday: "1991-02-02" },
  differences: ["name", "birthday"], canConfirm: true,
};
const mockAdopt = jest.mocked(eformsignApi.adoptDocument);
const mockClose = jest.fn();
const mockRefetch = jest.fn();
function mount(value = entry) {
  return render(<ContractLinkConfirmSheet data-component="mobile_clients_detail_contract-link-confirm" entry={value} onClose={mockClose} refetchConfirmations={mockRefetch} />);
}
async function choose(side: "계약서" | "고객 정보") {
  const user = userEvent.setup();
  await user.click(screen.getByRole("radio", { name: `${side}: ${side === "계약서" ? "계약 이름" : "고객 이름"}` }));
  expect(screen.getByRole("button", { name: "확정" })).toBeDisabled();
  await user.click(screen.getByRole("radio", { name: `${side}: ${side === "계약서" ? "1990-01-01" : "1991-02-02"}` }));
}
beforeEach(() => {
  jest.clearAllMocks();
  mockUpdate.mockReset().mockResolvedValue({});
  mockAdopt.mockReset().mockResolvedValue({ documentId: "doc-1" });
  mockRefetch.mockReset().mockResolvedValue({ data: [entry], isError: false });
});

it("updates exactly chosen fields before adopting and invalidates projections", async () => {
  mount();
  expect(screen.getByText("전화번호: 010-1234-5678")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "확정" })).toBeDisabled();
  await choose("계약서");
  fireEvent.click(screen.getByRole("button", { name: "확정" }));
  await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(mockUpdate).toHaveBeenCalledWith({ id: 7, dto: { name: "계약 이름", birthday: "1990-01-01" } });
  expect(mockAdopt).toHaveBeenCalledWith("doc-1", 7);
  expect(mockUpdate.mock.invocationCallOrder[0]).toBeLessThan(mockAdopt.mock.invocationCallOrder[0]);
  expect(mockInvalidate.mock.calls.map(call => call[0].queryKey)).toEqual([
    ["clients"], ["clients", "detail", 7], ["eformsign-docs", "document"], ["eformsign-docs", "link-confirmations", 7],
  ]);
});
it("only client values adopts without a client update", async () => {
  mount(); await choose("고객 정보");
  fireEvent.click(screen.getByRole("button", { name: "확정" }));
  await waitFor(() => expect(mockClose).toHaveBeenCalled());
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockAdopt).toHaveBeenCalledTimes(1);
});
it("mixed choices update only the contract-chosen field", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("radio", { name: "계약서: 계약 이름" }));
  await user.click(screen.getByRole("radio", { name: "고객 정보: 1991-02-02" }));
  fireEvent.click(screen.getByRole("button", { name: "확정" }));
  await waitFor(() => expect(mockClose).toHaveBeenCalled());
  expect(mockUpdate).toHaveBeenCalledWith({ id: 7, dto: { name: "계약 이름" } });
});
it("an update failure stays open and never adopts", async () => {
  mockUpdate.mockRejectedValue(new Error("failed"));
  mount(); await choose("계약서"); fireEvent.click(screen.getByRole("button", { name: "확정" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("고객 정보를 수정하지 못했습니다. 다시 시도해 주세요.");
  expect(mockAdopt).not.toHaveBeenCalled(); expect(mockClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
it("an adopt failure after updating retries adopt only", async () => {
  mockAdopt.mockRejectedValueOnce(new Error("failed"));
  mount(); await choose("계약서"); fireEvent.click(screen.getByRole("button", { name: "확정" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("고객 정보는 수정했지만 계약서를 연결하지 못했습니다. 다시 시도해 주세요.");
  expect(mockRefetch).toHaveBeenCalledTimes(1); expect(mockClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "확정" }));
  await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
  expect(mockUpdate).toHaveBeenCalledTimes(1); expect(mockAdopt).toHaveBeenCalledTimes(2);
});
it("an adopt failure without updating shows the link-only error", async () => {
  mockAdopt.mockRejectedValue(new Error("failed"));
  mount(); await choose("고객 정보"); fireEvent.click(screen.getByRole("button", { name: "확정" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("계약서를 연결하지 못했습니다. 다시 시도해 주세요.");
  expect(mockUpdate).not.toHaveBeenCalled(); expect(mockClose).not.toHaveBeenCalled();
});
it.each(["mirror_sync_failed", "client_link_failed"] as const)("%s warnings still succeed", async warning => {
  mockAdopt.mockResolvedValue({ documentId: "doc-1", warnings: [warning] });
  mount(); await choose("고객 정보"); fireEvent.click(screen.getByRole("button", { name: "확정" }));
  await waitFor(() => expect(mockClose).toHaveBeenCalled());
});
it("a failed adopt reconciled to a removed entry succeeds", async () => {
  mockAdopt.mockRejectedValue(new Error("failed")); mockRefetch.mockResolvedValue({ data: [], isError: false });
  mount(); await choose("계약서"); fireEvent.click(screen.getByRole("button", { name: "확정" }));
  await waitFor(() => expect(mockClose).toHaveBeenCalled());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("failed reconciliation with cached empty data is not success", async () => {
  mockAdopt.mockRejectedValue(new Error("failed")); mockRefetch.mockResolvedValue({ data: [], isError: true });
  mount(); await choose("계약서"); fireEvent.click(screen.getByRole("button", { name: "확정" }));
  await screen.findByRole("alert"); expect(mockClose).not.toHaveBeenCalled();
});
it("double tap sends one sequence and disables both buttons while running", async () => {
  let resolveUpdate: (value: object) => void = () => {};
  mockUpdate.mockImplementation(() => new Promise(resolve => { resolveUpdate = resolve; }));
  mount(); await choose("계약서");
  const button = screen.getByRole("button", { name: "확정" });
  fireEvent.click(button); fireEvent.click(button);
  expect(button).toBeDisabled(); expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
  expect(mockUpdate).toHaveBeenCalledTimes(1); resolveUpdate({});
  await waitFor(() => expect(mockClose).toHaveBeenCalled()); expect(mockAdopt).toHaveBeenCalledTimes(1);
});
it("cancel calls no mutation", () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(mockClose).toHaveBeenCalled(); expect(mockUpdate).not.toHaveBeenCalled(); expect(mockAdopt).not.toHaveBeenCalled();
});
it("missing values cannot be selected and both missing need no choice", async () => {
  mount({ ...entry, document: { ...entry.document, name: null, birthday: null }, client: { ...entry.client, birthday: null } });
  expect(screen.getByRole("radio", { name: "계약서: 없음" })).toBeDisabled();
  expect(screen.getByText("양쪽 모두 정보가 없습니다")).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("radio", { name: "고객 정보: 고객 이름" }));
  expect(screen.getByRole("button", { name: "확정" })).toBeEnabled();
});
