import { fireEvent, render, screen, within } from "@testing-library/react";

import AllMenuPage from "../page";

interface QueryState {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  status?: "pending" | "success" | "error";
  fetchStatus?: "idle" | "fetching" | "paused";
  refetch: jest.Mock;
}

const mockRefetchEmployees = jest.fn();
let mockEmployees: Omit<QueryState, "refetch">;
// The full react-query shape of the other two counts, so a paused load can be fed in.
let mockClients: Record<string, unknown>;
let mockTemplates: Record<string, unknown>;

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: { id: "u1", name: "관리자", role: "staff", branchRole: "manager" },
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => mockClients,
}));
jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ ...mockEmployees, refetch: mockRefetchEmployees }),
}));
jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplates: () => mockTemplates,
}));
jest.mock("@/hooks/usePushNotification", () => ({
  usePushNotification: () => ({ isLoading: false, isSubscribed: false }),
}));
jest.mock("@/hooks/use-consultation-inquiries", () => ({
  useConsultationInquiries: () => ({ data: { total: 0 }, isLoading: false, isError: false, error: null }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/all",
}));
jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => null,
}));

// react-query state for a query started offline: pending but paused, so isLoading is false.
const PAUSED_NO_DATA = {
  data: undefined,
  isPending: true,
  isLoading: false,
  isError: false,
  isFetching: false,
  isPaused: true,
  error: null,
  status: "pending",
  fetchStatus: "paused",
};
const LOADED_EMPTY = { data: [], isLoading: false, isError: false, error: null };

const NETWORK_ERROR = Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
const ALERT_TITLE = "직원 수를 새로 불러오지 못했어요";

function employeesRow(): HTMLElement {
  return screen.getByRole("link", { name: /제공인력/ });
}

function clientsRow(): HTMLElement {
  return screen.getByRole("link", { name: /고객/ });
}

function templatesRow(): HTMLElement {
  return screen.getByRole("link", { name: /^메시지/ });
}

describe("AllMenuPage employee count load failures", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmployees = { data: [], isLoading: false, isError: false, isFetching: false, error: null };
    mockClients = { ...LOADED_EMPTY };
    mockTemplates = { ...LOADED_EMPTY };
  });

  it("shows an alert with retry and never 0명 when the employees load failed with no data", () => {
    mockEmployees = { data: undefined, isLoading: false, isError: true, isFetching: false, error: NETWORK_ERROR };

    render(<AllMenuPage />);

    const alert = screen.getByText(ALERT_TITLE).closest('[data-component="mobile_all_page_employees-read-error"]');
    expect(alert).not.toBeNull();
    expect(within(employeesRow()).queryByText("0명")).not.toBeInTheDocument();
    expect(within(employeesRow()).queryByText(/명$/)).not.toBeInTheDocument();

    fireEvent.click(within(alert as HTMLElement).getByRole("button", { name: "다시 시도" }));
    expect(mockRefetchEmployees).toHaveBeenCalledTimes(1);
  });

  it("never prints 0명 while a retry is paused offline with nothing cached", () => {
    // react-query state for a retry started offline: pending + paused, so neither isLoading nor isError.
    mockEmployees = {
      data: undefined,
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      status: "pending",
      fetchStatus: "paused",
    };

    render(<AllMenuPage />);

    expect(within(employeesRow()).queryByText("0명")).not.toBeInTheDocument();
    expect(within(employeesRow()).queryByText(/명$/)).not.toBeInTheDocument();
    expect(employeesRow().querySelector(".menu-value-skeleton")).not.toBeNull();
  });

  it("never prints 0명 on a failed load even when the normalised error is suppressed", () => {
    mockEmployees = {
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      error: Object.assign(new Error("canceled"), { code: "ERR_CANCELED", name: "CanceledError" }),
    };

    render(<AllMenuPage />);

    expect(within(employeesRow()).queryByText(/명$/)).not.toBeInTheDocument();
    expect(screen.getByText(ALERT_TITLE)).toBeInTheDocument();
  });

  it("shows a real 0명 and no alert after a successful load with zero employees", () => {
    render(<AllMenuPage />);

    expect(within(employeesRow()).getByText("0명")).toBeInTheDocument();
    expect(screen.queryByText(ALERT_TITLE)).not.toBeInTheDocument();
  });

  it("keeps the cached count and shows the alert when a refetch failed", () => {
    mockEmployees = {
      data: [{ id: 1 }, { id: 2 }, { id: 3 }],
      isLoading: false,
      isError: true,
      isFetching: false,
      error: NETWORK_ERROR,
    };

    render(<AllMenuPage />);

    expect(within(employeesRow()).getByText("3명")).toBeInTheDocument();
    expect(screen.getByText(ALERT_TITLE)).toBeInTheDocument();
  });

  it("disables the alert retry while the refetch is in flight", () => {
    mockEmployees = {
      data: [{ id: 1 }],
      isLoading: false,
      isError: true,
      isFetching: true,
      error: NETWORK_ERROR,
    };

    render(<AllMenuPage />);

    const alert = screen.getByText(ALERT_TITLE).closest('[data-component="mobile_all_page_employees-read-error"]');
    expect(within(alert as HTMLElement).getByRole("button", { name: "다시 시도" })).toBeDisabled();
    expect(within(employeesRow()).getByText("1명")).toBeInTheDocument();
  });

  it("shows the count with no alert after a successful load", () => {
    mockEmployees = {
      data: [{ id: 1 }, { id: 2 }],
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
    };

    render(<AllMenuPage />);

    expect(within(employeesRow()).getByText("2명")).toBeInTheDocument();
    expect(screen.queryByText(ALERT_TITLE)).not.toBeInTheDocument();
  });
});

