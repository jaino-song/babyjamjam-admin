import type { ComponentProps, ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createProblemDetails } from "@babyjamjam/shared/errors/problem-details";

import { useCreateClient, useUpdateClient } from "@/hooks/useClients";
import { useOutOfPocketPriceInfos, useVoucherPriceInfos } from "@/hooks/useVoucherData";
import { useLocale } from "@/providers/LocaleProvider";
import { useClientDialogStore } from "@/stores/client-dialog-store";

import { ClientFormDialog } from "../ClientFormDialog";

// Rule 고객-04: a new client is always 예약 전; a save can no longer move a client between 예약 전 and
// 대기·진행·완료, so the form's status select offers only what the server accepts.

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

// Radix Select renders its items only while open and needs pointer APIs jsdom lacks. This stand-in
// keeps the parts the assertions read: the options on offer, the value, and whether it is disabled.
jest.mock("@/components/ui/select", () => {
    const React = jest.requireActual<typeof import("react")>("react");
    const DisabledContext = React.createContext(false);
    return {
        Select: ({ value, disabled = false, children }: { value?: string; disabled?: boolean; children: ReactNode }) => (
            <div data-mock-select="" data-value={value ?? ""}>
                <DisabledContext.Provider value={disabled}>{children}</DisabledContext.Provider>
            </div>
        ),
        SelectTrigger: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => {
            const disabled = React.useContext(DisabledContext);
            return <button type="button" disabled={disabled} {...props}>{children}</button>;
        },
        SelectValue: () => null,
        SelectContent: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
        SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
            <li role="option" aria-selected={false} data-value={value}>{children}</li>
        ),
    };
});

type DialogClient = NonNullable<ComponentProps<typeof ClientFormDialog>["client"]>;

const HELPER = "대기·진행·완료는 고객 상세의 [예약 확정]으로 바뀝니다.";
const REFUSAL = "이 상태로는 저장할 수 없습니다. 예약 상태는 [예약 확정]으로만 바꿀 수 있습니다.";

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
    bookingConfirmedAt: null,
    ...overrides,
} as unknown as DialogClient);

const statusWrapper = () => {
    const trigger = document.getElementById("serviceStatus");
    const wrapper = trigger?.closest("[data-mock-select]");
    if (!wrapper) throw new Error("status select not rendered");
    return wrapper as HTMLElement;
};
const optionValues = () =>
    within(statusWrapper()).getAllByRole("option", { hidden: true }).map((option) => option.getAttribute("data-value"));
const save = () => fireEvent.click(screen.getByRole("button", { name: "저장" }));

const renderEdit = async (client: DialogClient) => {
    await act(async () => {
        render(<ClientFormDialog open onClose={jest.fn()} client={client} />);
    });
};

describe("mobile ClientFormDialog 계약 상태 select (rule 고객-04)", () => {
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

    describe("creating", () => {
        it("renders the select disabled with 예약 전 as its only option, plus the helper line", async () => {
            await act(async () => {
                render(<ClientFormDialog open onClose={jest.fn()} />);
            });

            expect(document.getElementById("serviceStatus")).toBeDisabled();
            expect(optionValues()).toEqual(["pre_booking"]);
            expect(statusWrapper()).toHaveAttribute("data-value", "pre_booking");
            expect(screen.getByText(HELPER)).toBeInTheDocument();
        });

        it("creates the client as 예약 전", async () => {
            await act(async () => {
                render(<ClientFormDialog open onClose={jest.fn()} />);
            });
            const user = userEvent.setup();
            await user.type(screen.getByLabelText(/이름/), "김고객");
            await user.type(screen.getByLabelText(/생년월일/), "1990-01-01");
            await user.type(screen.getByLabelText(/출산 예정일/), "2026-10-10");
            await user.type(screen.getByLabelText(/연락처/), "01012345678");
            await user.type(screen.getByLabelText(/주소/), "인천");

            await user.click(screen.getByRole("button", { name: "생성" }));

            await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
            expect(createMutateAsync.mock.calls[0][0]).toEqual(expect.objectContaining({ serviceStatus: "pre_booking" }));
        });
    });

    describe("editing", () => {
        it("offers 예약 전 and 중단 for an unconfirmed client, with the helper line", async () => {
            await renderEdit(storedClient());

            expect(document.getElementById("serviceStatus")).toBeEnabled();
            expect(optionValues()).toEqual(["pre_booking", "terminated"]);
            expect(statusWrapper()).toHaveAttribute("data-value", "pre_booking");
            expect(screen.getByText(HELPER)).toBeInTheDocument();
        });

        it("keeps an unconfirmed client's other current status so the value still renders", async () => {
            await renderEdit(storedClient({ serviceStatus: "replacement_requested" }));

            expect(optionValues()).toEqual(["pre_booking", "replacement_requested", "terminated"]);
            expect(statusWrapper()).toHaveAttribute("data-value", "replacement_requested");
        });

        it("does not offer 예약 전 to a confirmed client, and drops the helper line", async () => {
            await renderEdit(storedClient({ bookingConfirmedAt: "2026-10-01T00:00:00.000Z", serviceStatus: "waiting" }));

            expect(optionValues()).not.toContain("pre_booking");
            expect(optionValues()).toEqual(["waiting", "replacement_requested", "active", "completed", "terminated"]);
            expect(statusWrapper()).toHaveAttribute("data-value", "waiting");
            expect(screen.queryByText(HELPER)).not.toBeInTheDocument();
        });

        it("still renders 예약 전 for a confirmed client whose effective status is 예약 전", async () => {
            await renderEdit(storedClient({ bookingConfirmedAt: "2026-10-01T00:00:00.000Z", serviceStatus: "pre_booking" }));

            expect(optionValues()).toContain("pre_booking");
        });
    });

    describe("a server refusal at /serviceStatus", () => {
        it("shows the authored sentence on the field and in the summary, not the server's text", async () => {
            updateMutateAsync.mockRejectedValue({
                response: {
                    status: 400,
                    data: createProblemDetails({
                        code: "VALIDATION_FAILED",
                        requestId: "request-bjj-438-status",
                        outcome: "NOT_APPLIED",
                        errors: [
                            { pointer: "/serviceStatus", code: "INVALID_VALUE", detail: "RAW SERVER STATUS TEXT", location: "body" },
                        ],
                    }),
                },
            });
            await renderEdit(storedClient());
            fireEvent.change(document.getElementById("address") as HTMLInputElement, { target: { value: "인천시 연수구" } });

            save();

            const alert = await screen.findByRole("alert");
            expect(alert).toHaveTextContent(`계약 상태: ${REFUSAL}`);
            expect(alert).not.toHaveTextContent("RAW SERVER STATUS TEXT");
            expect(document.getElementById("serviceStatus-message")).toHaveTextContent(REFUSAL);
            const trigger = document.getElementById("serviceStatus") as HTMLElement;
            expect(trigger).toHaveAttribute("aria-invalid", "true");
            expect(trigger.getAttribute("aria-describedby")).toContain("serviceStatus-message");
        });
    });
});
