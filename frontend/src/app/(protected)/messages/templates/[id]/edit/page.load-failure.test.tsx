import { fireEvent, render, screen, within } from "@testing-library/react";
import { act } from "react";

import EditTemplatePage from "./page";

const mockDetail = jest.fn();
const mockRefetch = jest.fn();
let mockId = "template-1";
jest.mock("next/navigation", () => ({
  useParams: () => ({ id: mockId }),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplate: (id: string) => mockDetail(id),
  useCreateMessageTemplate: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateMessageTemplate: () => ({ mutate: jest.fn(), isPending: false }),
}));

const template = {
  id: "template-1", name: "검수 템플릿", content: "안녕하세요", variables: [],
  createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T00:00:00.000Z",
};
type State = "success" | "failed" | "loading" | "paused" | "disabled";
function query(data: unknown, state: State, isFetching = false) {
  return {
    data, refetch: mockRefetch, isLoading: state === "loading", isError: state === "failed",
    error: state === "failed" ? new Error("load failed") : null,
    isFetching: state === "loading" || isFetching, isPaused: state === "paused",
    isPending: ["loading", "paused", "disabled"].includes(state),
    status: state === "failed" ? "error" : state === "success" ? "success" : "pending",
    fetchStatus: state === "paused" ? "paused" : state === "loading" || isFetching ? "fetching" : "idle",
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  mockId = template.id;
  mockDetail.mockReturnValue(query(template, "success"));
});

describe("edit template load states", () => {
  it("retries a failed first load, including API errors such as 404", () => {
    mockDetail.mockReturnValue({ ...query(undefined, "failed"), error: { status: 404 } });
    render(<EditTemplatePage />);
    expect(screen.getByRole("alert")).toHaveTextContent("템플릿을 불러오지 못했습니다");
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "panel");
    expect(screen.queryByLabelText(/템플릿 이름/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockDetail).toHaveBeenCalledWith(template.id);
  });
  it.each<State>(["loading", "paused"])("shows existing skeletons for %s with no data", (state) => {
    mockDetail.mockReturnValue(query(undefined, state));
    const { container } = render(<EditTemplatePage />);
    expect(container.querySelector('[data-component="desktop_messages_sections_template-edit-loading-skeleton"]')).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/템플릿 이름/)).not.toBeInTheDocument();
  });
  it.each<State>(["success", "disabled"])("preserves the old missing-template alert for %s", (state) => {
    mockId = state === "disabled" ? "" : template.id;
    mockDetail.mockReturnValue(query(undefined, state));
    render(<EditTemplatePage />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("데이터를 불러오는데 실패했어요.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("템플릿을 불러오지 못했습니다");
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  });
  it.each<State>(["success", "paused"])("keeps the real loaded editor for %s", async (state) => {
    mockDetail.mockReturnValue(query(template, state));
    await act(async () => { render(<EditTemplatePage />); });
    expect(screen.getByLabelText(/템플릿 이름/)).toHaveValue(template.name);
    expect(screen.queryByText("최신 정보를 불러오지 못했습니다")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  });
  it("keeps unsaved edits on cached-data failure with one retry notice", async () => {
    const view = await act(async () => render(<EditTemplatePage />));
    fireEvent.change(screen.getByLabelText(/템플릿 이름/), { target: { value: "미저장 이름" } });
    mockDetail.mockReturnValue(query(template, "failed"));
    await act(async () => { view.rerender(<EditTemplatePage />); });
    expect(screen.getByLabelText(/템플릿 이름/)).toHaveValue("미저장 이름");
    // The real editor also has its existing informational Tip alert.
    expect(screen.getAllByText("최신 정보를 불러오지 못했습니다")).toHaveLength(1);
    const notice = screen.getByText("최신 정보를 불러오지 못했습니다").closest('[role="alert"]') as HTMLElement;
    expect(notice).toHaveAttribute("data-size", "inline");
    fireEvent.click(within(notice).getByRole("button", { name: "다시 시도" }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
  it("disables cached-data retry during refetch without hiding the editor", async () => {
    mockDetail.mockReturnValue(query(template, "failed", true));
    await act(async () => { render(<EditTemplatePage />); });
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeDisabled();
    expect(screen.getByLabelText(/템플릿 이름/)).toHaveValue(template.name);
  });
});
