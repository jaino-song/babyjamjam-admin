import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createProblemDetails } from "@babyjamjam/shared/errors/problem-details";

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

const mockUseCreateClient = useCreateClient as jest.MockedFunction<typeof useCreateClient>;
const mockUseUpdateClient = useUpdateClient as jest.MockedFunction<typeof useUpdateClient>;
const mockUseOutOfPocketPriceInfos = useOutOfPocketPriceInfos as jest.MockedFunction<typeof useOutOfPocketPriceInfos>;
const mockUseVoucherPriceInfos = useVoucherPriceInfos as jest.MockedFunction<typeof useVoucherPriceInfos>;
const mockUseLocale = useLocale as jest.MockedFunction<typeof useLocale>;
const mockUseClientDialogStore = useClientDialogStore as unknown as jest.Mock;

const clearPrefillName = jest.fn();

const validClient = {
    id: 1,
    name: "김고객",
    birthday: "900101",
    dueDate: "2026-10-10",
    address: "인천",
    phone: "010-1234-5678",
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
};

const renderDialog = (onClose = jest.fn(), onSuccess = jest.fn()) => {
    render(<ClientFormDialog open onClose={onClose} onSuccess={onSuccess} />);
    return { onClose, onSuccess };
};

const fillRequiredFields = async () => {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/이름/), "김고객");
    await user.type(screen.getByLabelText(/생년월일/), "900101");
    await user.type(screen.getByLabelText(/출산 예정일/), "2026-10-10");
    await user.type(screen.getByLabelText(/연락처/), "01012345678");
    await user.type(screen.getByLabelText(/주소/), "인천");
};

const submitButton = () => screen.getByRole("button", { name: "생성" });

const validationProblem = {
    ...createProblemDetails({
        code: "VALIDATION_FAILED",
        requestId: "request-bjj-319-fields",
    }),
    errors: [
        { pointer: "/name", code: "REQUIRED" as const, detail: "raw name value", location: "body" as const },
        { pointer: "/phone", code: "INVALID_FORMAT" as const, detail: "raw phone value", location: "body" as const },
        { pointer: "/address", code: "OUT_OF_RANGE" as const, detail: "raw address value", location: "body" as const },
    ],
};

const unknownProblem = createProblemDetails({
    code: "INTERNAL_ERROR",
    requestId: "request-bjj-319-unknown",
    outcome: "UNKNOWN",
});

