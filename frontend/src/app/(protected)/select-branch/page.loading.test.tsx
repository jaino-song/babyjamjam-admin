import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import SelectBranchPage from "./page";
import LogoutPage from "@/app/logout/page";

const mockReplace = jest.fn();
const mockBranches = jest.fn();
const mockSelect = jest.fn();
const mockLogout = jest.fn();
const mockRouter = { replace: mockReplace, push: jest.fn() };

jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("./actions", () => ({ getUserBranches: () => mockBranches(), setCurrentBranch: () => mockSelect() }));
jest.mock("@/app/logout/actions", () => ({ logout: () => mockLogout() }));
jest.mock("@/lib/auth/authority-state", () => ({ resetAuthorityState: jest.fn() }));
jest.mock("@/lib/notifications/push-endpoint", () => ({ getCurrentPushEndpoint: jest.fn() }));

let queryClient: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  queryClient = new QueryClient();
  mockBranches.mockReturnValue(new Promise(() => {}));
  mockLogout.mockReturnValue(new Promise(() => {}));
  mockSelect.mockReturnValue(new Promise(() => {}));
});
afterEach(() => queryClient.clear());

function renderBranches() {
  return render(<QueryClientProvider client={queryClient}><SelectBranchPage /></QueryClientProvider>);
}

it("replaces the branch loading title with a named inline spinner", () => {
  renderBranches();
  const status = screen.getByRole("status", { name: "지점 불러오는 중" });
  expect(status).toHaveAttribute("data-slot", "loading-state");
  expect(status.querySelector(".sr-only")).toHaveTextContent("지점 불러오는 중");
});

it("preserves the empty-branch logout action while announcing that logout is pending", async () => {
  mockBranches.mockResolvedValue({ success: true, branches: [] });
  renderBranches();
  fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));
  const button = screen.getByRole("button", { name: "로그아웃 중" });
  expect(button).toBeDisabled();
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveTextContent("로그아웃");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("invisible");
  await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
});

it("labels the spinner in the selected branch row", async () => {
  mockBranches.mockResolvedValue({ success: true, branches: [{ id: "qa-branch", name: "개발QA점", slug: "dev-qa", role: "owner", description: null }] });
  renderBranches();
  fireEvent.click(await screen.findByRole("button", { name: /개발QA점/ }));
  const status = screen.getByRole("status", { name: "지점 선택 중" });
  expect(status.querySelector(".sr-only")).toHaveTextContent("지점 선택 중");
  expect(status.closest("button")).toBeDisabled();
  await waitFor(() => expect(mockSelect).toHaveBeenCalledTimes(1));
});

it("keeps the logout route's spinner until logout completes and then navigates", async () => {
  let resolveLogout!: (result: { success: boolean }) => void;
  mockLogout.mockImplementation(() => new Promise((resolve) => { resolveLogout = resolve; }));
  render(<LogoutPage />);
  const status = screen.getByRole("status", { name: "로그아웃 중" });
  expect(status.querySelector(".sr-only")).toHaveTextContent("로그아웃 중");
  await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  await act(async () => resolveLogout({ success: true }));
  expect(mockReplace).toHaveBeenCalledWith("/login");
});
