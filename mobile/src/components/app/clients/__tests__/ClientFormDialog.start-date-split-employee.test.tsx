import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { normalizeApiError } from "@babyjamjam/shared/errors/problem-details";
import { createProblemDetails } from "@babyjamjam/shared";

import { useCreateClient, useUpdateClient } from "@/hooks/useClients";
import { useOutOfPocketPriceInfos, useVoucherPriceInfos } from "@/hooks/useVoucherData";
import { useLocale } from "@/providers/LocaleProvider";
import { useClientDialogStore } from "@/stores/client-dialog-store";

import { ClientFormDialog } from "../ClientFormDialog";

jest.mock("@/hooks/useClients", () => ({ useCreateClient: jest.fn(), useUpdateClient: jest.fn() }));
jest.mock("@/hooks/useVoucherData", () => ({ useOutOfPocketPriceInfos: jest.fn(), useVoucherPriceInfos: jest.fn() }));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: jest.fn() }));
jest.mock("@/stores/client-dialog-store", () => ({ useClientDialogStore: jest.fn() }));
jest.mock("../EmployeeAutocomplete", () => ({
    EmployeeAutocomplete: ({ label, onChange }: { label: string; onChange: (id: number) => void }) => (
        <button onClick={() => onChange(42)}>{label}</button>
    ),
}));
jest.mock("../../employees/EmployeeFormDialog", () => ({ EmployeeFormDialog: () => null }));

const updateMutateAsync = jest.fn();
const clearPrefillName = jest.fn();
const startedTitle = "서비스 시작 후 변경";
const recordsTitle = "제공기록지 회차 처리";
const client = {
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
} as NonNullable<ComponentProps<typeof ClientFormDialog>["client"]>;

const lockedError = (startDateLock?: unknown, status = 409) => ({
    response: {
        status,
        data: {
            ...createProblemDetails({ code: "SERVICE_RECORD_START_DATE_LOCKED", requestId: "req-start-date-lock" }),
            status,
            ...(startDateLock !== undefined && { startDateLock }),
        },
    },
});
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const button = (name: string) => screen.getByRole("button", { name });

const renderDialog = async () => {
    const props = { open: true, client, onClose: jest.fn(), onSuccess: jest.fn() };
    const view = render(<ClientFormDialog {...props} />);
    await waitFor(() => expect(input("name")).toHaveValue(client.name));
    return { ...view, props };
};

const submitChangedDate = async () => {
    fireEvent.click(button("주 담당 인력"));
    fireEvent.change(input("startDate"), { target: { value: "2026-11-03" } });
    fireEvent.change(input("endDate"), { target: { value: "2026-11-16" } });
    fireEvent.click(button("저장"));
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
};

const partialMessage = "시작일 변경은 저장했지만 담당 인력 변경은 저장하지 못했어요. 창을 닫고 다시 열어 담당 인력을 바꿔 주세요.";
const retryFailure = {
    response: { status: 409, data: createProblemDetails({
        code: "SERVICE_RECORD_WRITE_TARGET_CHANGED", requestId: "req-retry-failure", status: 409,
    }) },
};

async function chooseMode(mode: "MOVE" | "RESTART" | "CONFIRM_STARTED") {
    if (mode === "CONFIRM_STARTED") return;
    const confirmation = await screen.findByRole("dialog", { name: recordsTitle });
    fireEvent.click(within(confirmation).getByRole("button", {
        name: mode === "MOVE" ? "모두 옮기기" : "처음부터 시작",
    }));
}

function expectNoConfirmation() {
    expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: recordsTitle })).not.toBeInTheDocument();
}