describe("ClientFormDialog mutation error presentation", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUseLocale.mockReturnValue("ko");
        mockUseClientDialogStore.mockImplementation((selector: (state: { prefillName: string; clearPrefillName: jest.Mock }) => unknown) =>
            selector({ prefillName: "", clearPrefillName }),
        );
        mockUseOutOfPocketPriceInfos.mockReturnValue({
            data: [],
            isLoading: false,
            isError: false,
        } as unknown as ReturnType<typeof useOutOfPocketPriceInfos>);
        mockUseVoucherPriceInfos.mockReturnValue({
            data: [],
            isLoading: false,
        } as unknown as ReturnType<typeof useVoucherPriceInfos>);
        mockUseUpdateClient.mockReturnValue({
            mutateAsync: jest.fn(),
            isPending: false,
        } as unknown as ReturnType<typeof useUpdateClient>);
    });

    it("keeps every structured body error visible, links known fields, and focuses the summary", async () => {
        const mutateAsync = jest.fn().mockRejectedValue({
            response: { status: validationProblem.status, data: validationProblem },
        });
        mockUseCreateClient.mockReturnValue({
            mutateAsync,
            isPending: false,
        } as unknown as ReturnType<typeof useCreateClient>);
        renderDialog();
        await fillRequiredFields();

        await userEvent.setup().click(submitButton());

        const alert = await screen.findByRole("alert");
        await waitFor(() => expect(alert).toHaveFocus());
        expect(alert).toHaveTextContent("입력 내용을 확인해 주세요.");
        expect(alert).toHaveTextContent("이름: 필수 항목이에요.");
        expect(alert).toHaveTextContent("연락처: 입력 형식이 올바르지 않아요.");
        expect(alert).toHaveTextContent("/address: 허용 범위를 벗어난 값이에요.");
        expect(alert).toHaveTextContent("요청 ID: request-bjj-319-fields");
        expect(alert).not.toHaveTextContent("raw name value");
        expect(alert).not.toHaveTextContent("raw phone value");

        expect(screen.getByRole("link", { name: "이름: 필수 항목이에요." })).toHaveAttribute("href", "#name");
        expect(screen.getByRole("link", { name: "연락처: 입력 형식이 올바르지 않아요." })).toHaveAttribute("href", "#phone");
        expect(screen.getByLabelText(/이름/)).toHaveAttribute("aria-invalid", "true");
        expect(screen.getByLabelText(/연락처/)).toHaveAttribute("aria-invalid", "true");
        expect(screen.getByLabelText(/이름/)).toHaveAttribute("aria-describedby");
        expect(screen.getByLabelText(/연락처/)).toHaveAttribute("aria-describedby");
        expect(screen.getByLabelText(/이름/)).toHaveValue("김고객");
        expect(screen.getByLabelText(/연락처/)).toHaveValue("010-1234-5678");

        fireEvent.click(screen.getByRole("link", { name: "이름: 필수 항목이에요." }));
        expect(screen.getByLabelText(/이름/)).toHaveFocus();
    });

    it("keeps an unknown mutation outcome persistent and blocks the second submit", async () => {
        const mutateAsync = jest.fn().mockRejectedValue({
            response: { status: unknownProblem.status, data: unknownProblem },
        });
        mockUseCreateClient.mockReturnValue({
            mutateAsync,
            isPending: false,
        } as unknown as ReturnType<typeof useCreateClient>);
        renderDialog();
        await fillRequiredFields();

        await userEvent.setup().click(submitButton());
        await screen.findByText("요청을 처리하는 중 예상하지 못한 문제가 발생했어요.");

        expect(screen.getByText("다시 실행하기 전에 작업 상태를 확인해 주세요.")).toBeInTheDocument();
        expect(screen.getByText("요청 ID: request-bjj-319-unknown")).toBeInTheDocument();
        expect(submitButton()).toBeDisabled();
        fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "수정한 이름" } });
        fireEvent.click(submitButton());
        expect(mutateAsync).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText(/이름/)).toHaveValue("수정한 이름");
    });

    it("keeps legacy validation responses compatible and leaves the successful path unchanged", async () => {
        const mutateAsync = jest.fn()
            .mockRejectedValueOnce({
                response: {
                    status: 400,
                    data: { message: ["name must be a string"], error: "Bad Request" },
                },
            })
            .mockResolvedValueOnce(validClient);
        mockUseCreateClient.mockReturnValue({
            mutateAsync,
            isPending: false,
        } as unknown as ReturnType<typeof useCreateClient>);
        const { onClose, onSuccess } = renderDialog();

        await fillRequiredFields();
        await userEvent.setup().click(submitButton());
        expect(await screen.findByText("이름 항목은 문자로 입력해 주세요.")).toBeInTheDocument();
        expect(submitButton()).not.toBeDisabled();

        await userEvent.setup().click(submitButton());
        await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
        expect(onSuccess).toHaveBeenCalledWith(validClient);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
    it.each([
        { response: { status: 502, data: "<html>gateway failure</html>" } },
        { response: { status: 400, data: { type: "invalid", requestId: "bad-response" } } },
        new Error("local callback failed after sending"),
    ])("blocks unknown results even when the error contract is invalid", async (cause) => {
        const mutateAsync = jest.fn().mockRejectedValue(cause);
        mockUseCreateClient.mockReturnValue({ mutateAsync, isPending: false } as unknown as ReturnType<typeof useCreateClient>);
        renderDialog();
        await fillRequiredFields();
        fireEvent.click(submitButton());
        await waitFor(() => expect(submitButton()).toBeDisabled());
        expect(await screen.findByRole("alert")).toHaveTextContent("변경 결과를 확인할 수 없으니");
        fireEvent.click(submitButton());
        expect(mutateAsync).toHaveBeenCalledTimes(1);
    });

    it("preserves a failed edit when the same customer is refreshed", async () => {
        const mutateAsync = jest.fn().mockRejectedValue({ response: { status: 500, data: unknownProblem } });
        mockUseUpdateClient.mockReturnValue({ mutateAsync, isPending: false } as unknown as ReturnType<typeof useUpdateClient>);
        const props = { open: true, onClose: jest.fn(), client: validClient as ComponentProps<typeof ClientFormDialog>["client"] };
        const view = render(<ClientFormDialog {...props} />);
        await waitFor(() => expect(screen.getByLabelText(/이름/)).toHaveValue("김고객"));
        fireEvent.click(screen.getByRole("button", { name: "저장" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "저장" })).toBeDisabled());
        fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "보존할 수정값" } });
        view.rerender(<ClientFormDialog {...props} client={{ ...props.client! }} />);
        await waitFor(() => expect(screen.getByLabelText(/이름/)).toHaveValue("보존할 수정값"));
        expect(screen.getByRole("alert")).toHaveTextContent("요청 ID: request-bjj-319-unknown");
        expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    });

});
