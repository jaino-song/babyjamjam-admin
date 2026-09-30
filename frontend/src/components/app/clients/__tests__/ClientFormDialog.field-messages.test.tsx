import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "@/lib/api/client";

import { ClientFormDialog, ClientFormPanel } from "../ClientFormDialog";

const mockCreateClient = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: false, mutateAsync: mockCreateClient }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  useAvailableClientAreas: () => ({ data: [], isLoading: false }),
  useAreaTemplates: () => ({ data: [], isLoading: false }),
  useOutOfPocketPriceInfos: () => ({
    data: [{ id: 1, duration: 5, fullPrice: "815000" }],
    isError: false,
    isLoading: false,
  }),
  useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
  useVoucherYears: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/stores/client-dialog-store", () => {
  const state = { prefillName: "", clearPrefillName: jest.fn() };

  return {
    useClientDialogStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("../EmployeeAutocomplete", () => ({
  EmployeeAutocomplete: () => <div data-testid="employee-autocomplete" />,
}));

jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
  EmployeeFormDialog: () => null,
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

const mockApiGet = api.get as jest.MockedFunction<typeof api.get>;

const FIELD_MESSAGE_SELECTOR = '[data-slot="field-message"], [data-slot="field-error-message"]';

async function openDialog() {
  const view = render(<ClientFormDialog open onClose={jest.fn()} />);
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

function changeField(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function fillRequiredFields() {
  changeField(/이름/, "홍길동");
  changeField(/생년월일/, "19900101");
  changeField(/주소/, "서울시 강남구");
  changeField(/연락처/, "01012345678");
  await screen.findByText("등록 가능한 번호입니다.");
}

describe("ClientFormDialog inline field messages", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockCreateClient.mockReset().mockResolvedValue({ id: 1 });
  });

  it("shows no field message on first render", async () => {
    const { baseElement } = await openDialog();

    expect(baseElement.querySelectorAll(FIELD_MESSAGE_SELECTOR)).toHaveLength(0);
    expect(screen.getByLabelText(/생년월일/)).toHaveAttribute("placeholder", "1958-03-03");
    expect(screen.getByLabelText("출산 예정일")).toHaveAttribute("placeholder", "2026-11-20");
    expect(screen.getByLabelText("출산일")).toHaveAttribute("placeholder", "2026-11-20");
    expect(screen.getByLabelText("시작일")).toHaveAttribute("placeholder", "2026-12-01");
    expect(screen.getByLabelText("종료일")).toHaveAttribute("placeholder", "2026-12-19");
  });

  it("shows the required message only after a typed value is cleared", async () => {
    await openDialog();
    const name = screen.getByLabelText(/이름/);

    fireEvent.focus(name);
    fireEvent.blur(name);
    expect(screen.queryByText("이름을 입력해 주세요")).not.toBeInTheDocument();

    changeField(/이름/, "홍");
    expect(screen.queryByText("이름을 입력해 주세요")).not.toBeInTheDocument();

    changeField(/이름/, "");
    const message = screen.getByText("이름을 입력해 주세요");
    expect(message).toHaveAttribute("aria-live", "polite");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute("aria-describedby", message.id);
  });

  it("hints the phone format while focused and reports it once the field is left incomplete", async () => {
    await openDialog();
    const phone = screen.getByLabelText(/연락처/);

    fireEvent.focus(phone);
    changeField(/연락처/, "0101234");
    expect(screen.getByText("010-1234-5678 형식")).toBeInTheDocument();
    expect(phone).not.toHaveAttribute("aria-invalid");

    fireEvent.blur(phone);
    expect(screen.getByText("010-1234-5678 형식으로 입력해 주세요")).toBeInTheDocument();
    expect(screen.queryByText("연락처를 입력해 주세요")).not.toBeInTheDocument();
    expect(phone).toHaveAttribute("aria-invalid", "true");
  });

  it("formats contract dates as YYYY-MM-DD while typing", async () => {
    await openDialog();

    changeField("시작일", "20261201");

    expect(screen.getByLabelText("시작일")).toHaveValue("2026-12-01");
  });

  it("reports an end date before the start date", async () => {
    await openDialog();
    changeField("시작일", "20261201");
    const endDate = screen.getByLabelText("종료일");

    fireEvent.focus(endDate);
    changeField("종료일", "20261119");
    fireEvent.blur(endDate);

    expect(screen.getByText("종료일은 시작일 이후여야 해요")).toBeInTheDocument();
    expect(endDate).toHaveAttribute("aria-invalid", "true");
  });

  it("reveals every problem on submit and focuses the first problem field without submitting", async () => {
    await openDialog();
    changeField("시작일", "2026");

    fireEvent.click(screen.getByRole("button", { name: "생성" }));

    expect(screen.getByText("이름을 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("생년월일을 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("연락처를 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("주소를 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("YYYY-MM-DD 형식으로 입력해 주세요")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText(/이름/));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("sends contract dates typed as YYYY-MM-DD in the request body", async () => {
    await openDialog();
    await fillRequiredFields();
    changeField("시작일", "20261201");
    changeField("종료일", "20261219");
    expect(screen.getByLabelText("종료일")).toHaveValue("2026-12-19");

    await waitFor(() => expect(screen.getByRole("button", { name: "생성" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "생성" }));

    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
    expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
      startDate: "2026-12-01",
      endDate: "2026-12-19",
    }));
  });

  it("still derives the ISO end date from the start date and duration", async () => {
    await openDialog();
    await fillRequiredFields();
    changeField("시작일", "20261201");
    changeField("서비스 기간", "5");

    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-12-07"));

    await waitFor(() => expect(screen.getByRole("button", { name: "생성" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "생성" }));

    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
    expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
      duration: 5,
      startDate: "2026-12-01",
      endDate: "2026-12-07",
    }));
  });
});

describe("ClientFormPanel inline field messages", () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
  });

  it("lets Next reveal the problems of the basic step instead of staying disabled", async () => {
    render(<ClientFormPanel open activeStep={0} onClose={jest.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });

    const next = screen.getByRole("button", { name: "다음" });
    expect(next).toBeEnabled();
    expect(document.querySelectorAll(FIELD_MESSAGE_SELECTOR)).toHaveLength(0);

    fireEvent.click(next);

    expect(screen.getByText("이름을 입력해 주세요")).toBeInTheDocument();
    expect(screen.getByText("연락처를 입력해 주세요")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText(/이름/));
  });
});
