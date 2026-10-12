import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { clientsApi } from "@/features/clients/api/clients.api";
import { employeesApi } from "@/features/employees/api/employees.api";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { AgentContactCard } from "./AgentContactCard";

jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: jest.fn() }));
jest.mock("@/features/clients/api/clients.api", () => ({ clientsApi: { getById: jest.fn() } }));
jest.mock("@/features/employees/api/employees.api", () => ({ employeesApi: { getById: jest.fn() } }));

const mockClient = clientsApi.getById as jest.Mock;
const mockEmployee = employeesApi.getById as jest.Mock;
const mockAuth = useGetAuthUser as jest.Mock;
const contact = { id: 12, name: "김하늘", phone: "01012345678" };
const base = "mobile_chat_tests_contact";
let queryClient: QueryClient;

function mount(props: { clientId?: number; employeeId?: number } = { clientId: 12 }) {
    return render(<QueryClientProvider client={queryClient}><AgentContactCard data-component={base} {...props} /></QueryClientProvider>);
}

beforeEach(() => {
    jest.clearAllMocks();
    onlineManager.setOnline(true);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
    mockAuth.mockReturnValue({ data: { branchId: "branch-a" } });
    mockClient.mockResolvedValue({ data: contact });
    mockEmployee.mockResolvedValue({ data: contact });
});
afterEach(() => { queryClient.clear(); onlineManager.setOnline(true); });

it("renders nothing and does not fetch without branch context", () => {
    mockAuth.mockReturnValue({ data: null });
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    expect(mockClient).not.toHaveBeenCalled();
});

it.each([false, true])("shows only a placeholder while pending (paused=%s)", (paused) => {
    if (paused) onlineManager.setOnline(false);
    mockClient.mockReturnValue(new Promise(() => {}));
    const { container } = mount();
    expect(container.querySelector('[data-slot="contact-loading"]')).toBeInTheDocument();
    expect(container.textContent).toBe("");
});

it("formats the contact, with semantic slots and no PII in attributes", async () => {
    const { container } = mount();
    expect(await screen.findByText("김하늘")).toBeInTheDocument();
    expect(container.querySelector('[data-slot="contact-line"]')).toHaveTextContent("김하늘 · 010-1234-5678");
    expect(container.querySelector('[data-slot="name"]')).toHaveTextContent("김하늘");
    expect(container.querySelector('[data-slot="phone"]')).toHaveTextContent("010-1234-5678");
    for (const element of container.querySelectorAll("*")) {
        for (const attribute of element.attributes) {
            expect(attribute.value).not.toMatch(/김하늘|010/);
        }
    }
});

it("shows 연락처 미등록 for a record without phone", async () => {
    mockClient.mockResolvedValue({ data: { ...contact, phone: null } });
    mount();
    expect(await screen.findByText("연락처 미등록")).toBeInTheDocument();
});

it.each(["", null, {}, { ...contact, id: 13 }])("hides a successful not-found response %j", async (data) => {
    mockClient.mockResolvedValue({ data });
    const { container } = mount();
    await waitFor(() => expect(queryClient.getQueryCache().getAll()[0].state.status).toBe("success"));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
});

it.each([403, 404])("hides denied/missing HTTP %s", async (status) => {
    mockClient.mockRejectedValue({ response: { status } });
    const { container } = mount();
    await waitFor(() => expect(queryClient.getQueryCache().getAll()[0].state.status).toBe("error"));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
});

it("shows a 500 as an inline failure and retry refetches", async () => {
    mockClient.mockRejectedValueOnce({ response: { status: 500 } });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("연락처를 불러오지 못했습니다");
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "inline");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("김하늘")).toBeInTheDocument();
    expect(mockClient).toHaveBeenCalledTimes(2);
});

it("retains cached data after failed refetch and retries", async () => {
    mount();
    await screen.findByText("김하늘");
    mockClient.mockRejectedValueOnce({ response: { status: 500 } });
    await queryClient.refetchQueries();
    expect(await screen.findByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(screen.getByText("김하늘")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(mockClient).toHaveBeenCalledTimes(3);
});

it("clientId wins over employeeId", async () => {
    mount({ clientId: 12, employeeId: 45 });
    await screen.findByText("김하늘");
    expect(mockClient).toHaveBeenCalledWith(12);
    expect(mockEmployee).not.toHaveBeenCalled();
});

it("uses the employee lookup when only employeeId exists", async () => {
    mount({ employeeId: 12 });
    await screen.findByText("김하늘");
    expect(mockEmployee).toHaveBeenCalledWith(12);
    expect(mockClient).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().getAll()[0].queryKey).toEqual(["employees", "detail", 12, "agent-contact", "branch-a"]);
});

it("isolates branch keys and never displays the previous branch's cached contact", async () => {
    queryClient.setQueryData(["clients", "detail", 12], { ...contact, name: "shared-cache" });
    const { rerender } = mount();
    await screen.findByText("김하늘");
    mockAuth.mockReturnValue({ data: { branchId: "branch-b" } });
    mockClient.mockReturnValue(new Promise(() => {}));
    rerender(<QueryClientProvider client={queryClient}><AgentContactCard data-component={base} clientId={12} /></QueryClientProvider>);
    expect(screen.queryByText("김하늘")).not.toBeInTheDocument();
    expect(screen.queryByText("shared-cache")).not.toBeInTheDocument();
    expect(queryClient.getQueryCache().find({ queryKey: ["clients", "detail", 12, "agent-contact", "branch-a"] })).toBeDefined();
    expect(queryClient.getQueryCache().find({ queryKey: ["clients", "detail", 12, "agent-contact", "branch-b"] })).toBeDefined();
});
