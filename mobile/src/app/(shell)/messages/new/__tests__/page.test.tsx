import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createProblemDetails } from "@babyjamjam/shared";

import NewMessagePage from "../page";
import { api } from "@/lib/api/client";
import type { Client } from "@/lib/client/types";

const FORM_CARD_CONTENT =
  "mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content";

const mockPush = jest.fn();
const mockUseAllClients = jest.fn();
const mockUseSystemTemplate = jest.fn();
const mockGetMessageSenderApproval = jest.fn();
const mockUseBankAccountInfos = jest.fn();
const mockUseVoucherPriceInfos = jest.fn();
const mockUseMessagesPermissionGuard = jest.fn();
const mockClipboardWriteText = jest.fn();
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
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mockClipboardWriteText },
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
    birthDate: null,
    address: "인천 연수구",
    phone: "01077778888",
    primaryEmployee: null,
    secondaryEmployee: null,
    type: "A통합-2형",
    duration: 10,
    fullPrice: "2196000",
    grant: "1734000",
    actualPrice: "462000",
    startDate: "2026-06-10T00:00:00.000Z",
    endDate: null,
    careCenter: false,
    voucherClient: false,
    breastPump: false,
    serviceStatus: null,
    eDocId: null,
    areaId: "Seogu",
    hasSigned: false,
    documentStatus: null,
  },
];

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplates: () => ({ data: [] }),
}));

jest.mock("@/features/system-templates/hooks", () => ({
  useSystemTemplate: (key: string) => mockUseSystemTemplate(key),
  useSystemTemplates: () => ({
    data: ["GREETING", "INFO", "PRICE_INFO", "REMINDER", "SERVICE_INFO", "SURVEY", "THANKS"]
      .map((k) => mockUseSystemTemplate(k)?.data)
      .filter(Boolean),
    isLoading: false,
  }),
}));

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => mockUseAllClients(),
}));

jest.mock("@/hooks", () => ({
  useBankAccountInfos: () => mockUseBankAccountInfos(),
  useVoucherPriceInfos: (type: string, year?: number) => mockUseVoucherPriceInfos(type, year),
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    getMessageSenderApproval: () => mockGetMessageSenderApproval(),
  },
}));

