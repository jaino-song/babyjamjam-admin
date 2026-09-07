import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { employeeQueryKeys, type Employee } from "@/hooks/useEmployees";

import { ClientFormDialog } from "../ClientFormDialog";

const mockVoucherPriceInfos = [
    {
        id: 1,
        type: "A가1형",
        duration: "10",
        fullPrice: "1,464,000",
        grant: "1,002,000",
        actualPrice: "462,000",
    },
];

const mockOutOfPocketPriceInfos = [
    { id: 1, duration: 5, fullPrice: "815000" },
    { id: 2, duration: 10, fullPrice: "1620000" },
    { id: 3, duration: 15, fullPrice: "2425000" },
    { id: 4, duration: 20, fullPrice: "3240000" },
];

jest.mock("next/navigation", () => ({
    useRouter: () => ({ replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/hooks/useClients", () => ({
    useCreateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
    useUpdateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
    useAvailableClientAreas: () => ({ data: [], isLoading: false }),
    useAreaTemplates: () => ({ data: [], isLoading: false }),
    useVoucherPriceInfos: (type: string) => ({
        data: type ? mockVoucherPriceInfos : [],
        isLoading: false,
    }),
    useVoucherYears: () => ({ data: [2025, 2026], isLoading: false }),
    useOutOfPocketPriceInfos: () => ({
        data: mockOutOfPocketPriceInfos,
        isLoading: false,
        isError: false,
    }),
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

jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
    EmployeeFormDialog: () => null,
}));

jest.mock("@/lib/api/client", () => ({
    api: {
        get: jest.fn(),
    },
}));

const primary: Employee = {
    id: 17, name: "주담당 테스트", phone: "010-1111-2222", workArea: [],
    grade: "A", openToNextWork: true, registeredDate: null, status: "available",
};
const secondary: Employee = { ...primary, id: 23, name: "보조담당 테스트" };
const prefill = { primaryEmployeeId: primary.id, secondaryEmployeeId: secondary.id };

describe("ClientFormDialog employee cache refresh", () => {
    let queryClient: QueryClient;

    beforeEach(() => {
        jest.clearAllMocks();
        queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        queryClient.setQueryData(employeeQueryKeys.lists(), []);
        jest.mocked(api.get).mockResolvedValue({ data: [primary, secondary] });
    });

    afterEach(() => queryClient.clear());

    function form(open = true) {
        return (
            <QueryClientProvider client={queryClient}>
                <ClientFormDialog open={open} onClose={jest.fn()} prefill={prefill} />
            </QueryClientProvider>
        );
    }

    it("resolves both prefilled employees from a fresh-but-outdated cache without opening either dropdown", async () => {
        render(form());

        await waitFor(() => {
            expect(screen.getByRole("combobox", { name: "주 담당 인력" })).toHaveTextContent(primary.name);
            expect(screen.getByRole("combobox", { name: "보조 담당 인력" })).toHaveTextContent(secondary.name);
        });
        expect(screen.getByRole("combobox", { name: "주 담당 인력" })).toHaveAttribute("aria-expanded", "false");
        expect(api.get).toHaveBeenCalledWith("/employees");
    });

    it("refreshes again when the dialog reopens while the list cache is still fresh", async () => {
        const { rerender } = render(form());
        await waitFor(() => expect(screen.getByRole("combobox", { name: "주 담당 인력" })).toHaveTextContent(primary.name));
        rerender(form(false));
        jest.mocked(api.get).mockResolvedValue({ data: [{ ...primary, name: "갱신된 주담당" }, secondary] });
        rerender(form());
        await waitFor(() => expect(screen.getByRole("combobox", { name: "주 담당 인력" })).toHaveTextContent("갱신된 주담당"));
    });

    it("does not restore an employee cleared by the user while the refresh is pending", async () => {
        queryClient.setQueryData(employeeQueryKeys.lists(), [primary, secondary]);
        let resolveEmployees!: (result: { data: Employee[] }) => void;
        jest.mocked(api.get).mockImplementation(() => new Promise((resolve) => { resolveEmployees = resolve; }));
        render(form());
        await waitFor(() => expect(screen.getByRole("combobox", { name: "주 담당 인력" })).toHaveTextContent(primary.name));
        await waitFor(() => expect(api.get).toHaveBeenCalledWith("/employees"));
        fireEvent.click(screen.getAllByRole("button", { name: "제공인력 선택 해제" })[0]);
        await act(async () => { resolveEmployees({ data: [primary, secondary] }); });
        await waitFor(() => expect(screen.getByRole("combobox", { name: "주 담당 인력" })).toHaveTextContent("이름으로 검색..."));
    });
});
