import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import NewMessagePage from "../page";
import { api } from "@/lib/api/client";

const mockUseSystemTemplate = jest.fn();
const mockUseMessageTemplates = jest.fn();
let mockSearchParams = new URLSearchParams();

const SYSTEM_TEMPLATE_KEYS = [
  "GREETING",
  "INFO",
  "PRICE_INFO",
  "REMINDER",
  "SERVICE_INFO",
  "SURVEY",
  "THANKS",
] as const;

type TemplateQuery = {
  branchId: string | null;
  data: {
    id: string;
    templateKey: string;
    name: string;
    content: string;
    requiredVariables: [];
    customVariables: [];
    updatedAt: string;
  } | undefined;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  isSuccess: boolean;
};

const templateQueries: Record<string, TemplateQuery> = {};

function readyTemplate(key: string, content: string, branchId = "branch-a"): TemplateQuery {
  return {
    branchId,
    data: {
      id: `${key}-${branchId}`,
      templateKey: key,
      name: `${key} 지점 템플릿`,
      content,
      requiredVariables: [],
      customVariables: [],
      updatedAt: "2026-09-13T00:00:00.000Z",
    },
    isError: false,
    isFetching: false,
    isLoading: false,
    isSuccess: true,
  };
}

function pendingTemplate(branchId = "branch-a"): TemplateQuery {
  return {
    branchId,
    data: undefined,
    isError: false,
    isFetching: true,
    isLoading: true,
    isSuccess: false,
  };
}

function failedTemplate(branchId = "branch-a"): TemplateQuery {
  return {
    branchId,
    data: undefined,
    isError: true,
    isFetching: false,
    isLoading: false,
    isSuccess: false,
  };
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => undefined,
  });
});

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/features/system-templates/hooks", () => ({
  useSystemTemplate: (key: string) => mockUseSystemTemplate(key),
}));

jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplates: () => mockUseMessageTemplates(),
}));

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks", () => ({
  useBankAccountInfos: () => ({ data: [], isLoading: false }),
  useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    post: jest.fn(),
  },
}));

jest.mock("@/app/(shell)/messages/MessagesPermissionGuard", () => ({
  useMessagesPermissionGuard: () => ({
    isLoading: false,
    needsSenderApproval: false,
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NewMessagePage />
    </QueryClientProvider>,
  );
}

async function addManualRecipient() {
  const receiverInput = screen.getByLabelText(/휴대 전화번호/);
  fireEvent.focus(receiverInput);
  fireEvent.change(receiverInput, { target: { value: "010-1234-5678" } });
  fireEvent.keyDown(receiverInput, { key: "Enter" });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /수신자 제거/ })).toBeInTheDocument();
  });
}

function submitForm() {
  const form = screen.getByLabelText("메시지 본문").closest("form");
  if (!form) throw new Error("message form not found");
  fireEvent.submit(form);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearchParams = new URLSearchParams();
  mockUseMessageTemplates.mockReturnValue({ data: [] });
  SYSTEM_TEMPLATE_KEYS.forEach((key) => {
    templateQueries[key] = readyTemplate(key, `${key} 기본 문구`);
  });
  mockUseSystemTemplate.mockImplementation((key: string) => templateQueries[key]);
  (api.post as jest.Mock).mockResolvedValue({
    data: { result: { resultCode: 1, errorCount: 0 } },
  });
});

describe("messages/new branch template readiness", () => {
  it("keeps sending disabled until the current branch template query resolves", async () => {
    templateQueries.GREETING = pendingTemplate();
    const view = renderPage();

    await addManualRecipient();

    expect(screen.getByRole("button", { name: "즉시 발송" })).toBeDisabled();
    submitForm();

    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByText("지점 기본 템플릿을 불러오는 중이라 발송할 수 없습니다.")).toBeInTheDocument();

    templateQueries.GREETING = readyTemplate("GREETING", "branch-a 맞춤 인사");
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NewMessagePage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("메시지 본문")).toHaveValue("branch-a 맞춤 인사");
      expect(screen.getByRole("button", { name: "즉시 발송" })).toBeEnabled();
    });
  });

  it("blocks the mutation after a branch template query fails", async () => {
    templateQueries.GREETING = failedTemplate();
    renderPage();

    await addManualRecipient();
    submitForm();

    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByText("지점 기본 템플릿을 불러오는 중이라 발송할 수 없습니다.")).toBeInTheDocument();
  });

  it("sends the loaded branch customization once readiness succeeds", async () => {
    templateQueries.GREETING = readyTemplate("GREETING", "branch-a 맞춤 인사");
    renderPage();

    await addManualRecipient();
    expect(screen.getByLabelText("메시지 본문")).toHaveValue("branch-a 맞춤 인사");
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.objectContaining({
          receiver: "010-1234-5678",
          message: "branch-a 맞춤 인사",
        }),
      );
    });
  });

  it("does not send stale branch content while the next branch template is fetching", async () => {
    templateQueries.GREETING = readyTemplate("GREETING", "branch-a 맞춤 인사");
    const view = renderPage();
    await addManualRecipient();
    expect(screen.getByLabelText("메시지 본문")).toHaveValue("branch-a 맞춤 인사");

    templateQueries.GREETING = {
      ...readyTemplate("GREETING", "branch-a 맞춤 인사", "branch-b"),
      isFetching: true,
      isLoading: true,
      isSuccess: false,
    };
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NewMessagePage />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: "즉시 발송" })).toBeDisabled();
    submitForm();
    expect(api.post).not.toHaveBeenCalled();

    templateQueries.GREETING = readyTemplate("GREETING", "branch-b 맞춤 인사", "branch-b");
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NewMessagePage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("메시지 본문")).toHaveValue("branch-b 맞춤 인사");
      expect(screen.getByRole("button", { name: "즉시 발송" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.objectContaining({ message: "branch-b 맞춤 인사" }),
      );
    });
  });

  it("keeps direct custom composing available while branch templates are unavailable", async () => {
    SYSTEM_TEMPLATE_KEYS.forEach((key) => {
      templateQueries[key] = pendingTemplate();
    });
    mockSearchParams = new URLSearchParams({ template: "__custom__", body: "직접 작성한 본문" });
    renderPage();

    await addManualRecipient();
    expect(screen.getByRole("button", { name: "즉시 발송" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.objectContaining({ message: "직접 작성한 본문" }),
      );
    });
  });
});
