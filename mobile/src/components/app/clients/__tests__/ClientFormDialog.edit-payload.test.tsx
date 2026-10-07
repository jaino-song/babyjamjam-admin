import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createProblemDetails } from "@babyjamjam/shared";

import { useCreateClient, useUpdateClient } from "@/hooks/useClients";
import { useOutOfPocketPriceInfos, useVoucherPriceInfos } from "@/hooks/useVoucherData";
import { useLocale } from "@/providers/LocaleProvider";
import { useClientDialogStore } from "@/stores/client-dialog-store";

import { ClientFormDialog } from "../ClientFormDialog";

jest.mock("@/hooks/useClients", () => ({
    useCreateClient: jest.fn(),
    useUpdateClient: jest.fn(),
}));

jest.mock("@/hooks/useVoucherData", () => ({
    useOutOfPocketPriceInfos: jest.fn(),
    useVoucherPriceInfos: jest.fn(),
}));

jest.mock("@/providers/LocaleProvider", () => ({
    useLocale: jest.fn(),
}));

jest.mock("@/stores/client-dialog-store", () => ({
    useClientDialogStore: jest.fn(),
}));

jest.mock("../EmployeeAutocomplete", () => ({
    EmployeeAutocomplete: () => null,
}));

jest.mock("../../employees/EmployeeFormDialog", () => ({
    EmployeeFormDialog: () => null,
}));

type DialogClient = NonNullable<ComponentProps<typeof ClientFormDialog>["client"]>;

const END_DATE_CHANGED_MESSAGE =
    "그동안 서비스 종료일이 바뀌어 저장하지 않았어요. 창을 닫고 다시 열어 최신 정보로 수정해 주세요.";

const updateMutateAsync = jest.fn();
const createMutateAsync = jest.fn();

// 2026-11-02 (Mon) .. 2026-11-13 (Fri) is 10 business days.
const storedClient = (overrides: Partial<DialogClient> = {}): DialogClient => ({
    id: 77,
    name: "홍길동",
    birthday: "1990-01-01",
    dueDate: "2026-10-20",
    address: "인천시 남동구",
    phone: "010-1234-5678",
    primaryEmployee: null,
    secondaryEmployee: null,
    type: null,
    duration: 10,
    fullPrice: "900000",
    grant: "0",
    actualPrice: "900000",
    startDate: "2026-11-02",
    endDate: "2026-11-13",
    careCenter: false,
    voucherClient: false,
    breastPump: false,
    serviceStatus: "pre_booking",
    ...overrides,
} as unknown as DialogClient);

const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: "저장" }));

const renderDialog = async (client: DialogClient) => {
    await act(async () => {
        render(<ClientFormDialog open onClose={jest.fn()} client={client} />);
    });
};

const calledDto = () => updateMutateAsync.mock.calls[0]?.[0]?.dto;

