import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { eformsignApi } from "@/services/api";
import { useFormStore } from "@/stores/form-store";
import type { ReceiptLinkPreparation } from "../form-components/TemplateMessageFormLayout";

import { ServiceRecordLinkMessageForm } from "../ServiceRecordLinkMessageForm";

jest.mock("@/features/system-templates/hooks", () => ({
  useSystemTemplate: jest.fn(),
}));

jest.mock("@/features/service-records/api/service-records.api", () => ({
  serviceRecordsApi: {
    getClientOverview: jest.fn(),
    prepareLink: jest.fn(),
  },
}));

jest.mock("@/services/api", () => ({
  eformsignApi: {
    prepareReceiptLink: jest.fn(),
  },
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/components/app/clients/EmployeeAutocomplete", () => ({
  EmployeeAutocomplete: ({
    label,
    onChange,
    onManualInputChange,
    placeholder,
    allowManualInput,
    manualValue,
  }: {
    label: string;
    onChange: (employeeId: number, employee: {
      id: number;
      name: string;
      phone: string;
      workArea: string[];
      grade: string;
      openToNextWork: boolean;
      registeredDate: string;
      status: "available";
    }) => void;
    onManualInputChange?: (value: string) => void;
    placeholder?: string;
    allowManualInput?: boolean;
    manualValue?: string;
  }) => (
    <div>
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-controls="employee-options"
        aria-expanded="false"
        data-allow-manual-input={allowManualInput ? "true" : "false"}
        onClick={() => onChange(30, {
          id: 30,
          name: "홍제공",
          phone: "01011112222",
          workArea: ["인천"],
          grade: "A",
          openToNextWork: true,
          registeredDate: "2026-01-01",
          status: "available",
        })}
      >
        {manualValue || placeholder || "관리사 선택"}
      </button>
      <button type="button" onClick={() => onManualInputChange?.("수동관리사")}>
        관리사 이름 수동 입력
      </button>
    </div>
  ),
}));

jest.mock("@/components/app/clients/ClientAutocomplete", () => ({
  ClientAutocomplete: ({
    label,
    onChange,
    onManualValueChange,
    placeholder,
    manualValue,
  }: {
    label: string;
    onChange: (clientId: number, client: { id: number; name: string; phone: string }) => void;
    onManualValueChange?: (value: string) => void;
    placeholder?: string;
    manualValue?: string;
  }) => (
    <div>
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-controls="client-options"
        aria-expanded="false"
        onClick={() => onChange(20, { id: 20, name: "김산모", phone: "010-1234-5678" })}
      >
        {manualValue || placeholder || "산모 선택"}
      </button>
      <button type="button" onClick={() => onManualValueChange?.("수동산모")}>
        산모 이름 수동 입력
      </button>
    </div>
  ),
}));

jest.mock("../../templates/AutoFillMsgCard", () => ({
  AutoFillMsgCard: ({
    message,
    variableItems,
  }: {
    message: string;
    variableItems: Array<{ token: string }>;
  }) => (
    <div>
      <output data-testid="generated-message">{message}</output>
      {variableItems.map(({ token }) => (
        <span key={token}>{token}</span>
      ))}
    </div>
  ),
}));

jest.mock("../form-components/TemplateMessageFormLayout", () => ({
  TemplateMessageFormFrame: ({
    fields,
    messageCard,
    deliveryMode,
    renderLayout,
    serviceRecordLinkPreparation,
    receiptLinkPreparation,
  }: {
    fields: React.ReactNode;
    messageCard: React.ReactNode;
    deliveryMode?: string;
    renderLayout?: (args: Record<string, unknown>) => React.ReactNode;
    serviceRecordLinkPreparation?: Record<string, unknown> | null;
    receiptLinkPreparation?: Record<string, unknown> | null;
  }) => renderLayout ? renderLayout({
    fields,
    messageCard,
    requiresRecipientName: false,
    deliveryMode,
    serviceRecordLinkPreparation,
    receiptLinkPreparation,
  }) : (
      <div data-delivery-mode={deliveryMode}>
        {fields}
        {messageCard}
      </div>
    ),
}));

