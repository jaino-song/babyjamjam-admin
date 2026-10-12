import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { useClientWizardStore } from "@/stores/client-wizard-store";

import NewClientPage from "./page";

const mockUseVoucherPriceInfos = jest.fn();
const mockUseOutOfPocketPriceInfos = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  useOutOfPocketPriceInfos: () => mockUseOutOfPocketPriceInfos(),
  useVoucherPriceInfos: (...args: unknown[]) => mockUseVoucherPriceInfos(...args),
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

jest.mock("@/components/app/clients/EmployeeAutocomplete", () => ({
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

type Result = Record<string, unknown>;

const VOUCHER_ROW = { id: 1, type: "A가1", duration: "10", fullPrice: "1000000", grant: "700000", actualPrice: "300000" };
const OOP_ROW = { id: 1, duration: 10, fullPrice: "900000" };

function query(overrides: Result = {}): Result {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isError: false,
    isFetching: false,
    isPaused: false,
    status: "success",
    fetchStatus: "idle",
    refetch: jest.fn(),
    ...overrides,
  };
}

const loaded = (data: unknown, extra: Result = {}) => query({ data, ...extra });
const paused = () => query({ isPending: true, isPaused: true, status: "pending", fetchStatus: "paused" });
const failed = (extra: Result = {}) => query({ isError: true, status: "error", ...extra });
const failedWithData = (data: unknown, extra: Result = {}) => query({ data, isError: true, status: "error", ...extra });
// enabled: false (no type selected): pending, idle, no data.
const disabled = () => query({ isPending: true, status: "pending", fetchStatus: "idle" });

const ERROR_ALERT = '[data-component="desktop_clients-new_service_step_price-load-error"]';
const PRICE_TITLE = "요금 정보를 불러오지 못했습니다";
const STALE_TITLE = "최신 정보를 불러오지 못했습니다";
const VOUCHER_MESSAGE = "바우처 요금을 불러오지 못했어요";
const OOP_MESSAGE = "자부담 요금을 불러오지 못했어요";

async function goToServiceStep(options: { voucherClient: boolean; type?: string; duration?: number }) {
  act(() => {
    const store = useClientWizardStore.getState();
    store.setField("voucherClient", options.voucherClient);
    store.setField("type", options.type ?? "");
    store.setField("duration", options.duration ?? null);
  });
  render(<NewClientPage />);
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "홍길동" } });
  fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "01012345678" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "다음" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  await screen.findByLabelText("서비스 기간");
}

const durationSelect = () => screen.getByLabelText("서비스 기간") as HTMLSelectElement;
const fullPriceInput = () => screen.getByLabelText("총 서비스 금액") as HTMLInputElement;
const spinner = () =>
  document.querySelector('[data-component$="duration-field_duration-select-wrap_duration-loading"]');

