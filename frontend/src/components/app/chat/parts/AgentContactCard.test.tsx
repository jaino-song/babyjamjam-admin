import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AgentContactCard } from "./AgentContactCard";

const mockUseQuery = jest.fn();
const mockUseActiveBranchId = jest.fn();
const mockIsBranchContextAligned = jest.fn();
const mockClientsGetById = jest.fn();
const mockEmployeesGetById = jest.fn();

// Most tests script the hook's result; the transition tests at the bottom flip
// `useRealQuery` and run the real useQuery against a real QueryClient.
let useRealQuery = false;
jest.mock("@tanstack/react-query", () => {
    const actual = jest.requireActual("@tanstack/react-query");
    return {
        ...actual,
        useQuery: (options: Parameters<typeof actual.useQuery>[0]) => (useRealQuery ? actual.useQuery(options) : mockUseQuery(options)),
    };
});
jest.mock("@/features/system-templates/branch-context", () => ({
    useActiveBranchId: () => mockUseActiveBranchId(),
    isBranchContextAligned: (branchId: string | null) => mockIsBranchContextAligned(branchId),
}));
jest.mock("@/features/clients/api/clients.api", () => ({
    clientsApi: { getById: (id: number) => mockClientsGetById(id) },
}));
jest.mock("@/features/employees/api/employees.api", () => ({
    employeesApi: { getById: (id: number) => mockEmployeesGetById(id) },
}));

type QueryOptions = { queryKey: readonly unknown[]; enabled: boolean; queryFn: () => Promise<unknown> };

const DC = "desktop_chat_tests_agent-contact-card";
const refetch = jest.fn();

// Only states react-query v5 can produce.
const pending = { data: undefined, isError: false, error: null, isFetching: true, refetch };
const success = (data: unknown) => ({ data, isError: false, error: null, isFetching: false, refetch });
const failedWithoutData = (error: unknown) => ({ data: undefined, isError: true, error, isFetching: false, refetch });
const failedRefetch = (data: unknown, error: unknown = new Error("boom")) => ({ data, isError: true, error, isFetching: false, refetch });
const httpError = (status: number) => ({ response: { status } });

function lastOptions(): QueryOptions {
    const calls = mockUseQuery.mock.calls;
    return calls[calls.length - 1][0] as QueryOptions;
}

beforeEach(() => {
    jest.clearAllMocks();
    useRealQuery = false;
    mockUseActiveBranchId.mockReturnValue("branch-1");
    mockIsBranchContextAligned.mockImplementation((branchId: string | null) => branchId !== null);
    mockUseQuery.mockReturnValue(pending);
});

