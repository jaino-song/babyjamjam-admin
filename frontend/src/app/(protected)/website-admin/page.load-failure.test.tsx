import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";

import WebsiteAdminPage from "./page";

jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"), useQuery: jest.fn(),
}));
jest.mock("@/services/api", () => ({ settingsApi: {
  getRibbonConfig: jest.fn(), updateRibbonConfig: jest.fn(),
} }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));

const config = { enabled: true, message: "현재 리본", backgroundColor: "#004AAD", textColor: "#FFFFFF", linkText: "", linkHref: "", linkColor: "#FFB27B" };
const refetch = jest.fn();
const query = {
  data: undefined as typeof config | null | undefined,
  isLoading: false, isPending: false, isPaused: false, isError: false,
  isFetching: false, status: "success", fetchStatus: "idle", refetch,
};
function setQuery(overrides: Partial<typeof query>) {
  jest.mocked(useQuery).mockReturnValue({ ...query, ...overrides } as unknown as ReturnType<typeof useQuery>);
}
function renderPage(overrides: Partial<typeof query>) {
  setQuery(overrides);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = <QueryClientProvider client={client}><WebsiteAdminPage /></QueryClientProvider>;
  const view = render(element);
  fireEvent.click(screen.getAllByText("리본 배너")[0]);
  return { ...view, client };
}

describe("WebsiteAdminPage ribbon load", () => {
  beforeEach(() => refetch.mockClear());

  it("replaces an unknown failed config with a retry panel, not an editable default", () => {
    const { container } = renderPage({ isError: true, status: "error" });
    expect(screen.getByRole("alert")).toHaveTextContent("리본 설정을 불러오지 못했습니다");
    expect(container.querySelector("input")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { isLoading: true, isPending: true, status: "pending", isFetching: true, fetchStatus: "fetching" },
    { isLoading: false, isPending: true, isPaused: true, isError: false, isFetching: false, status: "pending", fetchStatus: "paused" },
  ])("shows the existing skeleton rather than defaults: %j", (state) => {
    const { container } = renderPage(state);
    expect(container.querySelector('[data-component="desktop_website-admin_ribbon_loading-skeleton"]')).toBeInTheDocument();
    expect(container.querySelector("input")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows loaded config without an alert", () => {
    renderPage({ data: config });
    expect(screen.getByLabelText("메시지")).toHaveValue("현재 리본");
    expect(screen.getByRole("switch", { name: "활성화" })).toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the whole-object fallback after a successful null response", () => {
    renderPage({ data: null });
    expect(screen.getByLabelText("메시지")).toHaveValue("");
    expect(screen.getByRole("switch", { name: "활성화" })).not.toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps cached config and unsaved edits when a refetch fails", () => {
    const { rerender, client } = renderPage({ data: config });
    fireEvent.change(screen.getByLabelText("메시지"), { target: { value: "작성 중" } });
    setQuery({ data: config, isError: true, status: "error" });
    rerender(<QueryClientProvider client={client}><WebsiteAdminPage /></QueryClientProvider>);
    expect(screen.getByLabelText("메시지")).toHaveValue("작성 중");
    expect(screen.getByRole("switch", { name: "활성화" })).toBeChecked();
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("treats cached null as data on failed refetch", () => {
    renderPage({ data: null, isError: true, status: "error" });
    expect(screen.getByLabelText("메시지")).toHaveValue("");
    expect(screen.getByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
  });

  it("disables retry during a cached-data refetch", () => {
    renderPage({ data: config, isError: true, status: "error", isFetching: true, fetchStatus: "fetching" });
    expect(within(screen.getByRole("alert")).getByRole("button")).toBeDisabled();
    expect(screen.getByLabelText("메시지")).toBeEnabled();
  });

  it("does not hide cached config during a paused refetch", () => {
    renderPage({ data: config, isPaused: true, fetchStatus: "paused" });
    expect(screen.getByLabelText("메시지")).toHaveValue("현재 리본");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
