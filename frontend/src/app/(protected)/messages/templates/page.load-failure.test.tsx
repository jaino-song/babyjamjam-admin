import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

import TemplatesPage from "./page";

const mockList = jest.fn();
const mockDetail = jest.fn();
const mockListRefetch = jest.fn();
const mockDetailRefetch = jest.fn();

jest.mock("@/features/message-templates/hooks/use-message-templates", () => ({
  useMessageTemplates: () => mockList(),
  useDeleteMessageTemplate: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplate: () => mockDetail(),
  useUpdateMessageTemplate: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
// Keep the real ListPanel, list slots, form and QueryErrorState.
jest.mock("@/components/app/v3", () => ({
  ...jest.requireActual("@/components/app/v3"),
  SplitLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const template = {
  id: "template-1", name: "검수 템플릿", content: "안녕하세요", variables: [],
  createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T00:00:00.000Z",
};
type State = "success" | "failed" | "loading" | "paused" | "disabled";
function query(data: unknown, state: State, refetch: () => void, isFetching = false) {
  return {
    data, refetch, isLoading: state === "loading", isError: state === "failed",
    isFetching: state === "loading" || isFetching, isPaused: state === "paused",
    isPending: ["loading", "paused", "disabled"].includes(state),
    status: state === "failed" ? "error" : state === "success" ? "success" : "pending",
    fetchStatus: state === "paused" ? "paused" : state === "loading" || isFetching ? "fetching" : "idle",
  };
}
const emptyText = "등록된 지점 템플릿이 없습니다.";
const missingText = "지점 템플릿을 불러올 수 없어요.";
const latestText = "최신 정보를 불러오지 못했습니다";
const skeletonSelector = '[data-component="desktop_messages_sections_templates_split-layout_list-panel_templates-list"] [data-slot="skeleton"]';

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockReturnValue(query([template], "success", mockListRefetch));
  mockDetail.mockReturnValue(query(template, "success", mockDetailRefetch));
});

describe("template list load states", () => {
  it("retries a failed first load through the clickable panel overlay", () => {
    mockList.mockReturnValue(query(undefined, "failed", mockListRefetch));
    render(<TemplatesPage />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("불러오지 못했습니다");
    expect(alert).toHaveAttribute("data-size", "panel");
    expect(alert).toHaveClass("pointer-events-auto");
    expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(mockListRefetch).toHaveBeenCalledTimes(1);
  });
  it.each<State>(["loading", "paused"])("shows existing skeletons for %s with no data", (state) => {
    mockList.mockReturnValue(query(undefined, state, mockListRefetch));
    const { container } = render(<TemplatesPage />);
    expect(container.querySelector(skeletonSelector)).toBeInTheDocument();
    expect(screen.queryByText(emptyText)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it.each<State>(["success", "disabled"])("preserves the empty rendering for %s", (state) => {
    mockList.mockReturnValue(query(state === "success" ? [] : undefined, state, mockListRefetch));
    render(<TemplatesPage />);
    expect(screen.getByText(emptyText)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it.each([false, true])("keeps cached rows/empty results on failure (empty=%s)", (empty) => {
    mockList.mockReturnValue(query(empty ? [] : [template], "failed", mockListRefetch));
    render(<TemplatesPage />);
    expect(screen.getByText(empty ? emptyText : template.name)).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(latestText);
    expect(alert).toHaveAttribute("data-size", "inline");
    expect(alert).toHaveAttribute("data-component", "desktop_messages_sections_templates_split-layout_list-panel_load-error");
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(mockListRefetch).toHaveBeenCalledTimes(1);
  });
  it("disables cached-list retry while fetching", () => {
    mockList.mockReturnValue(query([template], "failed", mockListRefetch, true));
    render(<TemplatesPage />);
    expect(within(screen.getByRole("alert")).getByRole("button")).toBeDisabled();
    expect(screen.getByText(template.name)).toBeInTheDocument();
  });
  it("keeps cached data unchanged during a paused refetch", () => {
    mockList.mockReturnValue(query([template], "paused", mockListRefetch));
    const { container } = render(<TemplatesPage />);
    expect(screen.getByText(template.name)).toBeInTheDocument();
    expect(container.querySelector(skeletonSelector)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

function selectTemplate() {
  fireEvent.click(screen.getByText(template.name));
}
describe("branch template detail load states", () => {
  it("does not fetch/render a detail failure without a selection", () => {
    render(<TemplatesPage />);
    expect(mockDetail).not.toHaveBeenCalled();
    expect(screen.getByText("지점 템플릿을 선택하면 상세 정보가 표시됩니다.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("retries a failed detail instead of showing missing text", () => {
    mockDetail.mockReturnValue(query(undefined, "failed", mockDetailRefetch));
    render(<TemplatesPage />);
    selectTemplate();
    expect(screen.getByRole("alert")).toHaveTextContent("지점 템플릿을 불러오지 못했습니다");
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "panel");
    expect(screen.queryByText(missingText)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/지점 템플릿 이름/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(mockDetailRefetch).toHaveBeenCalledTimes(1);
  });
  it.each<State>(["loading", "paused"])("shows the detail skeleton for %s", (state) => {
    mockDetail.mockReturnValue(query(undefined, state, mockDetailRefetch));
    const { container } = render(<TemplatesPage />);
    selectTemplate();
    expect(container.querySelector('[data-component="desktop_messages_sections_templates_user-loading"]')).toBeInTheDocument();
    expect(screen.queryByText(missingText)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/지점 템플릿 이름/)).not.toBeInTheDocument();
  });
  it.each<State>(["success", "disabled"])("preserves no-template rendering for %s", (state) => {
    mockDetail.mockReturnValue(query(undefined, state, mockDetailRefetch));
    render(<TemplatesPage />);
    selectTemplate();
    expect(screen.getByText(missingText)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("keeps unsaved edits and save enabled after a cached-detail refetch failure", () => {
    const view = render(<TemplatesPage />);
    selectTemplate();
    fireEvent.change(screen.getByLabelText(/지점 템플릿 이름/), { target: { value: "미저장 이름" } });
    fireEvent.change(screen.getByLabelText(/템플릿 내용/), { target: { value: "미저장 내용" } });
    mockDetail.mockReturnValue(query(template, "failed", mockDetailRefetch));
    view.rerender(<TemplatesPage />);
    expect(screen.getByLabelText(/지점 템플릿 이름/)).toHaveValue("미저장 이름");
    expect(screen.getByLabelText(/템플릿 내용/)).toHaveValue("미저장 내용");
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(latestText);
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "inline");
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" }));
    expect(mockDetailRefetch).toHaveBeenCalledTimes(1);
  });
  it("disables only retry while cached-detail refetch is in flight", () => {
    mockDetail.mockReturnValue(query(template, "failed", mockDetailRefetch, true));
    render(<TemplatesPage />);
    selectTemplate();
    expect(within(screen.getByRole("alert")).getByRole("button")).toBeDisabled();
    expect(screen.getByLabelText(/지점 템플릿 이름/)).toHaveValue(template.name);
  });
  it.each<State>(["success", "paused"])("keeps the loaded detail for %s", (state) => {
    mockDetail.mockReturnValue(query(template, state, mockDetailRefetch));
    render(<TemplatesPage />);
    selectTemplate();
    expect(screen.getByLabelText(/지점 템플릿 이름/)).toHaveValue(template.name);
    expect(screen.getByLabelText(/템플릿 내용/)).toHaveValue(template.content);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
