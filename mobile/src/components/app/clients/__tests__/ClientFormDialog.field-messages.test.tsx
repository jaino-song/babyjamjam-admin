import { act, fireEvent, render, screen } from "@testing-library/react";

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

const mutateAsync = jest.fn();

const input = (label: RegExp | string) => screen.getByLabelText(label);
const slotOf = (element: HTMLElement) =>
    document.getElementById(element.getAttribute("aria-describedby")?.split(" ")[0] ?? "") as HTMLElement;

describe("ClientFormDialog field messages", () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        (useLocale as jest.Mock).mockReturnValue("ko");
        (useClientDialogStore as unknown as jest.Mock).mockImplementation(
            (selector: (state: { prefillName: string; clearPrefillName: jest.Mock }) => unknown) =>
                selector({ prefillName: "", clearPrefillName: jest.fn() }),
        );
        (useOutOfPocketPriceInfos as jest.Mock).mockReturnValue({ data: [], isLoading: false, isError: false });
        (useVoucherPriceInfos as jest.Mock).mockReturnValue({ data: [], isLoading: false });
        (useCreateClient as jest.Mock).mockReturnValue({ mutateAsync, isPending: false });
        (useUpdateClient as jest.Mock).mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
        await act(async () => {
            render(<ClientFormDialog open onClose={jest.fn()} />);
        });
    });

    it("shows nothing on first load and drops the old helper line and format suffixes", () => {
        ["name", "birthday", "dueDate", "phone", "address", "startDate", "endDate"].forEach((id) => {
            const field = document.getElementById(id) as HTMLElement;
            expect(slotOf(field)).toBeEmptyDOMElement();
            expect(field).not.toHaveAttribute("aria-invalid", "true");
        });
        expect(screen.queryByText(/예: 1958-03-03/)).not.toBeInTheDocument();
    });

    it("uses typed YYYY-MM-DD text inputs with example placeholders for every date", () => {
        const expected: Record<string, string> = {
            birthday: "1958-03-03",
            dueDate: "2026-11-20",
            startDate: "2026-12-01",
            endDate: "2026-12-19",
        };
        Object.entries(expected).forEach(([id, placeholder]) => {
            const field = document.getElementById(id) as HTMLInputElement;
            expect(field).not.toHaveAttribute("type", "date");
            expect(field).toHaveAttribute("inputmode", "numeric");
            expect(field).toHaveAttribute("maxlength", "10");
            expect(field).toHaveAttribute("placeholder", placeholder);
        });
    });

    it("types dates as digits with auto-inserted hyphens", () => {
        fireEvent.change(input(/생년월일/), { target: { value: "19580303" } });
        expect(input(/생년월일/)).toHaveValue("1958-03-03");
        fireEvent.change(input(/출산 예정일/), { target: { value: "20261120" } });
        expect(input(/출산 예정일/)).toHaveValue("2026-11-20");
    });

    it("reports a cleared required field, not an untouched one", () => {
        fireEvent.change(input(/주소/), { target: { value: "인천" } });
        expect(slotOf(input(/주소/))).toBeEmptyDOMElement();
        fireEvent.change(input(/주소/), { target: { value: "" } });
        expect(slotOf(input(/주소/))).toHaveTextContent("주소를 입력해 주세요");
    });

    it("hints then errors for a partial phone number", () => {
        const phone = input(/연락처/);
        fireEvent.focus(phone);
        fireEvent.change(phone, { target: { value: "0101" } });
        expect(slotOf(phone)).toHaveTextContent("010-1234-5678 형식");
        fireEvent.blur(phone);
        expect(slotOf(phone)).toHaveTextContent("010-1234-5678 형식으로 입력해 주세요");
        expect(phone).toHaveAttribute("aria-invalid", "true");
    });

    it("requires the end date not to precede the start date", () => {
        fireEvent.change(input(/시작일/), { target: { value: "20261201" } });
        fireEvent.change(input(/종료일/), { target: { value: "20261115" } });
        expect(slotOf(input(/종료일/))).toHaveTextContent("종료일은 시작일 이후여야 해요");
        fireEvent.change(input(/종료일/), { target: { value: "20261219" } });
        expect(slotOf(input(/종료일/))).toBeEmptyDOMElement();
    });

    it("on save shows every required message, focuses the first problem and does not submit", () => {
        fireEvent.click(screen.getByRole("button", { name: "생성" }));

        expect(slotOf(input(/이름/))).toHaveTextContent("이름을 입력해 주세요");
        expect(slotOf(input(/생년월일/))).toHaveTextContent("생년월일을 입력해 주세요");
        expect(slotOf(input(/출산 예정일/))).toHaveTextContent("출산 예정일을 입력해 주세요");
        expect(slotOf(input(/연락처/))).toHaveTextContent("연락처를 입력해 주세요");
        expect(slotOf(input(/주소/))).toHaveTextContent("주소를 입력해 주세요");
        expect(input(/이름/)).toHaveFocus();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(mutateAsync).not.toHaveBeenCalled();
    });
});
