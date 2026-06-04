import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import NewMessagePage from "../page";
import { api } from "@/lib/api/client";
import type { Client } from "@/lib/client/types";

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockUseAllClients = jest.fn();
const mockUseSystemTemplate = jest.fn();
const mockGetMessageSenderApproval = jest.fn();
let mockSearchParams = new URLSearchParams();

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

const mockClients: Client[] = [
  {
    id: 7,
    name: "박서연",
    createdAt: null,
    updatedAt: null,
    birthday: null,
    dueDate: null,
    address: "인천 연수구",
    phone: "01077778888",
    primaryEmployee: null,
    secondaryEmployee: null,
    type: null,
    duration: null,
    fullPrice: null,
    grant: null,
    actualPrice: null,
    startDate: null,
    endDate: null,
    careCenter: false,
    voucherClient: false,
    breastPump: false,
    serviceStatus: null,
    eDocId: null,
    hasSigned: false,
    documentStatus: null,
  },
];

jest.mock("next/navigation", () => ({
  useRouter: () => ({ back: mockBack, push: mockPush, replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplates: () => ({ data: [] }),
}));

jest.mock("@/features/system-templates/hooks", () => ({
  useSystemTemplate: (key: string) => mockUseSystemTemplate(key),
}));

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => mockUseAllClients(),
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    post: jest.fn(),
  },
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    getMessageSenderApproval: () => mockGetMessageSenderApproval(),
  },
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

async function addManualRecipient(value: string) {
  const receiverInput = screen.getByLabelText(/수신자/);

  fireEvent.focus(receiverInput);
  fireEvent.change(receiverInput, { target: { value } });
  fireEvent.keyDown(receiverInput, { key: "Enter" });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: /수신자 제거/ })).toBeInTheDocument();
  });
}

async function openTemplateSelect() {
  const trigger = screen.getByRole("combobox", { name: /템플릿 선택/ });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  await screen.findByRole("option", { name: "인사 메시지" });
}