const serviceRecordLinkTemplate = `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

{{employeeName}} 관리사님, {{clientName}} 산모님의 서비스 제공기록지 작성 링크입니다.
서비스 시작일은 {{serviceStartDate}}입니다.
매일 서비스 제공 완료 직전에 서비스 세부사항 기록 후에, 산모님께 승인을 받으시면 됩니다.

최초 접속 시에 관리사님의 전화번호 인증이 필요합니다. 링크 접속 후 휴대폰 번호로 본인확인하고, 방문일마다 기록을 남겨주세요.

감사합니다.

제공기록지 링크
{{serviceRecordUrl}}`;

describe("ServiceRecordLinkMessageForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useFormStore.getState().resetAll();
    jest.mocked(serviceRecordsApi.getClientOverview).mockResolvedValue({
      data: {
        assignments: [{
          scheduleId: 11,
          startDate: "2026-07-03T00:00:00.000Z",
          replaced: false,
          employee: {
            id: 30,
            name: "홍제공",
            phone: "010-1111-2222",
          },
        }],
      },
    } as never);
    jest.mocked(serviceRecordsApi.prepareLink).mockResolvedValue({
      data: {
        serviceRecordUrl: "https://mobile.test/service-record/efl_prepared",
        preparedLinkToken: "efl_prepared",
        expiresAt: "2026-07-20T00:00:00.000Z",
      },
    } as never);
    jest.mocked(eformsignApi.prepareReceiptLink).mockResolvedValue({
      clientId: 20,
      clientName: "김산모",
      recipientPhone: "01012345678",
      documentId: "doc-receipt-1",
      receiptUrl: "https://mobile.test/receipt/efr_prepared",
      expiresAt: "2026-07-20T00:00:00.000Z",
    });
    jest.mocked(useSystemTemplate).mockReturnValue({
      data: {
        content: serviceRecordLinkTemplate,
        description: "제공기록지 작성 링크",
      },
    } as ReturnType<typeof useSystemTemplate>);
  });

  it("uses name autocompletes and auto-fills the selected employee phone", async () => {
    const onPreviewMessageChange = jest.fn();

    render(
      <ServiceRecordLinkMessageForm
        onPreviewMessageChange={onPreviewMessageChange}
      />,
    );

    const employeeNameInput = screen.getByRole("combobox", {
      name: "관리사님 성함",
    });
    const employeePhoneInput = screen.getByRole("textbox", {
      name: /관리사님 전화번호/,
    });
    const clientNameInput = screen.getByRole("combobox", {
      name: "산모님 성함",
    });

    expect(
      employeeNameInput.compareDocumentPosition(employeePhoneInput)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      employeePhoneInput.compareDocumentPosition(clientNameInput)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(employeeNameInput).toHaveTextContent("새로 입력 또는 기존 직원 선택");
    expect(employeeNameInput).toHaveAttribute("data-allow-manual-input", "true");
    expect(clientNameInput).toHaveTextContent("새로 입력 또는 기존 고객 선택");
    expect(
      screen.queryByRole("textbox", { name: /제공기록지 링크/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(employeeNameInput);
    await waitFor(() => {
      expect(employeePhoneInput).toHaveValue("010-1111-2222");
    });
    fireEvent.click(clientNameInput);

    await waitFor(() => {
      expect(screen.getByTestId("generated-message")).toHaveTextContent(
        "홍제공 관리사님, 김산모 산모님의 서비스 제공기록지 작성 링크입니다.",
      );
      expect(screen.getByTestId("generated-message")).toHaveTextContent(
        "https://mobile.test/service-record/efl_prepared",
      );
      expect(screen.getByTestId("generated-message")).toHaveTextContent(
        "서비스 시작일은 2026-07-03입니다.",
      );
      expect(screen.getByTestId("generated-message")).not.toHaveTextContent(
        "{{serviceStartDate}}",
      );
      expect(screen.getByTestId("generated-message")).not.toHaveTextContent(
        "{{serviceRecordUrl}}",
      );
      expect(onPreviewMessageChange).toHaveBeenLastCalledWith(
        expect.stringContaining("https://mobile.test/service-record/efl_prepared"),
      );
    });

    expect(serviceRecordsApi.getClientOverview).toHaveBeenCalledWith(20);
    expect(serviceRecordsApi.prepareLink).toHaveBeenCalledWith(11, {
      recipientPhone: "01011112222",
    });

    expect(document.querySelector('[data-delivery-mode="service-feedback-link"]')).toBeInTheDocument();
    expect(screen.getByText("{{employeeName}}")).toBeInTheDocument();
    expect(screen.getByText("{{clientName}}")).toBeInTheDocument();
    expect(screen.getByText("{{serviceStartDate}}")).toBeInTheDocument();
    expect(screen.getByText("{{serviceRecordUrl}}")).toBeInTheDocument();
  });

  it("keeps a manually overridden phone and prepares the link for that exact number", async () => {
    jest.mocked(serviceRecordsApi.getClientOverview).mockResolvedValue({
      data: {
        assignments: [{
          scheduleId: 11,
          startDate: "2026-07-03T00:00:00.000Z",
          replaced: false,
          employee: {
            id: 30,
            name: "홍제공",
            phone: "010-9999-8888",
          },
        }],
      },
    } as never);

    render(<ServiceRecordLinkMessageForm />);

    fireEvent.click(screen.getByRole("combobox", { name: "관리사님 성함" }));
    fireEvent.click(screen.getByRole("combobox", { name: "산모님 성함" }));

    const employeePhoneInput = screen.getByRole("textbox", { name: /관리사님 전화번호/ });
    await waitFor(() => {
      expect(serviceRecordsApi.prepareLink).toHaveBeenCalledWith(11, {
        recipientPhone: "01011112222",
      });
    });

    expect(employeePhoneInput).not.toBeDisabled();
    fireEvent.change(employeePhoneInput, {
      target: { value: "01066211878" },
    });

    await waitFor(() => {
      expect(employeePhoneInput).toHaveValue("010-6621-1878");
      expect(serviceRecordsApi.prepareLink).toHaveBeenLastCalledWith(11, {
        recipientPhone: "01066211878",
      });
    });
    expect(useFormStore.getState().employeePhone).toBe("010-6621-1878");
  });

  it("keeps manually entered employee and client names with a formatted phone", async () => {
    render(<ServiceRecordLinkMessageForm />);

    fireEvent.click(screen.getByRole("button", { name: "관리사 이름 수동 입력" }));
    fireEvent.change(screen.getByRole("textbox", { name: /관리사님 전화번호/ }), {
      target: { value: "01033334444" },
    });
    fireEvent.click(screen.getByRole("button", { name: "산모 이름 수동 입력" }));

    await waitFor(() => {
      expect(screen.getByTestId("generated-message")).toHaveTextContent(
        "수동관리사 관리사님, 수동산모 산모님의 서비스 제공기록지 작성 링크입니다.",
      );
    });

    expect(screen.getByRole("textbox", { name: /관리사님 전화번호/ })).toHaveValue("010-3333-4444");
    expect(useFormStore.getState()).toMatchObject({
      employeeId: null,
      employeeName: "수동관리사",
      employeePhone: "010-3333-4444",
      clientId: null,
      name: "수동산모",
    });
    expect(serviceRecordsApi.prepareLink).not.toHaveBeenCalled();
    expect(screen.getByTestId("generated-message")).toHaveTextContent("{{serviceRecordUrl}}");
  });

  it("passes the in-memory prepared link through the render layout for the submit form", async () => {
    render(
      <ServiceRecordLinkMessageForm
        renderLayout={({ fields, messageCard, serviceRecordLinkPreparation }) => (
          <div>
            {fields}
            {messageCard}
            <output data-testid="prepared-link-state">
              {serviceRecordLinkPreparation
                ? `${serviceRecordLinkPreparation.preparedLinkToken}|${serviceRecordLinkPreparation.serviceStartDate}`
                : ""}
            </output>
          </div>
        )}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "관리사님 성함" }));
    fireEvent.click(screen.getByRole("combobox", { name: "산모님 성함" }));

    await waitFor(() => {
      expect(screen.getByTestId("prepared-link-state")).toHaveTextContent(
        "efl_prepared|2026-07-03",
      );
    });
  });

  it("uses only the mother autocomplete in receipt mode and previews the prepared authoritative values", async () => {
    jest.mocked(useSystemTemplate).mockReturnValue({
      data: {
        content: "{{name}}|{{clientName}}|{{phone}}|{{receiptUrl}}",
        description: "서비스 종료 안내",
      },
    } as ReturnType<typeof useSystemTemplate>);

    render(<ServiceRecordLinkMessageForm mode="receipt-link" />);

    expect(screen.queryByRole("combobox", { name: "관리사님 성함" })).not.toBeInTheDocument();
    const clientNameInput = screen.getByRole("combobox", { name: "산모님 성함" });
    fireEvent.click(clientNameInput);

    const phoneInput = await screen.findByRole("textbox", { name: /산모님 전화번호/ });
    await waitFor(() => {
      expect(eformsignApi.prepareReceiptLink).toHaveBeenCalledWith(20);
      expect(phoneInput).toHaveValue("010-1234-5678");
      expect(phoneInput).toBeDisabled();
      expect(screen.getByTestId("generated-message")).toHaveTextContent(
        "김산모|김산모|01012345678|https://mobile.test/receipt/efr_prepared",
      );
    });

    expect(document.querySelector('[data-delivery-mode="receipt-link"]')).toBeInTheDocument();
    expect(screen.getByText("{{receiptUrl}}")).toBeInTheDocument();
  });

  it("shows the receipt preparation failure even when the message side panel is hidden", async () => {
    jest.mocked(useSystemTemplate).mockReturnValue({
      data: { content: "{{name}} {{receiptUrl}}", description: "서비스 종료 안내" },
    } as ReturnType<typeof useSystemTemplate>);
    jest.mocked(eformsignApi.prepareReceiptLink).mockRejectedValueOnce({
      response: { data: { reason: "pdf_unavailable" } },
    });
    render(<ServiceRecordLinkMessageForm mode="receipt-link" showMessageSide={false} />);
    fireEvent.click(screen.getByRole("combobox", { name: "산모님 성함" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "계약서 PDF를 아직 불러올 수 없어요. 잠시 후 다시 시도해 주세요.",
    );
    fireEvent.click(screen.getByRole("button", { name: "링크 다시 준비" }));
    await waitFor(() => {
      expect(eformsignApi.prepareReceiptLink).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByTestId("generated-message")).toHaveTextContent("receipt/efr_prepared");
    });
  });

  it("ignores an out-of-order receipt preparation response after changing the selected mother", async () => {
    jest.mocked(useSystemTemplate).mockReturnValue({
      data: {
        content: "{{name}}|{{clientName}}|{{phone}}|{{receiptUrl}}",
        description: "서비스 종료 안내",
      },
    } as ReturnType<typeof useSystemTemplate>);

    let resolveA: ((value: ReceiptLinkPreparation) => void) | undefined;
    let resolveB: ((value: ReceiptLinkPreparation) => void) | undefined;
    const preparationA = new Promise<ReceiptLinkPreparation>((resolve) => {
      resolveA = resolve;
    });
    const preparationB = new Promise<ReceiptLinkPreparation>((resolve) => {
      resolveB = resolve;
    });
    jest.mocked(eformsignApi.prepareReceiptLink).mockImplementation((clientId) => (
      clientId === 20 ? preparationA : preparationB
    ));

    render(
      <ServiceRecordLinkMessageForm
        mode="receipt-link"
      />,
    );

    await act(async () => {
      useFormStore.setState({ clientId: 20, name: "A 산모", phone: "010-1111-1111" });
    });
    await waitFor(() => expect(eformsignApi.prepareReceiptLink).toHaveBeenCalledWith(20));

    await act(async () => {
      useFormStore.setState({ clientId: 21, name: "B 산모", phone: "010-2222-2222" });
    });
    await waitFor(() => expect(eformsignApi.prepareReceiptLink).toHaveBeenCalledWith(21));

    await act(async () => {
      resolveA?.({
        clientId: 20,
        clientName: "A 산모",
        recipientPhone: "01011111111",
        documentId: "doc-a",
        receiptUrl: "https://mobile.test/receipt/old",
        expiresAt: "2026-07-20T00:00:00.000Z",
      });
    });
    expect(screen.getByTestId("generated-message")).not.toHaveTextContent("receipt/old");

    await act(async () => {
      resolveB?.({
        clientId: 21,
        clientName: "B 산모",
        recipientPhone: "01022222222",
        documentId: "doc-b",
        receiptUrl: "https://mobile.test/receipt/current",
        expiresAt: "2026-07-20T00:00:00.000Z",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("generated-message")).toHaveTextContent(
        "B 산모|B 산모|01022222222|https://mobile.test/receipt/current",
      );
    });
  });
});
