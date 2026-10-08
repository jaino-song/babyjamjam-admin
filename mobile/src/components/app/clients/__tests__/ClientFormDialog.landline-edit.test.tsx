import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const LANDLINE = "032-442-5992";
const updateMutateAsync = jest.fn();
const createMutateAsync = jest.fn();

const storedClient = (phone: string): DialogClient => ({
    id: 5,
    name: "김유선",
    birthday: "1958-03-03",
    dueDate: "2026-10-10",
    address: "인천시 남동구",
    phone,
    primaryEmployee: null,
    secondaryEmployee: null,
    type: null,
    duration: null,
    fullPrice: null,
    grant: null,
    actualPrice: null,
    startDate: null,
    endDate: null,
    careCenter: false,
    voucherClient: false,
    breastPump: false,
    serviceStatus: "pre_booking",
} as unknown as DialogClient);

const phoneInput = () => screen.getByLabelText(/연락처/);
const slotOf = (element: HTMLElement) =>
    document.getElementById(element.getAttribute("aria-describedby")?.split(" ")[0] ?? "") as HTMLElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: "저장" }));

const renderDialog = async (client?: DialogClient) => {
    await act(async () => {
        render(<ClientFormDialog open onClose={jest.fn()} client={client} />);
    });
};

describe("ClientFormDialog - editing a client stored with a landline", () => {
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
        updateMutateAsync.mockResolvedValue({ id: 5 });
        createMutateAsync.mockResolvedValue({ id: 6 });
    });

    it("shows no error for the unchanged stored landline and saves it", async () => {
        await renderDialog(storedClient(LANDLINE));
        fireEvent.focus(phoneInput());
        fireEvent.blur(phoneInput());

        expect(phoneInput()).not.toHaveAttribute("aria-invalid", "true");
        expect(slotOf(phoneInput())).not.toHaveTextContent("010-1234-5678");

        save();
        await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
        // The stored landline is left as it is: nothing was edited, so no field is sent.
        expect(updateMutateAsync.mock.calls[0]?.[0]).toEqual({ id: 5, dto: {} });
    });

    it("applies the mobile-only rule once the phone is edited, and blocks saving", async () => {
        await renderDialog(storedClient(LANDLINE));

        fireEvent.change(phoneInput(), { target: { value: "0311234567" } });
        fireEvent.blur(phoneInput());
        expect(slotOf(phoneInput())).toHaveTextContent("010-1234-5678로 입력해 주세요");
        expect(phoneInput()).toHaveAttribute("aria-invalid", "true");

        save();
        expect(updateMutateAsync).not.toHaveBeenCalled();
    });

    it("still rejects a landline when creating a new client", async () => {
        await renderDialog();

        fireEvent.change(phoneInput(), { target: { value: LANDLINE } });
        fireEvent.blur(phoneInput());
        expect(slotOf(phoneInput())).toHaveTextContent("010-1234-5678로 입력해 주세요");
        expect(phoneInput()).toHaveAttribute("aria-invalid", "true");
    });
});