describe("AllMenuPage client and message-template counts while a load is paused offline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmployees = { data: [], isLoading: false, isError: false, isFetching: false, error: null };
    mockClients = { ...LOADED_EMPTY };
    mockTemplates = { ...LOADED_EMPTY };
  });

  it("shows the value skeleton and never 0명 for 고객 while its load is paused with nothing cached", () => {
    mockClients = { ...PAUSED_NO_DATA };

    render(<AllMenuPage />);

    expect(within(clientsRow()).queryByText("0명")).not.toBeInTheDocument();
    expect(within(clientsRow()).queryByText(/명$/)).not.toBeInTheDocument();
    expect(clientsRow().querySelector(".menu-value-skeleton")).not.toBeNull();
  });

  it("shows the value skeleton and never 0건 for 메시지 while its load is paused with nothing cached", () => {
    mockTemplates = { ...PAUSED_NO_DATA };

    render(<AllMenuPage />);

    expect(within(templatesRow()).queryByText("0건")).not.toBeInTheDocument();
    expect(within(templatesRow()).queryByText(/건$/)).not.toBeInTheDocument();
    expect(templatesRow().querySelector(".menu-value-skeleton")).not.toBeNull();
  });

  it("keeps the cached counts when a refetch is paused", () => {
    mockClients = { ...LOADED_EMPTY, data: [{ id: 1 }, { id: 2 }], isPaused: true, fetchStatus: "paused" };
    mockTemplates = { ...LOADED_EMPTY, data: [{ id: 1 }], isPaused: true, fetchStatus: "paused" };

    render(<AllMenuPage />);

    expect(within(clientsRow()).getByText("2명")).toBeInTheDocument();
    expect(within(templatesRow()).getByText("1건")).toBeInTheDocument();
  });

  it("still shows a real 0명 and 0건 after successful empty loads", () => {
    render(<AllMenuPage />);

    expect(within(clientsRow()).getByText("0명")).toBeInTheDocument();
    expect(within(templatesRow()).getByText("0건")).toBeInTheDocument();
    expect(clientsRow().querySelector(".menu-value-skeleton")).toBeNull();
    expect(templatesRow().querySelector(".menu-value-skeleton")).toBeNull();
  });
});
