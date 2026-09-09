import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createProblemDetails } from "@babyjamjam/shared/errors/problem-details";

import type { Client } from "@/lib/client/types";
import { api } from "@/lib/api/client";
import { useClientWizardStore } from "@/stores/client-wizard-store";

import NewClientPage from "./page";

const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();
const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();
let mockEditingClient: Client | undefined;
let mockEditingContractDocument: object | undefined;
let mockLatePrefill: Record<string, unknown> = {};
const mockOutOfPocketPrices = [{ id: 1, duration: 15, fullPrice: "1" }];
const mockEmptyPrices: never[] = [];

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mockEditingContractDocument }),
}));

jest.mock("@/hooks/useClients", () => ({
  useClient: () => ({ data: mockEditingClient }),
  useCreateClient: () => ({ isPending: false, mutateAsync: mockCreateClient }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: mockUpdateClient }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [], isLoading: false, refetch: jest.fn() }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  useAllVoucherPrices: () => ({ data: mockEmptyPrices, isLoading: false, isFetching: false }),
  useOutOfPocketPriceInfos: () => ({
    data: mockOutOfPocketPrices,
    isLoading: false,
    isError: false,
  }),
  useVoucherPriceInfos: () => ({ data: mockEmptyPrices, isLoading: false }),
  useVoucherYears: () => ({ data: mockEmptyPrices }),
}));

jest.mock("@/components/app/clients/EmployeeAutocomplete", () => ({
  EmployeeAutocomplete: () => null,
}));

jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
  EmployeeFormDialog: () => null,
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/lib/i18n/translations", () => ({
  t: (_locale: string, key: string) => {
    const labels: Record<string, string> = {
      "clients.form.name": "이름",
      "clients.form.phone": "연락처",
      "clients.form.birthday": "생년월일",
      "clients.form.due-date": "출산 예정일",
      "clients.form.address": "주소",
      "clients.form.primary-employee": "주 담당 인력",
      "clients.form.secondary-employee": "보조 담당 인력",
      "clients.form.voucher-type": "바우처 유형",
      "clients.form.duration": "서비스 기간",
      "clients.form.full-price": "총 서비스 금액",
      "clients.form.grant": "정부지원금",
      "clients.form.actual-price": "본인부담금",
      "clients.form.start-date": "시작일",
      "clients.form.end-date": "종료일",
      "clients.form.care-center": "산후조리원",
      "clients.form.voucher-client": "바우처 고객",
      "clients.form.breast-pump": "유축기 대여",
      "clients.form.contract-status": "계약 상태",
    };
    return labels[key] ?? key;
  },
}));

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
}));

jest.mock("@/hooks/use-navigation-pending", () => ({
  useNavigationPending: () => ({ isNavigationPending: false, startNavigation: jest.fn() }),
}));

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn() },
}));

jest.mock("@/services/api", () => ({
  eformsignApi: { getDocument: jest.fn() },
}));

jest.mock("@/lib/eformsign/client-prefill", () => ({
  buildClientEditPrefillFromEformsignDocument: () => mockLatePrefill,
}));

const initialForm = {
  name: "등록 고객",
  birthday: "900101",
  dueDate: "2026-08-01",
  birthDate: "",
  address: "인천시",
  phone: "010-1234-5678",
  primaryEmployeeId: null,
  secondaryEmployeeId: null,
  type: "",
  duration: 15,
  fullPrice: "1",
  grant: "0",
  actualPrice: "1",
  startDate: "2026-09-03",
  endDate: "2026-09-23",
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "pre_booking" as const,
  areaId: "",
  currentStep: 2,
  pricesManuallyEdited: false,
  voucherYear: null,
};

function seedForm() {
  act(() => {
    useClientWizardStore.setState(initialForm);
  });
}

function renderCreate() {
  mockSearchParams = new URLSearchParams();
  mockEditingClient = undefined;
  render(<NewClientPage />);
  seedForm();
}

function editClient(): Client {
  return {
    id: 7,
    name: initialForm.name,
    birthday: initialForm.birthday,
    dueDate: initialForm.dueDate,
    birthDate: null,
    address: initialForm.address,
    phone: initialForm.phone,
    primaryEmployee: null,
    secondaryEmployee: null,
    type: null,
    duration: initialForm.duration,
    fullPrice: initialForm.fullPrice,
    grant: initialForm.grant,
    actualPrice: initialForm.actualPrice,
    startDate: initialForm.startDate,
    endDate: initialForm.endDate,
    careCenter: false,
    voucherClient: false,
    breastPump: false,
    serviceStatus: "pre_booking",
    eDocId: null,
    areaId: null,
    hasSigned: false,
    documentStatus: null,
  };
}

function renderEdit() {
  mockSearchParams = new URLSearchParams("clientId=7");
  mockEditingClient = editClient();
  return render(<NewClientPage />);
}

function clickSubmit() {
  fireEvent.click(screen.getByRole("button", { name: /^(등록|저장)$/ }));
}

function getPhoneInput() {
  return screen.getByRole("textbox", { name: /^연락처/ });
}

function validationProblem() {
  return createProblemDetails({
    code: "VALIDATION_FAILED",
    requestId: "request-bjj-319-wizard-fields",
    outcome: "NOT_APPLIED",
    errors: [
      { pointer: "/name", code: "REQUIRED", detail: "raw name value", location: "body" },
      { pointer: "/phone", code: "INVALID_FORMAT", detail: "raw phone value", location: "body" },
      { pointer: "/internalTenantId", code: "OUT_OF_RANGE", detail: "raw internal value", location: "body" },
    ],
  });
}