describe("NewClientPage price inputs when the price load is unknown", () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockUseVoucherPriceInfos.mockReset();
    mockUseOutOfPocketPriceInfos.mockReset();
    mockUseVoucherPriceInfos.mockReturnValue(loaded([]));
    mockUseOutOfPocketPriceInfos.mockReturnValue(loaded([]));
    act(() => {
      useClientWizardStore.getState().reset();
    });
  });

  describe("voucher client", () => {
    it("locks the duration select and full price, says why and offers one retry when the voucher prices failed", async () => {
      const refetch = jest.fn();
      mockUseVoucherPriceInfos.mockReturnValue(failed({ refetch }));
      await goToServiceStep({ voucherClient: true, type: "A가1" });

      const message = screen.getByText(VOUCHER_MESSAGE);
      expect(durationSelect()).toBeDisabled();
      expect(durationSelect()).toHaveAttribute("aria-describedby", message.id);
      expect(fullPriceInput()).toBeDisabled();
      // Only the two controls the out-of-pocket failure locks; grant and actual price stay editable.
      expect(screen.getByLabelText("정부지원금")).not.toBeDisabled();
      expect(screen.getByLabelText("본인부담금")).not.toBeDisabled();
      expect(spinner()).toBeNull();

      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(document.querySelector(ERROR_ALERT)).toHaveTextContent(PRICE_TITLE);
      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(mockUseOutOfPocketPriceInfos.mock.results[0].value.refetch).not.toHaveBeenCalled();
    });

    it("locks the full price through the failed voucher load even when a duration is still set", async () => {
      mockUseVoucherPriceInfos.mockReturnValue(failed());
      await goToServiceStep({ voucherClient: true, type: "A가1", duration: 10 });

      expect(fullPriceInput()).toBeDisabled();
      expect(fullPriceInput()).toHaveValue("");
    });

    it("treats a paused voucher price load like loading: locked with the spinner, no message, no alert", async () => {
      mockUseVoucherPriceInfos.mockReturnValue(paused());
      await goToServiceStep({ voucherClient: true, type: "A가1" });

      expect(durationSelect()).toBeDisabled();
      expect(fullPriceInput()).toBeDisabled();
      expect(spinner()).not.toBeNull();
      expect(screen.queryByText(VOUCHER_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps the disabled no-type state as it was: select disabled, no message, no spinner, no alert", async () => {
      mockUseVoucherPriceInfos.mockReturnValue(disabled());
      await goToServiceStep({ voucherClient: true });

      expect(durationSelect()).toBeDisabled();
      expect(spinner()).toBeNull();
      expect(screen.queryByText(VOUCHER_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("leaves the inputs unlocked and shows no message or alert when the prices loaded", async () => {
      mockUseVoucherPriceInfos.mockReturnValue(loaded([VOUCHER_ROW]));
      await goToServiceStep({ voucherClient: true, type: "A가1" });

      expect(durationSelect()).not.toBeDisabled();
      expect(within10Days(durationSelect())).toBe(true);
      expect(screen.queryByText(VOUCHER_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps cached prices usable and shows one inline notice when a refetch failed", async () => {
      const refetch = jest.fn();
      mockUseVoucherPriceInfos.mockReturnValue(failedWithData([VOUCHER_ROW], { refetch }));
      await goToServiceStep({ voucherClient: true, type: "A가1" });

      expect(durationSelect()).not.toBeDisabled();
      expect(within10Days(durationSelect())).toBe(true);
      expect(screen.queryByText(VOUCHER_MESSAGE)).not.toBeInTheDocument();
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(document.querySelector(ERROR_ALERT)).toHaveTextContent(STALE_TITLE);

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("never blocks 다음, whatever the price state", async () => {
      mockUseVoucherPriceInfos.mockReturnValue(failed());
      await goToServiceStep({ voucherClient: true, type: "A가1" });

      expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "다음" }));
      expect((await screen.findByLabelText("계약 상태")).tagName).toBe("SELECT");
    });
  });

  describe("self-pay client", () => {
    it("keeps the existing message and adds the one inline alert whose retry refetches the out-of-pocket prices", async () => {
      const refetch = jest.fn();
      mockUseOutOfPocketPriceInfos.mockReturnValue(failed({ refetch }));
      await goToServiceStep({ voucherClient: false });

      expect(screen.getByText(OOP_MESSAGE)).toBeInTheDocument();
      expect(durationSelect()).toBeDisabled();
      expect(fullPriceInput()).toBeDisabled();
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(document.querySelector(ERROR_ALERT)).toHaveTextContent(PRICE_TITLE);

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(mockUseVoucherPriceInfos.mock.results[0].value.refetch).not.toHaveBeenCalled();
    });

    it("ignores a failed voucher price query while the self-pay type is selected", async () => {
      mockUseVoucherPriceInfos.mockReturnValue(failed());
      mockUseOutOfPocketPriceInfos.mockReturnValue(loaded([OOP_ROW]));
      await goToServiceStep({ voucherClient: false, type: "A가1" });

      expect(durationSelect()).not.toBeDisabled();
      expect(screen.queryByText(VOUCHER_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("treats a paused out-of-pocket load like loading: locked with the spinner, no message, no alert", async () => {
      mockUseOutOfPocketPriceInfos.mockReturnValue(paused());
      await goToServiceStep({ voucherClient: false });

      expect(durationSelect()).toBeDisabled();
      expect(spinner()).not.toBeNull();
      expect(screen.queryByText(OOP_MESSAGE)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps cached out-of-pocket prices usable and shows one inline notice when a refetch failed", async () => {
      const refetch = jest.fn();
      mockUseOutOfPocketPriceInfos.mockReturnValue(failedWithData([OOP_ROW], { refetch }));
      await goToServiceStep({ voucherClient: false });

      expect(durationSelect()).not.toBeDisabled();
      expect(screen.queryByText(OOP_MESSAGE)).not.toBeInTheDocument();
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(document.querySelector(ERROR_ALERT)).toHaveTextContent(STALE_TITLE);

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("shows no alert when the out-of-pocket prices loaded", async () => {
      mockUseOutOfPocketPriceInfos.mockReturnValue(loaded([OOP_ROW]));
      await goToServiceStep({ voucherClient: false });

      expect(durationSelect()).not.toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});

function within10Days(select: HTMLSelectElement): boolean {
  return Array.from(select.options).some((option) => option.textContent === "10일");
}