describe("mobile ClientFormDialog edit saves do not write back a stale snapshot", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (useLocale as jest.Mock).mockReturnValue("ko");
        (useClientDialogStore as unknown as jest.Mock).mockImplementation(
            (selector: (state: { prefillName: string; clearPrefillName: jest.Mock }) => unknown) =>
                selector({ prefillName: "", clearPrefillName: jest.fn() }),
        );
        (useOutOfPocketPriceInfos as jest.Mock).mockReturnValue({ data: [], isLoading: false, isError: false });
        (useVoucherPriceInfos as jest.Mock).mockReturnValue({ data: [], isLoading: false });
        (useCreateClient as jest.Mock).mockReturnValue({ mutateAsync: createMutateAsync, isPending: false });
        (useUpdateClient as jest.Mock).mockReturnValue({ mutateAsync: updateMutateAsync, isPending: false });
        updateMutateAsync.mockResolvedValue({ id: 77 });
        createMutateAsync.mockResolvedValue({ id: 78 });
    });

    it("sends an empty update when nothing changed", async () => {
        await renderDialog(storedClient());

        save();

        await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
        expect(updateMutateAsync).toHaveBeenCalledWith({ id: 77, dto: {} });
    });

    it("sends only the address for an address-only edit, with no period fields", async () => {
        await renderDialog(storedClient());

        fireEvent.change(input("address"), { target: { value: "인천시 연수구" } });
        save();

        await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
        expect(updateMutateAsync).toHaveBeenCalledWith({ id: 77, dto: { address: "인천시 연수구" } });
    });

    it("sends the whole period and the opening end date when the start date changes", async () => {
        await renderDialog(storedClient());

        fireEvent.change(input("startDate"), { target: { value: "2026-11-03" } });
        fireEvent.change(input("endDate"), { target: { value: "2026-11-16" } });
        save();

        await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
        expect(updateMutateAsync).toHaveBeenCalledWith({
            id: 77,
            dto: {
                startDate: "2026-11-03",
                endDate: "2026-11-16",
                duration: 10,
                expectedEndDate: "2026-11-13",
            },
        });
    });

    it("tells staff to reopen the form when the backend reports the end date moved", async () => {
        updateMutateAsync.mockRejectedValue({
            response: {
                status: 409,
                data: createProblemDetails({
                    code: "SERVICE_RECORD_WRITE_TARGET_CHANGED",
                    requestId: "req-end-date-moved",
                    status: 409,
                }),
            },
        });
        await renderDialog(storedClient());

        fireEvent.change(input("endDate"), { target: { value: "2026-11-16" } });
        save();

        expect(await screen.findByText(END_DATE_CHANGED_MESSAGE)).toBeInTheDocument();
        // The edit stays in the form; nothing was applied and the form is not closed under the user.
        expect(input("endDate")).toHaveValue("2026-11-16");
    });

    it("does not claim the end date moved when the rejected save carried no end-date guard", async () => {
        updateMutateAsync.mockRejectedValue({
            response: {
                status: 409,
                data: createProblemDetails({
                    code: "SERVICE_RECORD_WRITE_TARGET_CHANGED",
                    requestId: "req-other-conflict",
                    status: 409,
                }),
            },
        });
        await renderDialog(storedClient());

        fireEvent.change(input("address"), { target: { value: "인천시 연수구" } });
        save();

        await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
        expect(screen.queryByText(END_DATE_CHANGED_MESSAGE)).not.toBeInTheDocument();
    });

    describe("prices", () => {
        const PRICE_TABLE = [{ id: 1, duration: 10, fullPrice: "1,000,000" }];

        // A client with no stored prices: opening the form fills them from the price table.
        const unpricedClient = () => storedClient({ fullPrice: null, grant: null, actualPrice: null });

        beforeEach(() => {
            (useOutOfPocketPriceInfos as jest.Mock).mockReturnValue({
                data: PRICE_TABLE,
                isLoading: false,
                isError: false,
            });
        });

        it("does not send the prices the form filled in from the price table on open", async () => {
            await renderDialog(unpricedClient());
            await waitFor(() => expect(input("fullPrice")).toHaveValue("1,000,000"));

            fireEvent.change(input("address"), { target: { value: "인천시 연수구" } });
            save();

            await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
            expect(calledDto()).toEqual({ address: "인천시 연수구" });
        });

        it("sends the prices once staff re-price the client", async () => {
            await renderDialog(unpricedClient());
            await waitFor(() => expect(input("fullPrice")).toHaveValue("1,000,000"));

            fireEvent.change(input("fullPrice"), { target: { value: "1,200,000" } });
            save();

            await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
            expect(calledDto()).toEqual({
                fullPrice: "1200000",
                actualPrice: "1200000",
            });
        });

        it("sends a price the table fills in after staff touched a price driver", async () => {
            // The table is not loaded yet when staff change the end date, so the later fill is a re-pricing.
            (useOutOfPocketPriceInfos as jest.Mock).mockReturnValue({ data: [], isLoading: false, isError: false });
            let view!: ReturnType<typeof render>;
            await act(async () => {
                view = render(<ClientFormDialog open onClose={jest.fn()} client={unpricedClient()} />);
            });
            fireEvent.change(input("endDate"), { target: { value: "2026-11-16" } });

            (useOutOfPocketPriceInfos as jest.Mock).mockReturnValue({
                data: PRICE_TABLE,
                isLoading: false,
                isError: false,
            });
            await act(async () => {
                view.rerender(<ClientFormDialog open onClose={jest.fn()} client={unpricedClient()} />);
            });
            await waitFor(() => expect(input("fullPrice")).toHaveValue("1,000,000"));

            save();

            await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
            expect(calledDto()).toEqual(expect.objectContaining({ fullPrice: "1000000", actualPrice: "1000000" }));
        });

        it("sends a stored client's changed price without touching the period", async () => {
            await renderDialog(storedClient());

            fireEvent.change(input("fullPrice"), { target: { value: "950,000" } });
            save();

            await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
            expect(calledDto()).toEqual({ fullPrice: "950000", actualPrice: "950000" });
        });
    });
});