jest.mock("@/app/(shell)/messages/MessagesPermissionGuard", () => ({
  useMessagesPermissionGuard: () => mockUseMessagesPermissionGuard(),
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
  const receiverInput = screen.getByLabelText(/휴대 전화번호/);

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

function validSmsResponse(receiver = "010-1234-5678") {
  return {
    data: {
      provider: "aligo_sms",
      triggerType: "immediate",
      request: {
        receiver,
        msgType: "SMS",
        testMode: false,
      },
      result: {
        resultCode: 1,
        message: "accepted",
        successCount: 1,
        errorCount: 0,
        msgType: "SMS",
      },
    },
  };
}

type SmsProblemCode =
  | "MESSAGE_SEND_NOT_STARTED"
  | "MESSAGE_SEND_UNCONFIRMED"
  | "MESSAGE_SEND_REJECTED"
  | "MESSAGE_SEND_PARTIAL";

function smsProblem(code: SmsProblemCode, outcome: "NOT_APPLIED" | "FAILED" | "PARTIALLY_APPLIED" | "UNKNOWN") {
  const problem = createProblemDetails({
    code,
    requestId: "sms-request-123",
    outcome,
  });
  return { response: { status: problem.status, data: problem } };
}

describe("NewMessagePage", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockGetMessageSenderApproval.mockReset();
    mockUseMessagesPermissionGuard.mockReset();
    mockUseMessagesPermissionGuard.mockReturnValue({
      isLoading: false,
      needsSenderApproval: false,
    });
    mockGetMessageSenderApproval.mockResolvedValue({
      approvalStatus: "approved",
      isApproved: true,
      canRequest: true,
      requestedAt: "2026-06-04T00:00:00.000Z",
      approvedAt: "2026-06-04T00:00:00.000Z",
    });
    mockUseAllClients.mockReset();
    mockUseAllClients.mockReturnValue({ data: mockClients, isLoading: false });
    mockUseBankAccountInfos.mockReset();
    mockUseBankAccountInfos.mockReturnValue({
      data: [
        { area: "Seogu", bankName: "농협은행", accNum: "351-1268-7728-43" },
        { area: "Namdonggu", bankName: "농협은행", accNum: "171777-52-129984" },
      ],
      isLoading: false,
    });
    mockUseVoucherPriceInfos.mockReset();
    mockUseVoucherPriceInfos.mockImplementation((type: string) => ({
      data: type
        ? [
          {
            id: 13,
            type,
            duration: "10",
            fullPrice: "2196000",
            grant: "1734000",
            actualPrice: "462000",
          },
          {
            id: 14,
            type,
            duration: "15",
            fullPrice: "2848000",
            grant: "2114000",
            actualPrice: "734000",
          },
        ]
        : [],
      isLoading: false,
    }));
    mockUseSystemTemplate.mockReset();
    mockUseSystemTemplate.mockImplementation((key: string) => {
      if (key === "GREETING" || key === "greeting") {
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
      }

      if (key === "SERVICE_INFO" || key === "service-info") {
        return {
          data: {
            id: "system-service-info",
            templateKey: "SERVICE_INFO",
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

      return { data: null };
    });
    (api.post as jest.Mock).mockReset();
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        provider: "aligo_sms",
        triggerType: "immediate",
        request: {
          receiver: "010-1234-5678",
          msgType: "SMS",
          testMode: false,
        },
        result: {
          resultCode: 1,
          message: "accepted",
          successCount: 1,
          errorCount: 0,
          msgType: "SMS",
        },
      },
    });
    mockClipboardWriteText.mockReset();
    mockClipboardWriteText.mockResolvedValue(undefined);
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

  it("shows the message section navigation without a back button", () => {
    const { container } = renderPage();
    const listCard = container.querySelector('[data-component="mobile_messages_new_page_screen_form_scroll_list-card"]');

    expect(screen.getByRole("button", { name: "전송하기" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(listCard).toContainElement(
      container.querySelector('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_header"]'),
    );
    expect(listCard).toContainElement(
      container.querySelector('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body"]'),
    );
    expect(screen.getByText("새 메시지")).toHaveClass("list-title-text");
    expect(container.querySelector('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_header"]')).toContainElement(
      screen.getByRole("button", { name: "즉시 발송" }),
    );
    expect(screen.queryByRole("button", { name: "메시지 목록으로 돌아가기" }))
      .not.toBeInTheDocument();
  });

  it("groups the recipient, template, variables, and body sections in one form card", () => {
    const { container } = renderPage();
    const formCards = container.querySelectorAll('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card"]');
    const formCard = formCards[0];

    expect(formCards).toHaveLength(1);
    expect(formCard?.firstElementChild).not.toHaveClass("p-6", "pt-0");
    expect(formCard).toContainElement(
      container.querySelector('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient"]'),
    );
    expect(formCard).toContainElement(
      container.querySelector('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_template"]'),
    );
    expect(formCard).toContainElement(
      container.querySelector('[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_message-body"]'),
    );
  });

  it("orders the send fields like the frontend form with template selection first", () => {
    const { container } = renderPage();
    const orderedSections = Array.from(
      container.querySelectorAll(
        '[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_template"], [data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient"], [data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_message-body"]',
      ),
    ).map((element) => element.getAttribute("data-component"));

    expect(orderedSections).toEqual([
      `${FORM_CARD_CONTENT}_template`,
      `${FORM_CARD_CONTENT}_recipient`,
      `${FORM_CARD_CONTENT}_message-body`,
    ]);
    expect(screen.getByLabelText(/휴대 전화번호/)).toHaveAttribute("placeholder", "010-0000-0000");
    expect(screen.queryByLabelText(/산모님 성함/)).not.toBeInTheDocument();
  });

  it("submits new messages through the SMS channel", async () => {
    renderPage();

    const bodyInput = screen.getByLabelText("메시지 본문");
    await addManualRecipient("010-1234-5678");
    fireEvent.change(bodyInput, { target: { value: "테스트 발송 본문" } });
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.objectContaining({
          msgType: "AUTO",
          receiver: "010-1234-5678",
        }),
      );
    });
  });

  it("uses one idempotency key for a synchronous double submit", async () => {
    let resolveRequest: ((value: ReturnType<typeof validSmsResponse>) => void) | undefined;
    (api.post as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    renderPage();
    await addManualRecipient("010-1234-5678");
    fireEvent.change(screen.getByLabelText("메시지 본문"), { target: { value: "중복 방지 테스트" } });

    const sendButton = screen.getByRole("button", { name: "즉시 발송" });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const submittedPayload = (api.post as jest.Mock).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(submittedPayload.idempotencyKey).toEqual(expect.any(String));

    resolveRequest?.(validSmsResponse());
    await waitFor(() => {
      expect(screen.getByText("메시지 발송 요청이 접수되었습니다.")).toBeInTheDocument();
    });
  });

  it.each([
    ["unknown", "MESSAGE_SEND_UNCONFIRMED", "UNKNOWN"],
    ["partial", "MESSAGE_SEND_PARTIAL", "PARTIALLY_APPLIED"],
  ] as const)("keeps the draft and blocks edits after a %s result", async (_label, code, outcome) => {
    (api.post as jest.Mock).mockRejectedValueOnce(smsProblem(code, outcome));

    const { container } = renderPage();
    await addManualRecipient("010-1234-5678");
    const bodyInput = screen.getByLabelText("메시지 본문");
    fireEvent.change(bodyInput, { target: { value: "확인 전까지 보존할 본문" } });
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    const expectedError = code === "MESSAGE_SEND_UNCONFIRMED"
      ? "문자 발송 결과를 확인할 수 없어 발송 기록을 먼저 확인해 주세요."
      : "일부 문자만 접수되어 전체 재발송 전에 발송 내역을 확인해 주세요.";
    expect(await screen.findByText(expectedError)).toBeInTheDocument();
    fireEvent.change(bodyInput, { target: { value: "수정한 본문" } });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(bodyInput).toHaveValue("수정한 본문");
    expect(screen.getByRole("link", { name: "발송 상태·내역 확인" })).toHaveAttribute(
      "href",
      "/messages/history",
    );
    expect(screen.getByText("sms-request-123")).toBeInTheDocument();
  });

  it("treats a malformed successful payload as unknown and preserves the draft", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({ data: {} });

    const { container } = renderPage();
    await addManualRecipient("010-1234-5678");
    const bodyInput = screen.getByLabelText("메시지 본문");
    fireEvent.change(bodyInput, { target: { value: "형식 확인 본문" } });
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => {
      expect(screen.getByText("변경 결과를 확인할 수 없으니 다시 실행하기 전에 작업 상태를 확인해 주세요.")).toBeInTheDocument();
    });
    expect(screen.queryByText("메시지 발송 요청이 접수되었습니다.")).not.toBeInTheDocument();
    fireEvent.change(bodyInput, { target: { value: "형식 확인 수정 본문" } });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(bodyInput).toHaveValue("형식 확인 수정 본문");
  });

  it("rotates the idempotency key after a not-started correction", async () => {
    (api.post as jest.Mock)
      .mockRejectedValueOnce(smsProblem("MESSAGE_SEND_NOT_STARTED", "NOT_APPLIED"))
      .mockResolvedValueOnce(validSmsResponse());

    renderPage();
    await addManualRecipient("010-1234-5678");
    const bodyInput = screen.getByLabelText("메시지 본문");
    fireEvent.change(bodyInput, { target: { value: "첫 시도" } });
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const firstKey = ((api.post as jest.Mock).mock.calls[0]?.[1] as Record<string, unknown>).idempotencyKey;
    expect(screen.getByRole("button", { name: "즉시 발송" })).toBeDisabled();

    fireEvent.change(bodyInput, { target: { value: "보정 후 새 시도" } });
    expect(screen.getByRole("button", { name: "즉시 발송" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => {
      expect(screen.getByText("메시지 발송 요청이 접수되었습니다.")).toBeInTheDocument();
    });
    const secondKey = ((api.post as jest.Mock).mock.calls[1]?.[1] as Record<string, unknown>).idempotencyKey;
    expect(secondKey).toEqual(expect.any(String));
    expect(secondKey).not.toBe(firstKey);
  });

  it("requires a correction before retrying a rejected request", async () => {
    (api.post as jest.Mock)
      .mockRejectedValueOnce(smsProblem("MESSAGE_SEND_REJECTED", "FAILED"))
      .mockResolvedValueOnce(validSmsResponse());

    renderPage();
    await addManualRecipient("010-1234-5678");
    const bodyInput = screen.getByLabelText("메시지 본문");
    fireEvent.change(bodyInput, { target: { value: "거부된 본문" } });
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "즉시 발송" })).toBeDisabled();
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(api.post).toHaveBeenCalledTimes(1);

    fireEvent.change(bodyInput, { target: { value: "수정 후 재시도" } });
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));
    await waitFor(() => expect(screen.getByText("메시지 발송 요청이 접수되었습니다.")).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("restores the selected template body with empty variables after sending", async () => {
    renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "서비스 안내" }));

    const receiverInput = screen.getByLabelText(/휴대 전화번호/);
    fireEvent.focus(receiverInput);
    fireEvent.change(receiverInput, { target: { value: "박서연" } });
    fireEvent.click(await screen.findByText("박서연"));
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => {
      expect(screen.getByLabelText("메시지 본문")).toHaveValue(
        "{{name}} 산모님~♡\n서비스 시작일: {{serviceDate}}\n산후관리서비스 관련 안내사항을 보내드립니다 :)",
      );
    });
  });

  it("excludes decimal client ids from the delivery payload", async () => {
    mockSearchParams = new URLSearchParams({ clientId: "1.2" });

    renderPage();
    const bodyInput = screen.getByLabelText("메시지 본문");
    await addManualRecipient("010-9999-0000");
    fireEvent.change(bodyInput, { target: { value: "본문" } });
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.not.objectContaining({
          clientId: expect.anything(),
        }),
      );
    });
  });

  it("prefills the customer recipient from a valid client id", async () => {
    mockSearchParams = new URLSearchParams({ clientId: "7" });

    renderPage();

    expect(await screen.findByRole("button", { name: "박서연 수신자 제거" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

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

  it("seeds the recipient chip and name variable once the deep-linked client resolves late", async () => {
    mockSearchParams = new URLSearchParams({ clientId: "7" });
    mockUseAllClients.mockReturnValue({ data: undefined, isLoading: true });

    const { rerender } = renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "서비스 안내" }));

    expect(screen.queryByRole("button", { name: "박서연 수신자 제거" })).not.toBeInTheDocument();
    expect(
      (screen.getByLabelText("메시지 본문") as HTMLTextAreaElement).value,
    ).not.toContain("박서연");

    mockUseAllClients.mockReturnValue({ data: mockClients, isLoading: false });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NewMessagePage />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: "박서연 수신자 제거" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText("메시지 본문")).toHaveValue(
        "박서연 산모님~♡\n서비스 시작일: {{serviceDate}}\n산후관리서비스 관련 안내사항을 보내드립니다 :)",
      );
    });
  });

  it("surfaces the missing-phone warning once a deep-linked client without a phone resolves late", async () => {
    mockSearchParams = new URLSearchParams({ clientId: "7" });
    mockUseAllClients.mockReturnValue({ data: undefined, isLoading: true });

    const { rerender } = renderPage();

    expect(screen.queryByText("선택한 고객에 등록된 연락처가 없어요.")).not.toBeInTheDocument();

    mockUseAllClients.mockReturnValue({
      data: [{ ...mockClients[0], phone: "" }],
      isLoading: false,
    });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NewMessagePage />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("선택한 고객에 등록된 연락처가 없어요.")).toBeInTheDocument();
  });

  it("does not re-add a deep-linked recipient the user removed when the client list refetches", async () => {
    mockSearchParams = new URLSearchParams({ clientId: "7" });
    mockUseAllClients.mockReturnValue({ data: mockClients, isLoading: false });

    const { rerender } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "박서연 수신자 제거" }));
    expect(screen.queryByRole("button", { name: "박서연 수신자 제거" })).not.toBeInTheDocument();

    mockUseAllClients.mockReturnValue({
      data: mockClients.map((client) => ({ ...client })),
      isLoading: false,
    });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NewMessagePage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "박서연 수신자 제거" })).not.toBeInTheDocument();
    });
  });

  it("blocks submissions with more than 50 recipients", async () => {
    renderPage();

    const tooManyRecipients = Array.from({ length: 51 }, (_, index) => (
      `010-0000-${String(index + 1).padStart(4, "0")}`
    )).join(",");

    const receiverInput = screen.getByLabelText(/휴대 전화번호/);
    fireEvent.focus(receiverInput);
    fireEvent.change(receiverInput, { target: { value: tooManyRecipients } });
    fireEvent.keyDown(receiverInput, { key: "Enter" });

    expect(await screen.findByText("수신자는 한 번에 최대 50명까지 선택할 수 있어요.")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("adds an existing client recipient from autocomplete", async () => {
    renderPage();

    const receiverInput = screen.getByLabelText(/휴대 전화번호/);
    const bodyInput = screen.getByLabelText("메시지 본문");

    fireEvent.focus(receiverInput);
    fireEvent.change(receiverInput, { target: { value: "박서연" } });
    fireEvent.click(await screen.findByText("박서연"));
    fireEvent.change(bodyInput, { target: { value: "고객 선택 발송" } });
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

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

    fireEvent.click(screen.getByLabelText(/휴대 전화번호/));

    expect(
      screen.getByTestId(
        "mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_row_autocomplete_dropdown",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("박서연")).toBeInTheDocument();
  });

  it("starts with the greeting template selected by default", () => {
    renderPage();

    expect(screen.getByRole("combobox", { name: /템플릿 선택/ })).toHaveTextContent("인사 메시지");
    expect(screen.getByLabelText("메시지 본문")).toHaveValue("안녕하세요, 인천 아이미래로 입니다 :)");
  });

  it("copies the current message body from the body header", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "복사" }));

    expect(mockClipboardWriteText).toHaveBeenCalledWith("안녕하세요, 인천 아이미래로 입니다 :)");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables immediate send until a recipient is selected", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "즉시 발송" })).toBeDisabled();
  });

  it("keeps the send page accessible but disables immediate send without approval", () => {
    mockUseMessagesPermissionGuard.mockReturnValue({
      isLoading: false,
      needsSenderApproval: true,
    });

    renderPage();

    expect(screen.getByText("새 메시지")).toBeInTheDocument();
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
    const { container } = renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "서비스 안내" }));

    expect(screen.getByRole("combobox", { name: /템플릿 선택/ })).toHaveTextContent("서비스 안내");
    expect(screen.getByLabelText(/산모님 성함/)).toBeInTheDocument();
    expect(screen.getByLabelText(/서비스 시작일/)).toBeInTheDocument();
    expect(
      Array.from(
        container.querySelectorAll(
          '[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_name-row"], [data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_row"]',
        ),
      ).map((element) => element.getAttribute("data-component")),
    ).toEqual([
      `${FORM_CARD_CONTENT}_recipient_name-row`,
      `${FORM_CARD_CONTENT}_recipient_row`,
    ]);

    fireEvent.change(screen.getByLabelText(/산모님 성함/), { target: { value: "김지니" } });
    fireEvent.change(screen.getByLabelText(/서비스 시작일/), { target: { value: "2026. 06. 10." } });

    expect(screen.getByLabelText("메시지 본문")).toHaveValue(
      "김지니 산모님~♡\n서비스 시작일: 2026. 06. 10.\n산후관리서비스 관련 안내사항을 보내드립니다 :)",
    );
  });

  it("uses the shared mobile input specification for message text fields", async () => {
    renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "서비스 안내" }));

    for (const input of [
      screen.getByLabelText(/휴대 전화번호/),
      screen.getByLabelText(/산모님 성함/),
      screen.getByLabelText(/서비스 시작일/),
    ]) {
      expect(input).toHaveAttribute("data-source-component", "Input");
      expect(input).toHaveClass(
        "h-[44px]",
        "rounded-[12px]",
        "border-[1.5px]",
        "px-[14px]",
        "py-0",
        "text-[0.9rem]",
      );
    }
  });

  it("includes the remaining frontend fallback templates in the template dropdown", async () => {
    renderPage();

    await openTemplateSelect();

    expect(screen.getByRole("option", { name: "정보 수집" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "금액 및 계좌번호" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "상담 후 리마인더" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "예약 완료" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "모니터링 설문" })).toBeInTheDocument();
  });

  it("loads a frontend fallback template that requires the client name variable", async () => {
    renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "예약 완료" }));

    expect(screen.getByRole("combobox", { name: /템플릿 선택/ })).toHaveTextContent("예약 완료");
    expect(screen.getByLabelText(/산모님 성함/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/산모님 성함/), { target: { value: "김지니" } });

    expect((screen.getByLabelText("메시지 본문") as HTMLTextAreaElement).value).toContain("김지니 산모님");
  });

  it("auto-fills price information variables from select controls", async () => {
    const { container } = renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "금액 및 계좌번호" }));

    expect(screen.getByRole("combobox", { name: "바우처 유형 *" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "서비스 기간 *" })).toBeDisabled();
    expect(screen.queryByLabelText("서비스 주수")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("총 서비스 금액")).not.toBeInTheDocument();
    expect(
      Array.from(
        container.querySelectorAll(
          '[data-component="mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_variables_price-info"] > [data-template-variable-key]',
        ),
      ).map((element) => element.getAttribute("data-template-variable-key")),
    ).toEqual(["type", "duration", "bankAccount", "voucherYear"]);

    fireEvent.change(screen.getByLabelText(/산모님 성함/), { target: { value: "김지니" } });

    fireEvent.keyDown(screen.getByRole("combobox", { name: "바우처 유형 *" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "A통합-2형" }));

    expect(screen.getByRole("combobox", { name: "서비스 기간 *" })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "서비스 기간 *" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "10일" }));

    fireEvent.keyDown(screen.getByRole("combobox", { name: "지역 *" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: /서구/ }));

    expect(screen.getByText("2,196,000")).toBeInTheDocument();
    expect(screen.getByText("462,000")).toBeInTheDocument();
    expect(screen.getByText("농협은행 351-1268-7728-43")).toBeInTheDocument();
    const bodyValue = (screen.getByLabelText("메시지 본문") as HTMLTextAreaElement).value;
    expect(bodyValue).toContain("출퇴근 2주");
    expect(bodyValue).toContain("평일기준 10일");
    expect(bodyValue).toContain("2,196,000원");
    expect(bodyValue).toContain("농협은행 351-1268-7728-43");
  });

  it("prefills price information variables and account from a selected client recipient", async () => {
    renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "금액 및 계좌번호" }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "바우처 유형 *" })).toBeInTheDocument();
    });

    const recipientNameInput = screen.getByLabelText(/산모님 성함/);
    const receiverInput = screen.getByLabelText(/휴대 전화번호/);

    expect(recipientNameInput).toHaveAttribute(
      "data-component",
      "mobile_messages_new_page_screen_form_scroll_list-card_body_form-card_content_recipient_name-row_autocomplete_input",
    );
    expect(receiverInput).toHaveAttribute("data-component", `${FORM_CARD_CONTENT}_recipient_row_input`);

    fireEvent.focus(recipientNameInput);
    fireEvent.change(recipientNameInput, { target: { value: "박서연" } });
    fireEvent.click(await screen.findByText("박서연"));
    fireEvent.blur(recipientNameInput);

    expect(recipientNameInput).toHaveValue("");
    expect(screen.queryByRole("button", { name: "선택 해제" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "박서연 수신자 제거" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "바우처 유형 *" })).toHaveTextContent("A통합-2형");
      expect((screen.getByLabelText("메시지 본문") as HTMLTextAreaElement).value).toContain("2,196,000원");
    });

    expect(screen.getByRole("combobox", { name: "지역 *" })).toHaveTextContent("서구");

    const bodyValue = (screen.getByLabelText("메시지 본문") as HTMLTextAreaElement).value;
    expect(bodyValue).toContain("박서연 산모님");
    expect(bodyValue).toContain("출퇴근 2주");
    expect(bodyValue).toContain("평일기준 10일");
    expect(bodyValue).toContain("A통합2형");
    expect(bodyValue).toContain("2,196,000원");
    expect(bodyValue).toContain("462,000원");
    expect(bodyValue).toContain("농협은행 351-1268-7728-43");

    fireEvent.click(screen.getByRole("button", { name: "박서연 수신자 제거" }));

    await waitFor(() => {
      expect(recipientNameInput).toHaveValue("");
      expect(screen.queryByRole("button", { name: "박서연 수신자 제거" })).not.toBeInTheDocument();
    });
  });

  it("prefills service information variables from a selected client recipient", async () => {
    renderPage();

    await openTemplateSelect();
    fireEvent.click(screen.getByRole("option", { name: "서비스 안내" }));

    const receiverInput = screen.getByLabelText(/휴대 전화번호/);
    fireEvent.focus(receiverInput);
    fireEvent.change(receiverInput, { target: { value: "박서연" } });
    fireEvent.click(await screen.findByText("박서연"));

    expect(screen.getByLabelText(/산모님 성함/)).toHaveValue("박서연");
    expect(screen.getByLabelText(/서비스 시작일/)).toHaveValue("2026. 06. 10.");
    expect(screen.getByLabelText("메시지 본문")).toHaveValue(
      "박서연 산모님~♡\n서비스 시작일: 2026. 06. 10.\n산후관리서비스 관련 안내사항을 보내드립니다 :)",
    );
  });

  it("sends long template messages as auto type with an LMS title", async () => {
    mockUseSystemTemplate.mockImplementation((key: string) => {
      if (key === "SERVICE_INFO") {
        return { data: null };
      }

      if (key === "GREETING") {
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
      }

      return { data: null };
    });

    renderPage();
    await addManualRecipient("010-1234-5678");
    fireEvent.click(screen.getByRole("button", { name: "즉시 발송" }));

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
