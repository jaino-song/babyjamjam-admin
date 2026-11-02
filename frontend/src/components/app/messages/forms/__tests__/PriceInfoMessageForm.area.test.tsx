import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { useAvailableClientAreas, useBankAccountInfos } from "@/hooks";
import { useSystemTemplate } from "@/features/system-templates/hooks";
import { useFormStore } from "@/stores/form-store";

import { PriceInfoMessageForm } from "../PriceInfoMessageForm";

jest.mock("@/hooks", () => ({
  useBankAccountInfos: jest.fn(),
  useVoucherPriceInfos: jest.fn(() => ({ data: [], isLoading: false })),
  useAvailableClientAreas: jest.fn(),
}));

jest.mock("@/features/system-templates/hooks", () => ({
  useSystemTemplate: jest.fn(),
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/components/app/messages/templates/AutoFillMsgCard", () => ({
  AutoFillMsgCard: ({ message }: { message: string }) => (
    <div data-testid="generated-message">{message}</div>
  ),
}));

const mockedUseBankAccountInfos = jest.mocked(useBankAccountInfos);
const mockedUseAvailableClientAreas = jest.mocked(useAvailableClientAreas);
const mockedUseSystemTemplate = jest.mocked(useSystemTemplate);

const BANK_ACCOUNT_INFOS = [
  { area: "Namdonggu", bankName: "농협은행", accNum: "111-1111-1111" },
  { area: "QaDev", bankName: "QA테스트은행", accNum: "000-0000-0000" },
];

function mockAvailableAreas(data: unknown[] | undefined) {
  mockedUseAvailableClientAreas.mockReturnValue({ data, isLoading: false } as never);
}

// The form syncs its local state in queueMicrotask effects; flush them inside act.
async function renderForm() {
  render(<PriceInfoMessageForm />);
  await act(async () => {});
}

function openAreaSelect() {
  // The selects carry no accessible name; the area trigger shows its placeholder "지역".
  const trigger = screen.getAllByRole("combobox").find((el) => el.textContent === "지역");
  if (!trigger) throw new Error("area select trigger not found");
  fireEvent.click(trigger);
  return screen.getByRole("listbox");
}

describe("PriceInfoMessageForm area select", () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    }

    global.ResizeObserver = ResizeObserverMock;
    Element.prototype.hasPointerCapture = jest.fn(() => false);
    Element.prototype.setPointerCapture = jest.fn();
    Element.prototype.releasePointerCapture = jest.fn();
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    act(() => {
      useFormStore.setState({ area: "", name: "홍길동" });
    });
    mockedUseBankAccountInfos.mockReturnValue({ data: BANK_ACCOUNT_INFOS } as never);
    mockedUseSystemTemplate.mockReturnValue({
      data: { content: "{{bankName}} {{accNum}}", description: "" },
      isError: false,
      isFetching: false,
      isLoading: false,
    } as never);
    mockAvailableAreas([
      { id: "QaDev", name: "QaDev", koreanName: "QA테스트구" },
      { id: "Namdonggu", name: "Namdong-gu", koreanName: "남동구" },
    ]);
  });

  it("renders without throwing and labels an area missing from bank-account.json with the API koreanName", async () => {
    await renderForm();

    const listbox = openAreaSelect();

    expect(within(listbox).getByRole("option", { name: "QA테스트구" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "남동구" })).toBeInTheDocument();
  });

  it("falls back to the raw area id when no Korean name is available anywhere", async () => {
    mockAvailableAreas(undefined);

    await renderForm();

    const listbox = openAreaSelect();

    expect(within(listbox).getByRole("option", { name: "QaDev" })).toBeInTheDocument();
    // Known area still resolves through bank-account.json.
    expect(within(listbox).getByRole("option", { name: "남동구" })).toBeInTheDocument();
  });

  it("keeps the bank-account.json label for a known area when the area hook has no match", async () => {
    mockAvailableAreas([]);

    await renderForm();

    const listbox = openAreaSelect();

    expect(within(listbox).getByRole("option", { name: "남동구" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "QaDev" })).toBeInTheDocument();
  });

  it("fills bank info from the API row when an unknown area is chosen", async () => {
    await renderForm();

    fireEvent.click(within(openAreaSelect()).getByRole("option", { name: "QA테스트구" }));

    await waitFor(() =>
      expect(screen.getByTestId("generated-message")).toHaveTextContent("QA테스트은행 000-0000-0000"),
    );
    expect(useFormStore.getState().area).toBe("QaDev");
  });
});
