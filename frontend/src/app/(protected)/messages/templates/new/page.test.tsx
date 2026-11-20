import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NewTemplatePage from "./page";
import { messageTemplatesApi } from "@/features/message-templates/api/message-templates.api";
import { api } from "@/lib/api/client";

const mockPush = jest.fn();
let mockHistoryLoading = false;
let mockTemplates = [{ id: "one" }, { id: "two" }, { id: "three" }];

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({ data: { role: "owner" } }),
}));
jest.mock("@/components/app/messages/MessageApprovalGate", () => ({
  useMessageSenderApproval: () => ({ data: { isApproved: true } }),
}));
jest.mock("@/features/document-jobs/DocumentJobsProvider", () => ({
  useDocumentJobs: () => ({ total: 0 }),
}));
jest.mock("@/components/app/messages/useMessageHistoryListState", () => ({
  useMessageHistoryListState: () => ({
    isPanelLoading: mockHistoryLoading,
    statusCounts: { all: 12, upcoming: 4, sent: 5, failed: 2, canceled: 1 },
  }),
}));
jest.mock("@/features/message-templates/api/message-templates.api", () => ({
  messageTemplatesApi: { list: jest.fn() },
}));
jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn() } }));
jest.mock("@/components/app/my-templates/template-editor", () => ({
  TemplateEditor: function MockTemplateEditor() {
    const { useCreateMessageTemplate } = jest.requireActual("@/hooks/use-message-templates");
    const { mutate } = useCreateMessageTemplate();
    return <button onClick={() => mutate({ name: "새 템플릿", content: "본문", variables: [] })}>저장 테스트</button>;
  },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><NewTemplatePage /></QueryClientProvider>);
}

function getTemplateStat(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-slot="stat-mini"]')).at(-1) as HTMLElement;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHistoryLoading = false;
  mockTemplates = [{ id: "one" }, { id: "two" }, { id: "three" }];
  jest.mocked(messageTemplatesApi.list).mockImplementation(async () => ({ data: [...mockTemplates] }) as Awaited<ReturnType<typeof messageTemplatesApi.list>>);
  jest.mocked(api.post).mockImplementation(async () => {
    mockTemplates.push({ id: "four" });
    return { data: { id: "four" } };
  });
});

it("removes the back link and selects template creation immediately above settings in both navs", () => {
  const { container } = renderPage();
  expect(container.querySelector('a[href="/messages/templates"]')).not.toBeInTheDocument();
  for (const slot of ["section-nav-desktop", "section-nav-mobile"]) {
    const nav = container.querySelector(`[data-slot="${slot}"]`) as HTMLElement;
    const buttons = within(nav).getAllByRole("button");
    const create = within(nav).getByRole("button", { name: "템플릿 만들기" });
    expect(create).toHaveAttribute("aria-pressed", "true");
    expect(buttons[buttons.indexOf(create) + 1]).toHaveTextContent("설정");
    expect(within(nav).getByRole("button", { name: "전송하기" })).toHaveAttribute("aria-pressed", "false");
  }
  fireEvent.click(screen.getAllByRole("button", { name: "템플릿 만들기" })[0]);
  expect(mockPush).toHaveBeenCalledWith("/messages/templates/new");
  fireEvent.click(screen.getAllByRole("button", { name: "발송 기록" })[0]);
  expect(mockPush).toHaveBeenCalledWith("/messages?section=history");
});

it("shows the shared history counts and refreshes the branch template count after the editor mutation", async () => {
  const { container } = renderPage();
  const stat = getTemplateStat(container);
  await waitFor(() => expect(within(stat).getByText("지점 템플릿")).toBeInTheDocument());
  expect(stat.querySelector('[data-slot="stat-mini-value"]')).toHaveTextContent("3");
  expect(messageTemplatesApi.list).toHaveBeenCalledWith(1, 100);
  const values = Array.from(container.querySelectorAll('[data-slot="stat-mini-value"]')).map((node) => node.textContent);
  expect(values).toEqual(["12", "4", "5", "2", "1", "3"]);
  fireEvent.click(screen.getByRole("button", { name: "저장 테스트" }));
  await waitFor(() => expect(stat.querySelector('[data-slot="stat-mini-value"]')).toHaveTextContent("4"));
  expect(messageTemplatesApi.list).toHaveBeenCalledTimes(2);
});

it("uses the StatsBar skeleton while the template count loads", () => {
  jest.mocked(messageTemplatesApi.list).mockReturnValue(new Promise(() => {}));
  const { container } = renderPage();
  const stat = getTemplateStat(container);
  expect(within(stat).queryByText("지점 템플릿")).not.toBeInTheDocument();
  expect(stat.querySelector('[data-slot="stat-mini-value"]')).toBeEmptyDOMElement();
  expect(stat.querySelector('[data-slot="stat-mini-value"]')).toHaveClass("skeleton-base");
});

it("keeps a loaded template count visible while history is loading", async () => {
  mockHistoryLoading = true;
  const { container } = renderPage();
  await waitFor(() => expect(within(getTemplateStat(container)).getByText("지점 템플릿")).toBeInTheDocument());
  expect(getTemplateStat(container).querySelector('[data-slot="stat-mini-value"]')).toHaveTextContent("3");
});

it("shows an unknown count after a failed template load", async () => {
  jest.mocked(messageTemplatesApi.list).mockRejectedValue(new Error("unavailable"));
  const { container } = renderPage();
  await waitFor(() => expect(within(getTemplateStat(container)).getByText("지점 템플릿")).toBeInTheDocument());
  expect(getTemplateStat(container).querySelector('[data-slot="stat-mini-value"]')).toHaveTextContent("—");
});