describe("NewMessagePage", () => {
  beforeEach(() => {
    mockBack.mockClear();
    mockPush.mockClear();
    mockReplace.mockClear();
    mockGetMessageSenderApproval.mockReset();
    mockGetMessageSenderApproval.mockResolvedValue({
      senderPhone: "0324425992",
      senderPhoneFormatted: "032-442-5992",
      approvalStatus: "approved",
      isApproved: true,
      canRequest: true,
      requestedAt: "2026-06-04T00:00:00.000Z",
      approvedAt: "2026-06-04T00:00:00.000Z",
    });
    mockUseAllClients.mockReset();
    mockUseAllClients.mockReturnValue({ data: mockClients, isLoading: false });
    mockUseSystemTemplate.mockReset();
    mockUseSystemTemplate.mockImplementation((key: string) => {
      if (key === "service_info") {
        return {
          data: {
            id: "system-service-info",
            templateKey: "service_info",
            name: "서비스 안내",
            description: "서비스 안내 메시지",
            content: "{{name}} 산모님~♡\n서비스 시작일: {{serviceDate}}\n산후관리서비스 관련 안내사항을 보내드립니다 :)",
            requiredVariables: [
              {
                key: "name",
                label: "산모명",
                type: "string",
                required: true,
              },
              {
                key: "serviceDate",
                label: "서비스 시작일",
                type: "string",
                required: true,
              },
            ],
            customVariables: [],
            updatedAt: "2026-06-04T00:00:00.000Z",
          },
        };
      }

      return {
        data: {
          id: "system-greeting",
          templateKey: "GREETING",
          name: "인사 메시지",
          description: "고객 인사 메시지",
          content: "안녕하세요, 인천 아이미래로 입니다 :)",
          requiredVariables: [],
          customVariables: [],
          updatedAt: "2026-06-04T00:00:00.000Z",
        },
      };
    });
    (api.post as jest.Mock).mockReset();
    (api.post as jest.Mock).mockResolvedValue({ data: { result: { resultCode: 1, errorCount: 0 } } });
    mockSearchParams = new URLSearchParams();
  });

  it("refreshes route-provided message body when search params change in place", () => {
    mockSearchParams = new URLSearchParams({
      body: "첫 번째 템플릿 본문",
      template: "service-start-d-1",
    });

    const { rerender } = renderPage();
    expect(screen.getByLabelText("메시지 본문")).toHaveValue("첫 번째 템플릿 본문");

    mockSearchParams = new URLSearchParams({
      body: "두 번째 템플릿 본문",
      template: "visit-change",
    });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NewMessagePage />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("메시지 본문")).toHaveValue("두 번째 템플릿 본문");
  });

  it("falls back to /messages when there is no browser history to go back to", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "메시지 목록으로 돌아가기" }));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/messages");
  });

  it("uses browser history when a previous page exists", () => {
    window.history.pushState({}, "", "/messages");
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "메시지 목록으로 돌아가기" }));

    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("submits new messages through the SMS channel", async () => {
    renderPage();

    const bodyInput = screen.getByLabelText("메시지 본문");
    await addManualRecipient("010-1234-5678");
    fireEvent.change(bodyInput, { target: { value: "테스트 발송 본문" } });
    fireEvent.click(screen.getByRole("button", { name: "1명에게 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.objectContaining({
          channel: "sms",
          msgType: "AUTO",
          receiver: "010-1234-5678",
        }),
      );
    });
  });

  it("excludes decimal client ids from the delivery payload", async () => {
    mockSearchParams = new URLSearchParams({ clientId: "1.2" });

    renderPage();
    const bodyInput = screen.getByLabelText("메시지 본문");
    await addManualRecipient("010-9999-0000");
    fireEvent.change(bodyInput, { target: { value: "본문" } });
    fireEvent.click(screen.getByRole("button", { name: "1명에게 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.not.objectContaining({
          clientId: expect.anything(),
        }),
      );
    });
  });

  it("blocks submissions with more than 50 recipients", async () => {
    renderPage();

    const tooManyRecipients = Array.from({ length: 51 }, (_, index) => (
      `010-0000-${String(index + 1).padStart(4, "0")}`
    )).join(",");

    const receiverInput = screen.getByLabelText(/수신자/);
    fireEvent.focus(receiverInput);
    fireEvent.change(receiverInput, { target: { value: tooManyRecipients } });
    fireEvent.keyDown(receiverInput, { key: "Enter" });

    expect(await screen.findByText("수신자는 한 번에 최대 50명까지 선택할 수 있습니다.")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("adds an existing client recipient from autocomplete", async () => {
    renderPage();

    const receiverInput = screen.getByLabelText(/수신자/);
    const bodyInput = screen.getByLabelText("메시지 본문");

    fireEvent.focus(receiverInput);
    fireEvent.change(receiverInput, { target: { value: "박서연" } });
    fireEvent.click(await screen.findByText("박서연"));
    fireEvent.change(bodyInput, { target: { value: "고객 선택 발송" } });
    fireEvent.click(screen.getByRole("button", { name: "1명에게 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.objectContaining({
          receiver: "010-7777-8888",
          clientId: 7,
          recipientName: "박서연",
        }),
      );
    });
  });

  it("opens the recipient dropdown when the receiver input is clicked", () => {
    renderPage();

    fireEvent.click(screen.getByLabelText(/수신자/));

    expect(screen.getByTestId("clients-autocomplete-dropdown")).toBeInTheDocument();
    expect(screen.getByText("박서연")).toBeInTheDocument();
  });

  it("starts with the greeting template selected by default", () => {
    renderPage();

    expect(screen.getByRole("combobox", { name: /템플릿 선택/ })).toHaveTextContent("인사 메시지");
    expect(screen.getByLabelText("메시지 본문")).toHaveValue("안녕하세요, 인천 아이미래로 입니다 :)");
  });

  it("opens the message preview in a dialog from the body header", () => {
    renderPage();

    expect(screen.queryByText("SMS 미리보기")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "미리보기" }));

    const dialog = screen.getByRole("dialog", { name: "미리보기" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("SMS 미리보기")).toBeInTheDocument();
    expect(within(dialog).getByText("안녕하세요, 인천 아이미래로 입니다 :)")).toBeInTheDocument();
  });

  it("disables immediate send until a recipient is selected", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "즉시 발송" })).toBeDisabled();
  });

  it("does not show the draft save action", () => {
    renderPage();

    expect(screen.queryByRole("button", { name: "임시저장" })).not.toBeInTheDocument();
  });

  it("does not expose channel selection on the new message form", () => {
    renderPage();

    expect(screen.queryByText("채널")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "알림톡" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "SMS" })).not.toBeInTheDocument();
  });

  it("loads the greeting template from the template dropdown", async () => {
    renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "인사 메시지" }));

    expect(screen.getByLabelText("메시지 본문")).toHaveValue("안녕하세요, 인천 아이미래로 입니다 :)");
  });

  it("includes the service information template in the template dropdown", async () => {
    renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "서비스 안내" }));

    expect(screen.getByRole("combobox", { name: /템플릿 선택/ })).toHaveTextContent("서비스 안내");
    expect(screen.getByLabelText(/산모명/)).toBeInTheDocument();
    expect(screen.getByLabelText(/서비스 시작일/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/산모명/), { target: { value: "김지니" } });
    fireEvent.change(screen.getByLabelText(/서비스 시작일/), { target: { value: "2026. 06. 10." } });

    expect(screen.getByLabelText("메시지 본문")).toHaveValue(
      "김지니 산모님~♡\n서비스 시작일: 2026. 06. 10.\n산후관리서비스 관련 안내사항을 보내드립니다 :)",
    );
  });

  it("sends long template messages as auto type with an LMS title", async () => {
    mockUseSystemTemplate.mockImplementation((key: string) => {
      if (key === "service_info") {
        return { data: null };
      }

      return {
        data: {
          id: "system-greeting",
          templateKey: "GREETING",
          name: "인사 메시지",
          description: "고객 인사 메시지",
          content: "안녕하세요, 인천 아이미래로 입니다. 산모님과 아기의 건강한 회복을 위해 서비스 안내를 드립니다.",
          requiredVariables: [],
          customVariables: [],
          updatedAt: "2026-06-04T00:00:00.000Z",
        },
      };
    });

    renderPage();
    await addManualRecipient("010-1234-5678");
    fireEvent.click(screen.getByRole("button", { name: "1명에게 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.objectContaining({
          msgType: "AUTO",
          title: "인사 메시지",
        }),
      );
    });
  });
});