describe("ClientFormDialog split employee save after start-date confirmation", () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (useLocale as jest.Mock).mockReturnValue("ko");
        (useClientDialogStore as unknown as jest.Mock).mockImplementation(
            (selector: (state: { prefillName: string; clearPrefillName: jest.Mock }) => unknown) =>
                selector({ prefillName: "", clearPrefillName }),
        );
        (useOutOfPocketPriceInfos as jest.Mock).mockReturnValue({ data: [], isLoading: false, isError: false });
        (useVoucherPriceInfos as jest.Mock).mockReturnValue({ data: [], isLoading: false });
        (useCreateClient as jest.Mock).mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
        (useUpdateClient as jest.Mock).mockReturnValue({ mutateAsync: updateMutateAsync, isPending: false });
        updateMutateAsync.mockResolvedValue(client);
    });


    it.each(["MOVE", "RESTART", "CONFIRM_STARTED"] as const)(
        "%s saves employees separately and waits for their returned client", async (mode) => {
            let finishEmployee!: (value: typeof client) => void;
            updateMutateAsync
                .mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: mode === "CONFIRM_STARTED" ? 0 : 3 }))
                .mockResolvedValueOnce({ ...client, name: "시작일 저장 결과" })
                .mockImplementationOnce(() => new Promise((resolve) => { finishEmployee = resolve; }));
            const { props } = await renderDialog();
            const saveButton = button("저장");
            await submitChangedDate();
            await chooseMode(mode);
            await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(3));
            const { primaryEmployeeId, ...periodDto } = updateMutateAsync.mock.calls[0][0].dto;
            expect(primaryEmployeeId).toBe(42);
            expect(updateMutateAsync.mock.calls[1][0]).toEqual({
                id: client.id, dto: { ...periodDto, startDateChangeMode: mode },
            });
            expect(updateMutateAsync.mock.calls[1][0].dto).not.toHaveProperty("secondaryEmployeeId");
            expect(updateMutateAsync.mock.calls[2][0]).toEqual({ id: client.id, dto: { primaryEmployeeId: 42 } });
            expect(props.onSuccess).not.toHaveBeenCalled();
            expect(props.onClose).not.toHaveBeenCalled();
            fireEvent.click(saveButton);
            expect(updateMutateAsync).toHaveBeenCalledTimes(3);
            const employeeClient = { ...client, name: "담당 인력 저장 결과" };
            await act(async () => finishEmployee(employeeClient));
            expect(props.onSuccess).toHaveBeenCalledTimes(1);
            expect(props.onSuccess).toHaveBeenCalledWith(employeeClient);
            expect(props.onClose).toHaveBeenCalledTimes(1);
            expectNoConfirmation();
        },
    );

    it("keeps the form open and request ID when the employee save fails, without the period error handler", async () => {
        updateMutateAsync
            .mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 3 }))
            .mockResolvedValueOnce(client)
            .mockRejectedValueOnce(retryFailure);
        const { props } = await renderDialog();
        await submitChangedDate();
        await chooseMode("MOVE");
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent(partialMessage);
        expect(alert).toHaveTextContent("요청 ID: req-retry-failure");
        expect(props.onSuccess).not.toHaveBeenCalled();
        expect(props.onClose).not.toHaveBeenCalled();
        expectNoConfirmation();
        fireEvent.click(button("저장"));
        await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(4));
    });

    it("uses the existing error when the start-date save fails, without saving employees", async () => {
        updateMutateAsync
            .mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 3 }))
            .mockRejectedValueOnce(retryFailure);
        const { props } = await renderDialog();
        await submitChangedDate();
        await chooseMode("MOVE");
        expect(await screen.findByRole("alert")).toHaveTextContent("그동안 서비스 종료일이 바뀌어 저장하지 않았어요.");
        expect(screen.queryByText(partialMessage)).not.toBeInTheDocument();
        expect(updateMutateAsync).toHaveBeenCalledTimes(2);
        expect(props.onSuccess).not.toHaveBeenCalled();
        expect(props.onClose).not.toHaveBeenCalled();
        expectNoConfirmation();
    });

    it("preserves the unknown-outcome message and blocks further saves after an employee failure", async () => {
        const error = { response: { status: 500, data: createProblemDetails({
            code: "INTERNAL_ERROR", requestId: "req-unknown-employee", outcome: "UNKNOWN",
        }) } };
        updateMutateAsync
            .mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 3 }))
            .mockResolvedValueOnce(client)
            .mockRejectedValueOnce(error);
        const { props } = await renderDialog();
        await submitChangedDate();
        await chooseMode("MOVE");
        const normalized = normalizeApiError(error, { locale: "ko-KR", operation: "mutation" });
        expect(await screen.findByRole("alert")).toHaveTextContent(normalized.message);
        expect(screen.getByRole("alert")).toHaveTextContent("요청 ID: req-unknown-employee");
        expect(screen.queryByText(partialMessage)).not.toBeInTheDocument();
        fireEvent.click(button("저장"));
        expect(updateMutateAsync).toHaveBeenCalledTimes(3);
        expect(props.onSuccess).not.toHaveBeenCalled();
        expect(props.onClose).not.toHaveBeenCalled();
        expectNoConfirmation();
    });

    it.each(["start date", "employee"])("ignores a %s save that resolves after closing the form", async (stage) => {
        let finish!: (value: typeof client) => void;
        updateMutateAsync.mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 3 }));
        if (stage === "employee") updateMutateAsync.mockResolvedValueOnce(client);
        updateMutateAsync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const { props, rerender } = await renderDialog();
        await submitChangedDate();
        await chooseMode("MOVE");
        await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(stage === "employee" ? 3 : 2));
        rerender(<ClientFormDialog {...props} open={false} />);
        await act(async () => finish(client));
        expect(updateMutateAsync).toHaveBeenCalledTimes(stage === "employee" ? 3 : 2);
        expect(props.onSuccess).not.toHaveBeenCalled();
        expect(props.onClose).not.toHaveBeenCalled();
    });
});
