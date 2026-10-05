/**
 * Picking an existing client keeps that client's stored end date as-is. The end
 * date is recalculated (branch calendar) only once the user edits the start
 * date or the duration, and a client with no stored end date is auto-calculated.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import type { UseBusinessDayCalendarResult } from "@/hooks/useBusinessDayCalendar";
import { createKrBusinessDayCalendar, KR_BUILTIN_CALENDAR, KR_BUILTIN_HOLIDAYS } from "@/lib/date/business-days";

import type { Client } from "@/lib/client/types";
import { useFormStore } from "@/stores/form-store";
import { ContractCreationForm } from "../ContractCreationForm";

const mockCreateClientMutateAsync = jest.fn();
const mockUpdateClientMutateAsync = jest.fn();
const mockDeleteClientMutateAsync = jest.fn();
const mockEnqueueMutateAsync = jest.fn();
const mockDispatchHeadless = jest.fn();

jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("@/components/app/clients/ClientAutocomplete", () => ({
  ClientAutocomplete: ({ onChange }: { onChange: (id: number | null, client: unknown) => void }) => {
    const clients = (globalThis as { __keepEndDateClients?: Array<{ id: number; name: string }> }).__keepEndDateClients ?? [];
    return (
      <div>
        {clients.map((client) => (
          <button key={client.id} type="button" onClick={() => onChange(client.id, client)}>
            {`고객 선택 ${client.id}`}
          </button>
        ))}
        <button type="button" onClick={() => onChange(null, null)}>고객 선택 해제</button>
      </div>
    );
  },
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({ data: { phone: "010-1234-5678" } }),
}));

jest.mock("@/hooks/useEformsign", () => ({
  useEformsign: () => ({
    isLoaded: true,
    isLoading: false,
    error: null,
    openDocument: jest.fn(),
  }),
}));

jest.mock("@/services/api", () => ({
  eformsignApi: {
    dispatchHeadless: (...args: unknown[]) => mockDispatchHeadless(...args),
    generateDocument: jest.fn(),
    createDocRecord: jest.fn().mockResolvedValue({}),
    adoptDocument: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (flag: string) => flag === "eformsignDocumentJobs",
}));

jest.mock("@/hooks/useEformsignDocumentJobs", () => ({
  useEnqueueEformsignDocumentCreation: () => ({
    mutateAsync: (...args: unknown[]) => mockEnqueueMutateAsync(...args),
    isPending: false,
  }),
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ mutateAsync: (...args: unknown[]) => mockCreateClientMutateAsync(...args), isPending: false }),
  useUpdateClient: () => ({ mutateAsync: (...args: unknown[]) => mockUpdateClientMutateAsync(...args), isPending: false }),
  useDeleteClient: () => ({ mutateAsync: (...args: unknown[]) => mockDeleteClientMutateAsync(...args), isPending: false }),
  useAllClients: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({
    data: [{ id: 7, name: "김정인", phone: "010-5787-1878", workArea: [] }],
    isLoading: false,
  }),
  useCreateEmployee: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateEmployee: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock("@/hooks", () => ({
  useVoucherPriceInfos: () => ({
    data: [{ duration: "15", fullPrice: 1000000, grant: 800000, actualPrice: 200000 }],
    isLoading: false,
  }),
  useVoucherYears: () => ({ data: [2026], isLoading: false }),
  useAreaTemplates: () => ({
    data: [{ id: "area-template-1", areaId: "인천", templateId: "template-1", templateName: "인천 산모 계약서" }],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  }),
}));

jest.mock("@/lib/sse/reconnecting-event-source", () => ({
  createReconnectingEventSource: () => ({ close: jest.fn() }),
}));

const CONTACT_STEP_INDEX = 0;
const CONTRACT_INFO_STEP_INDEX = 3;
const DIALOG_TITLE = "고객 정보와 다른 내용이 있어요";
const UNSUPPORTED_YEAR_NOTICE = "이 기간의 공휴일 정보가 아직 없어요. 종료일을 계산할 수 없어요.";

// 2026-09-14 (Mon) is a normal weekday in the built-in list; the branch makes it a holiday, so
// 2026-09-07 + 15 business days is 2026-09-30 here while the stored client says 2026-09-29.
const BRANCH_CALENDAR = createKrBusinessDayCalendar([...KR_BUILTIN_HOLIDAYS, "2026-09-14"], {
  version: "kr-db-test-keep-end",
  supportedYears: [2026, 2027],
});
const mockedHook = useBusinessDayCalendar as jest.MockedFunction<typeof useBusinessDayCalendar>;

function hookResult(overrides: Partial<UseBusinessDayCalendarResult> = {}): UseBusinessDayCalendarResult {
  const calendar = overrides.calendar ?? BRANCH_CALENDAR;
  return { calendar, ready: true, error: null, retry: jest.fn(), refreshForSave: async () => ({ ok: true, calendar, changed: false }), version: calendar.version, ...overrides };
}

const STORED_CLIENT: Client = {
  id: 501,
  name: "김민지",
  birthday: null,
  dueDate: null,
  birthDate: null,
  address: "인천시 남동구",
  phone: "010-1111-2222",
  primaryEmployee: { id: 7, name: "김정인", phone: "010-5787-1878" },
  secondaryEmployee: null,
  type: "일반",
  duration: 15,
  fullPrice: "1000000",
  grant: "800000",
  actualPrice: "200000",
  startDate: "2026-09-07",
  endDate: "2026-09-29",
  careCenter: false,
  voucherClient: true,
  breastPump: false,
  serviceStatus: null,
  eDocId: null,
  areaId: "인천",
  hasSigned: false,
  documentStatus: null,
};

const OTHER_CLIENT: Client = {
  ...STORED_CLIENT,
  id: 502,
  name: "이서연",
  phone: "010-3333-4444",
  duration: 10,
  startDate: "2026-10-05",
  endDate: "2026-10-16",
};

const CLIENT_WITHOUT_END_DATE: Client = { ...STORED_CLIENT, id: 503, name: "박지우", endDate: null };

// The stored period reaches 2028, a year the branch calendar does not cover.
const UNSUPPORTED_YEAR_CLIENT: Client = {
  ...STORED_CLIENT,
  id: 504,
  name: "최하늘",
  duration: 40,
  startDate: "2027-12-01",
  endDate: "2028-01-26",
};

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

function buildUi(props: { initialClient?: Client; activeStep?: number } = {}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ContractCreationForm
        initialClient={props.initialClient}
        activeStep={props.activeStep ?? CONTRACT_INFO_STEP_INDEX}
        onActiveStepChange={jest.fn()}
      />
    </QueryClientProvider>
  );
}

// Picks the client on the first step, then moves to the contract-info step like the wizard does.
function pickClient(view: ReturnType<typeof render>, clientId: number) {
  view.rerender(buildUi({ activeStep: CONTACT_STEP_INDEX }));
  fireEvent.click(screen.getByRole("button", { name: `고객 선택 ${clientId}` }));
  view.rerender(buildUi({ activeStep: CONTRACT_INFO_STEP_INDEX }));
}

function renderForm(clients: Client[]) {
  (globalThis as { __keepEndDateClients?: Client[] }).__keepEndDateClients = clients;
  return render(buildUi({ activeStep: CONTACT_STEP_INDEX }));
}

function submit() {
  fireEvent.click(screen.getByTestId("contract-creation-submit"));
}

describe("ContractCreationForm — a picked client keeps its stored end date", () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    }
    global.ResizeObserver = ResizeObserverMock;
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockCreateClientMutateAsync.mockReset().mockResolvedValue({ id: 999 });
    mockUpdateClientMutateAsync.mockReset().mockResolvedValue({});
    mockDeleteClientMutateAsync.mockReset().mockResolvedValue({});
    mockEnqueueMutateAsync.mockReset().mockResolvedValue({});
    useFormStore.getState().resetAll();
    mockedHook.mockImplementation(() => hookResult());
  });

  it("guards the fixture: the branch calendar would calculate a different end date than the stored one", () => {
    expect(BRANCH_CALENDAR.calcEndDateBusinessDays("2026-09-07", 15)).toBe("2026-09-30");
    expect(KR_BUILTIN_CALENDAR.calcEndDateBusinessDays("2026-09-07", 15)).toBe("2026-09-29");
  });

  it("shows the stored end date, submits it, and raises no end-date diff", async () => {
    const view = renderForm([STORED_CLIENT]);
    pickClient(view, 501);

    expect(useFormStore.getState().endDate).toBe("2026-09-29");
    expect(screen.getByLabelText("계약 종료일")).toHaveValue("2026-09-29");

    act(() => {
      useFormStore.getState().setPaymentDate("2026-09-07");
      useFormStore.getState().setArea("인천");
    });
    submit();

    await waitFor(() => expect(mockEnqueueMutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(DIALOG_TITLE)).not.toBeInTheDocument();
    expect(mockEnqueueMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        contractData: expect.objectContaining({ endDate: "2026-09-29" }),
      }),
    );
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
  });

  it("keeps the stored end date for a client opened from the client detail page", async () => {
    render(buildUi({ initialClient: STORED_CLIENT }));
    act(() => {
      useFormStore.getState().setPaymentDate("2026-09-07");
    });

    expect(useFormStore.getState().endDate).toBe("2026-09-29");
    submit();

    await waitFor(() => expect(mockEnqueueMutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(DIALOG_TITLE)).not.toBeInTheDocument();
  });

  it("recalculates on the branch calendar once the duration is edited, and still shows the diff", async () => {
    const view = renderForm([STORED_CLIENT]);
    pickClient(view, 501);
    expect(useFormStore.getState().endDate).toBe("2026-09-29");

    act(() => {
      useFormStore.getState().setVoucherDuration("16");
    });

    const recalculated = BRANCH_CALENDAR.calcEndDateBusinessDays("2026-09-07", 16);
    expect(recalculated).not.toBe("2026-09-29");
    expect(useFormStore.getState().endDate).toBe(recalculated);
    expect(screen.getByLabelText("계약 종료일")).toHaveValue(recalculated);

    act(() => {
      useFormStore.getState().setPaymentDate("2026-09-07");
      useFormStore.getState().setArea("인천");
    });
    submit();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("계약 종료일")).toBeInTheDocument();
    expect(within(dialog).getByText(new RegExp(`2026-09-29 → ${recalculated}`))).toBeInTheDocument();
    expect(mockEnqueueMutateAsync).not.toHaveBeenCalled();
  });

  it("recalculates when the start date is edited, and again when the duration goes back to the stored value", () => {
    const view = renderForm([STORED_CLIENT]);
    pickClient(view, 501);

    act(() => {
      useFormStore.getState().setStartDate("2026-09-08");
    });
    expect(useFormStore.getState().endDate).toBe(BRANCH_CALENDAR.calcEndDateBusinessDays("2026-09-08", 15));

    act(() => {
      useFormStore.getState().setStartDate("2026-09-07");
    });
    // The stored end date is not restored by returning to the stored inputs: the user edited them.
    expect(useFormStore.getState().endDate).toBe("2026-09-30");
  });

  it("keeps the stored end date when the client is picked while the calendar is loading and it becomes ready", () => {
    mockedHook.mockImplementation(() => hookResult({ ready: false }));
    const view = renderForm([STORED_CLIENT]);
    pickClient(view, 501);
    expect(useFormStore.getState().endDate).toBe("2026-09-29");

    mockedHook.mockImplementation(() => hookResult());
    view.rerender(buildUi());

    expect(useFormStore.getState().endDate).toBe("2026-09-29");
    expect(screen.getByLabelText("계약 종료일")).toHaveValue("2026-09-29");
  });

  it("keeps a stored end date in a year the calendar does not cover, with no notice and submit allowed", () => {
    const view = renderForm([UNSUPPORTED_YEAR_CLIENT]);
    pickClient(view, 504);
    act(() => {
      useFormStore.getState().setPaymentDate("2027-12-01");
      useFormStore.getState().setArea("인천");
    });

    expect(useFormStore.getState().endDate).toBe("2028-01-26");
    expect(screen.getByLabelText("계약 종료일")).toHaveValue("2028-01-26");
    expect(screen.queryByText(UNSUPPORTED_YEAR_NOTICE)).not.toBeInTheDocument();
    expect(screen.getByTestId("contract-creation-submit")).not.toBeDisabled();
  });

  it("still clears the end date and blocks submit when an edit makes the calculation reach an unsupported year", () => {
    const view = renderForm([UNSUPPORTED_YEAR_CLIENT]);
    pickClient(view, 504);

    act(() => {
      useFormStore.getState().setVoucherDuration("41");
    });

    expect(useFormStore.getState().endDate).toBe("");
    expect(screen.getByText(UNSUPPORTED_YEAR_NOTICE)).toBeInTheDocument();
    expect(screen.getByTestId("contract-creation-submit")).toBeDisabled();
  });

  it("auto-calculates for a client with no stored end date", () => {
    const view = renderForm([CLIENT_WITHOUT_END_DATE]);
    pickClient(view, 503);

    expect(useFormStore.getState().endDate).toBe("2026-09-30");
  });

  it("shows the next client's stored end date after switching, and auto-calculates after switching to one without", () => {
    const view = renderForm([STORED_CLIENT, OTHER_CLIENT, CLIENT_WITHOUT_END_DATE]);
    pickClient(view, 501);
    expect(useFormStore.getState().endDate).toBe("2026-09-29");

    pickClient(view, 502);
    expect(useFormStore.getState().endDate).toBe("2026-10-16");
    expect(screen.getByLabelText("계약 종료일")).toHaveValue("2026-10-16");

    pickClient(view, 503);
    expect(useFormStore.getState().endDate).toBe("2026-09-30");
  });

  it("stops keeping a cleared client's end date: a fresh start and duration are calculated", () => {
    const view = renderForm([STORED_CLIENT]);
    pickClient(view, 501);

    view.rerender(buildUi({ activeStep: CONTACT_STEP_INDEX }));
    fireEvent.click(screen.getByRole("button", { name: "고객 선택 해제" }));
    view.rerender(buildUi());
    act(() => {
      useFormStore.getState().setStartDate("2026-09-07");
      useFormStore.getState().setVoucherDuration("15");
    });

    expect(useFormStore.getState().endDate).toBe("2026-09-30");
  });
});