describe("AgentContactCard", () => {
    it("renders nothing while the branch context is not ready, even with cached data", () => {
        mockIsBranchContextAligned.mockReturnValue(false);
        mockUseQuery.mockReturnValue(success({ id: 7, name: "김하늘", phone: "01012345678" }));
        const { container } = render(<AgentContactCard data-component={DC} clientId={7} />);
        expect(container).toBeEmptyDOMElement();
        expect(lastOptions().enabled).toBe(false);
    });

    it("renders nothing without an id and keeps the query disabled", () => {
        const { container } = render(<AgentContactCard data-component={DC} />);
        expect(container).toBeEmptyDOMElement();
        expect(lastOptions().enabled).toBe(false);
    });

    it("shows a placeholder with no text while loading", () => {
        const { container } = render(<AgentContactCard data-component={DC} clientId={7} />);
        const placeholder = container.querySelector('[data-slot="skeleton"]');
        expect(placeholder).toBeInTheDocument();
        expect(container).toHaveTextContent("");
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows the unmasked contact as 이름 · 전화번호", () => {
        mockUseQuery.mockReturnValue(success({ id: 7, name: "김하늘", phone: "01012345678" }));
        const { container } = render(<AgentContactCard data-component={DC} clientId={7} />);
        expect(container).toHaveTextContent(/^김하늘 · 010-1234-5678$/);
        expect(container.querySelector('[data-slot="name"]')).toHaveTextContent("김하늘");
        expect(container.querySelector('[data-slot="phone"]')).toHaveTextContent("010-1234-5678");
        // the contact never leaks into attributes
        expect(container.innerHTML.replace(/>[^<]*</g, "><")).not.toMatch(/01012345678|010-1234-5678|김하늘/);
    });

    it("shows 연락처 미등록 for a record without a phone", () => {
        mockUseQuery.mockReturnValue(success({ id: 7, name: "김하늘", phone: null }));
        const { container } = render(<AgentContactCard data-component={DC} clientId={7} />);
        expect(container).toHaveTextContent(/^김하늘 · 연락처 미등록$/);
    });

    it("never shows a masked phone as a number", () => {
        mockUseQuery.mockReturnValue(success({ id: 7, name: "김하늘", phone: "••••5678" }));
        const { container } = render(<AgentContactCard data-component={DC} clientId={7} />);
        expect(container).not.toHaveTextContent("5678");
        expect(container).toHaveTextContent("연락처 미등록");
    });

    it.each([
        ["an empty string body", ""],
        ["null", null],
        ["an empty object", {}],
        ["a record with another id", { id: 8, name: "다른사람", phone: "01011112222" }],
        ["a record without an id", { name: "이름만", phone: "01011112222" }],
        ["an array", [{ id: 7 }]],
    ])("renders nothing for a successful response that is %s", (_label, data) => {
        mockUseQuery.mockReturnValue(success(data));
        const { container } = render(<AgentContactCard data-component={DC} clientId={7} />);
        expect(container).toBeEmptyDOMElement();
    });

    it.each([404, 403])("renders nothing for a %i response", (status) => {
        mockUseQuery.mockReturnValue(failedWithoutData(httpError(status)));
        const { container } = render(<AgentContactCard data-component={DC} clientId={7} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("shows a failure with retry, never 'no contact', for a 500 with no data", () => {
        mockUseQuery.mockReturnValue(failedWithoutData(httpError(500)));
        render(<AgentContactCard data-component={DC} clientId={7} />);
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent("연락처를 불러오지 못했습니다");
        expect(alert).toHaveAttribute("data-size", "inline");
        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("keeps the line and adds a stale notice with retry when a refetch fails", () => {
        mockUseQuery.mockReturnValue(failedRefetch({ id: 7, name: "김하늘", phone: "01012345678" }, httpError(500)));
        const { container } = render(<AgentContactCard data-component={DC} clientId={7} />);
        expect(container).toHaveTextContent("김하늘 · 010-1234-5678");
        expect(screen.getByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("drops cached data when the refetch says the record is gone (403/404)", () => {
        mockUseQuery.mockReturnValue(failedRefetch({ id: 7, name: "김하늘", phone: "01012345678" }, httpError(404)));
        const { container } = render(<AgentContactCard data-component={DC} clientId={7} />);
        expect(container).toBeEmptyDOMElement();
    });

    it("uses clientId when both ids are given", async () => {
        mockClientsGetById.mockResolvedValue({ data: { id: 7 } });
        render(<AgentContactCard data-component={DC} clientId={7} employeeId={9} />);
        const options = lastOptions();
        expect(options.queryKey).toEqual(expect.arrayContaining([7, "agent-contact", "branch-1"]));
        await options.queryFn();
        expect(mockClientsGetById).toHaveBeenCalledWith(7);
        expect(mockEmployeesGetById).not.toHaveBeenCalled();
    });

    it("looks an employee up through employeesApi", async () => {
        mockEmployeesGetById.mockResolvedValue({ data: { id: 9 } });
        mockUseQuery.mockReturnValue(success({ id: 9, name: "박도우미", phone: "01099998888" }));
        const { container } = render(<AgentContactCard data-component={DC} employeeId={9} />);
        const options = lastOptions();
        expect(options.enabled).toBe(true);
        await expect(options.queryFn()).resolves.toEqual({ id: 9 });
        expect(mockEmployeesGetById).toHaveBeenCalledWith(9);
        expect(mockClientsGetById).not.toHaveBeenCalled();
        expect(container).toHaveTextContent("박도우미 · 010-9999-8888");
    });

    it("keys the query by branch so a switch cannot show another branch's contact", () => {
        const { rerender } = render(<AgentContactCard data-component={DC} clientId={7} />);
        const firstKey = lastOptions().queryKey;
        expect(JSON.stringify(firstKey)).toContain("branch-1");

        mockUseActiveBranchId.mockReturnValue("branch-2");
        rerender(<AgentContactCard data-component={DC} clientId={7} />);
        const secondKey = lastOptions().queryKey;
        expect(JSON.stringify(secondKey)).toContain("branch-2");
        expect(JSON.stringify(secondKey)).not.toContain("branch-1");
        expect(secondKey).not.toEqual(firstKey);
    });

    it("does not call the API when the branch context drifted before the query ran", async () => {
        render(<AgentContactCard data-component={DC} clientId={7} />);
        mockIsBranchContextAligned.mockReturnValue(false);
        await expect(lastOptions().queryFn()).rejects.toThrow("Branch selection required");
        expect(mockClientsGetById).not.toHaveBeenCalled();
    });
});

// Real QueryClient + mocked API: react-query keeps earlier data when a refetch
// fails, so the card must decide from (usable record, error) and not from data alone.
// `retry: false` makes the failing refetch settle at once; the production retry
// policy (src/lib/queryClient.ts) is a separate concern with its own test.
describe("AgentContactCard cached lookup transitions", () => {
    function renderWithClient() {
        useRealQuery = true;
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
        const view = render(
            <QueryClientProvider client={queryClient}>
                <AgentContactCard data-component={DC} clientId={7} />
            </QueryClientProvider>,
        );
        return { ...view, queryClient };
    }

    const record = { id: 7, name: "김하늘", phone: "01012345678" };
    const rejectWith = (status: number) => mockClientsGetById.mockRejectedValue(httpError(status));

    async function firstLookupSettled() {
        await waitFor(() => expect(mockClientsGetById).toHaveBeenCalledTimes(1));
        await act(async () => { await Promise.resolve(); });
    }

    it.each([
        ["null", null],
        ["an empty string", ""],
        ["an empty object", {}],
        ["a record with another id", { id: 8, name: "다른사람", phone: "01011112222" }],
    ])("after a cached non-record (%s), a failed refetch (500) shows the failure with retry, and retry recovers", async (_label, cached) => {
        mockClientsGetById.mockResolvedValue({ data: cached });
        const { container, queryClient } = renderWithClient();
        await firstLookupSettled();
        expect(container).toBeEmptyDOMElement();

        rejectWith(500);
        await act(async () => { await queryClient.refetchQueries({ type: "active" }); });
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("연락처를 불러오지 못했습니다");
        expect(alert).toHaveAttribute("data-size", "inline");
        expect(mockClientsGetById).toHaveBeenCalledTimes(2);

        mockClientsGetById.mockResolvedValue({ data: record });
        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        await waitFor(() => expect(container).toHaveTextContent(/^김하늘 · 010-1234-5678$/));
        expect(mockClientsGetById).toHaveBeenCalledTimes(3);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it.each([404, 403])("after a cached non-record, a %i refetch still renders nothing and no alert", async (status) => {
        mockClientsGetById.mockResolvedValue({ data: null });
        const { container, queryClient } = renderWithClient();
        await firstLookupSettled();
        expect(container).toBeEmptyDOMElement();

        rejectWith(status);
        await act(async () => { await queryClient.refetchQueries({ type: "active" }); });
        expect(mockClientsGetById).toHaveBeenCalledTimes(2);
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("keeps the cached line with the stale notice when a refetch of a real record fails (500)", async () => {
        mockClientsGetById.mockResolvedValue({ data: record });
        const { container, queryClient } = renderWithClient();
        await waitFor(() => expect(container).toHaveTextContent("김하늘 · 010-1234-5678"));

        rejectWith(500);
        await act(async () => { await queryClient.refetchQueries({ type: "active" }); });
        expect(await screen.findByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
        expect(container).toHaveTextContent("김하늘 · 010-1234-5678");
    });
});
