import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useCreateClient, useUpdateClient } from "@/hooks/useClients";
import { useOutOfPocketPriceInfos, useVoucherPriceInfos } from "@/hooks/useVoucherData";
import { useLocale } from "@/providers/LocaleProvider";
import { useClientDialogStore } from "@/stores/client-dialog-store";

import { ClientFormDialog } from "../ClientFormDialog";

// Per-client weekend / holiday service days (토요일·일요일·공휴일), all off unless staff turn them on.

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

const updateMutateAsync = jest.fn();
const createMutateAsync = jest.fn();

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

const toggle = (id: string) => document.getElementById(id) as HTMLElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: "저장" }));

const renderDialog = async (client?: DialogClient) => {
    await act(async () => {
        render(<ClientFormDialog open onClose={jest.fn()} client={client} />);
    });
};

describe("mobile ClientFormDialog service days", () => {
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

    it("shows the 주말·공휴일 서비스 block with the helper line and three switches, all off by default", async () => {
        await renderDialog();

        expect(screen.getByText("주말·공휴일 서비스")).toBeInTheDocument();
        expect(screen.getByText("켠 날도 서비스일로 계산해 종료일과 제공기록지 회차에 포함해요.")).toBeInTheDocument();
        for (const id of ["allowSaturdayService", "allowSundayService", "allowHolidayService"]) {
            expect(toggle(id)).toHaveAttribute("aria-checked", "false");
        }
        expect(screen.getByLabelText("토요일")).toBe(toggle("allowSaturdayService"));
        expect(screen.getByLabelText("일요일")).toBe(toggle("allowSundayService"));
        expect(screen.getByLabelText("공휴일")).toBe(toggle("allowHolidayService"));
        expect(
            document.querySelector('[data-component="mobile_clients_form-dialog_content_field-service-days_saturday"]'),
        ).not.toBeNull();
    });

    it("creates the client with all three flags, defaulting to false", async () => {
        await renderDialog();
        const user = userEvent.setup();
        await user.type(screen.getByLabelText(/이름/), "김고객");
        await user.type(screen.getByLabelText(/생년월일/), "1990-01-01");
        await user.type(screen.getByLabelText(/출산 예정일/), "2026-10-10");
        await user.type(screen.getByLabelText(/연락처/), "01012345678");
        await user.type(screen.getByLabelText(/주소/), "인천");
        await user.click(toggle("allowSaturdayService"));
        await user.click(toggle("allowHolidayService"));

        await user.click(screen.getByRole("button", { name: "생성" }));

        await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
        expect(createMutateAsync.mock.calls[0][0]).toEqual(expect.objectContaining({
            allowSaturdayService: true,
            allowSundayService: false,
            allowHolidayService: true,
        }));
    });

    it("loads the saved values of a client into the switches", async () => {
        await renderDialog(storedClient({ allowSundayService: true, allowHolidayService: true }));

        expect(toggle("allowSaturdayService")).toHaveAttribute("aria-checked", "false");
        expect(toggle("allowSundayService")).toHaveAttribute("aria-checked", "true");
        expect(toggle("allowHolidayService")).toHaveAttribute("aria-checked", "true");
    });

    it("treats a client the backend did not send the flags for as all off, and sends nothing untouched", async () => {
        await renderDialog(storedClient());

        expect(toggle("allowSaturdayService")).toHaveAttribute("aria-checked", "false");
        save();

        await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
        expect(updateMutateAsync).toHaveBeenCalledWith({ id: 77, dto: {} });
    });

    it("sends only the flag that changed", async () => {
        await renderDialog(storedClient({ allowSundayService: true }));

        fireEvent.click(toggle("allowSaturdayService"));
        save();

        await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
        expect(updateMutateAsync).toHaveBeenCalledWith({ id: 77, dto: { allowSaturdayService: true } });
    });
});