describe("mobile client wizard mutation error presentation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockEditingClient = undefined;
    mockEditingContractDocument = undefined;
    mockLatePrefill = {};
    useClientWizardStore.getState().reset();
    (api.get as jest.Mock).mockResolvedValue({ data: { exists: false } });
    mockCreateClient.mockReset().mockResolvedValue({ id: 1 });
    mockUpdateClient.mockReset().mockResolvedValue({ id: 7 });
  });

  it("keeps two structured field errors, preserves input, and focuses a linked field", async () => {
    mockCreateClient.mockRejectedValueOnce({
      response: { status: 400, data: validationProblem() },
    });
    renderCreate();

    clickSubmit();
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(alert).toHaveTextContent("입력 내용을 확인해 주세요.");
    expect(alert).toHaveTextContent("이름: 필수 항목이에요.");
    expect(alert).toHaveTextContent("연락처: 입력 형식이 올바르지 않아요.");
    expect(alert).toHaveTextContent("입력 항목: 허용 범위를 벗어난 값이에요.");
    expect(alert).toHaveTextContent("요청 ID: request-bjj-319-wizard-fields");
    expect(alert).not.toHaveTextContent("raw name value");
    expect(alert).not.toHaveTextContent("internalTenantId");

    expect(screen.getByRole("link", { name: "이름: 필수 항목이에요." })).toHaveAttribute("href", "#name");
    expect(screen.getByRole("link", { name: "연락처: 입력 형식이 올바르지 않아요." })).toHaveAttribute("href", "#phone");

    fireEvent.click(screen.getByRole("link", { name: "이름: 필수 항목이에요." }));
    const nameInput = await screen.findByRole("textbox", { name: /^이름/ });
    expect(nameInput).toHaveValue(initialForm.name);
    expect(nameInput).toHaveFocus();
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput).toHaveAttribute("aria-describedby", "mobile_clients-new_screen_root_error-summary_item-0");
    expect(getPhoneInput()).toHaveAttribute("aria-invalid", "true");
    expect(getPhoneInput()).toHaveValue(initialForm.phone);
  });

  it.each([
    {
      label: "UNKNOWN problem",
      cause: () => ({ response: { status: 500, data: createProblemDetails({ code: "INTERNAL_ERROR", requestId: "request-bjj-319-unknown", outcome: "UNKNOWN" }) } }),
    },
    {
      label: "malformed response",
      cause: () => ({ response: { status: 502, data: "<html>gateway failure</html>" } }),
    },
    {
      label: "no response",
      cause: () => new Error("local callback failed after sending"),
    },
  ])("blocks repeated %s mutation after input and step changes", async ({ cause }) => {
    mockCreateClient.mockRejectedValueOnce(cause());
    renderCreate();

    clickSubmit();
    await screen.findByRole("alert");
    const registerButton = screen.getByRole("button", { name: "등록" });
    await waitFor(() => expect(registerButton).toBeDisabled());
    expect(screen.getByText("다시 실행하기 전에 작업 상태를 확인해 주세요.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    const nameInput = await screen.findByRole("textbox", { name: /^이름/ });
    fireEvent.change(nameInput, { target: { value: "수정한 이름" } });
    expect(nameInput).toHaveValue("수정한 이름");
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  it("keeps an UNKNOWN edit blocked through a same-customer refetch and dirty draft", async () => {
    mockUpdateClient.mockRejectedValueOnce({
      response: {
        status: 500,
        data: createProblemDetails({ code: "INTERNAL_ERROR", requestId: "request-bjj-319-edit-unknown", outcome: "UNKNOWN" }),
      },
    });
    const view = renderEdit();
    await waitFor(() => expect(useClientWizardStore.getState().name).toBe(initialForm.name));
    act(() => useClientWizardStore.getState().setCurrentStep(2));

    clickSubmit();
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "저장" })).toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    fireEvent.click(screen.getByRole("button", { name: "이전" }));
    const nameInput = await screen.findByRole("textbox", { name: /^이름/ });
    fireEvent.change(nameInput, { target: { value: "보존할 수정값" } });
    mockEditingClient = { ...editClient(), name: "서버에서 다시 불러온 이름" };
    view.rerender(<NewClientPage />);

    await waitFor(() => expect(screen.getByRole("textbox", { name: /^이름/ })).toHaveValue("보존할 수정값"));
    expect(screen.getByRole("alert")).toHaveTextContent("요청 ID: request-bjj-319-edit-unknown");
    expect(screen.getByRole("button", { name: "다음" })).toBeDisabled();
    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
  });

  it("allows a NOT_APPLIED validation correction and retries with ordinary success", async () => {
    mockCreateClient
      .mockRejectedValueOnce({ response: { status: 400, data: validationProblem() } })
      .mockResolvedValueOnce({ id: 1 });
    renderCreate();

    clickSubmit();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("link", { name: "이름: 필수 항목이에요." }));
    const nameInput = await screen.findByRole("textbox", { name: /^이름/ });
    fireEvent.change(nameInput, { target: { value: "수정한 이름" } });
    act(() => useClientWizardStore.getState().setCurrentStep(2));

    clickSubmit();
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(2));
    expect(mockPush).toHaveBeenCalledWith("/clients");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the successful edit request shape unchanged", async () => {
    renderEdit();
    await waitFor(() => expect(useClientWizardStore.getState().name).toBe(initialForm.name));
    act(() => useClientWizardStore.getState().setCurrentStep(2));

    clickSubmit();
    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({
      id: 7,
      dto: expect.objectContaining({
        name: initialForm.name,
        phone: initialForm.phone,
        duration: initialForm.duration,
      }),
    });
    expect(mockPush).toHaveBeenCalledWith("/clients?id=7");
  });
});
