import type { ComponentProps } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
jest.mock("../EmployeeAutocomplete", () => ({ EmployeeAutocomplete: () => null }));
jest.mock("../../employees/EmployeeFormDialog", () => ({ EmployeeFormDialog: () => null }));

const updateMutateAsync = jest.fn();
const clearPrefillName = jest.fn();
const base = "mobile_clients_form-dialog";
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
const modal = (title: string) => screen.getByRole("dialog", { name: title });

const renderDialog = async () => {
    const props = { open: true, client, onClose: jest.fn(), onSuccess: jest.fn() };
    const view = render(<ClientFormDialog {...props} />);
    await waitFor(() => expect(input("name")).toHaveValue(client.name));
    return { ...view, props };
};

const submitChangedDate = async () => {
    fireEvent.change(input("startDate"), { target: { value: "2026-11-03" } });
    fireEvent.change(input("endDate"), { target: { value: "2026-11-16" } });
    fireEvent.click(button("저장"));
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
};

const expectKeptForm = (props: Awaited<ReturnType<typeof renderDialog>>["props"]) => {
    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input("startDate")).toHaveValue("2026-11-03");
    expect(screen.getByTestId("client-form-dialog")).toBeInTheDocument();
};

describe("ClientFormDialog start-date confirmation", () => {
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

    it("confirms a started service with the exact rejected dto, then follows the normal success path", async () => {
        updateMutateAsync.mockRejectedValueOnce(lockedError({ serviceStarted: true, recordedSessionCount: 0 }));
        const { props } = await renderDialog();
        await submitChangedDate();
        const confirmation = await screen.findByRole("dialog", { name: startedTitle });
        expect(confirmation).toHaveAttribute("data-component", `${base}_start-date-started-confirmation`);
        expect(confirmation).toHaveTextContent("서비스가 이미 시작되었어요. 그래도 변경할까요?");
        expect(within(confirmation).getAllByRole("button").map((item) => item.textContent)).toEqual(["취소", "진행"]);
        expectKeptForm(props);
        const firstRequest = updateMutateAsync.mock.calls[0][0];
        expect(firstRequest.dto).not.toHaveProperty("startDateChangeMode");
        // A later form change must never rebuild the rejected request during confirmation.
        fireEvent.change(input("address"), { target: { value: "다른 주소" } });
        await userEvent.setup().click(button("진행"));
        await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
        expect(updateMutateAsync).toHaveBeenCalledTimes(2);
        expect(updateMutateAsync.mock.calls[1][0]).toEqual({
            id: client.id, dto: { ...firstRequest.dto, startDateChangeMode: "CONFIRM_STARTED" },
        });
        expect(firstRequest.dto).not.toHaveProperty("startDateChangeMode");
        expect(props.onSuccess).toHaveBeenCalledTimes(1);
        expect(props.onSuccess).toHaveBeenCalledWith(client);
        expect(props.onSuccess.mock.invocationCallOrder[0]).toBeLessThan(props.onClose.mock.invocationCallOrder[0]);
    });

    it.each([["처음부터 시작", "RESTART"], ["모두 옮기기", "MOVE"]])(
        "moves from started confirmation to records and sends %s exactly once",
        async (label, mode) => {
            updateMutateAsync.mockRejectedValueOnce(lockedError({ serviceStarted: true, recordedSessionCount: 3 }));
            const { props } = await renderDialog();
            await submitChangedDate();
            await screen.findByRole("dialog", { name: startedTitle });
            await userEvent.setup().click(button("진행"));
            const confirmation = await screen.findByRole("dialog", { name: recordsTitle });
            expect(confirmation).toHaveAttribute("data-component", `${base}_start-date-records-confirmation`);
            expect(confirmation).toHaveTextContent("이미 제출된 제공기록지 기록이 있어요. 새로운 시작일을 기준으로 1회차부터 작성된 회차까지 모두 옮길까요?");
            expect(within(confirmation).getAllByRole("button").map((item) => item.textContent)).toEqual(["처음부터 시작", "모두 옮기기"]);
            expect(updateMutateAsync).toHaveBeenCalledTimes(1);
            await userEvent.setup().click(button(label));
            await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
            expect(updateMutateAsync).toHaveBeenCalledTimes(2);
            expect(updateMutateAsync.mock.calls[1][0]).toEqual({
                id: client.id,
                dto: { ...updateMutateAsync.mock.calls[0][0].dto, startDateChangeMode: mode },
            });
            expect(props.onSuccess).toHaveBeenCalledWith(client);
        },
    );

    it.each(["cancel", "escape", "backdrop"])("%s cancels the started confirmation and keeps edits without an error", async (action) => {
        updateMutateAsync.mockRejectedValueOnce(lockedError({ serviceStarted: true, recordedSessionCount: 0 }));
        const { props } = await renderDialog();
        await submitChangedDate();
        await screen.findByRole("dialog", { name: startedTitle });
        const user = userEvent.setup();
        if (action === "cancel") await user.click(button("취소"));
        else if (action === "escape") await user.keyboard("{Escape}");
        else await user.click(document.querySelector(`[data-component="${base}_start-date-started-confirmation_overlay"]`)!);
        await waitFor(() => expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument());
        expectKeptForm(props);
    });

    it("opens records directly for an unstarted service with records", async () => {
        updateMutateAsync.mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 2 }));
        const { props } = await renderDialog();
        await submitChangedDate();
        await screen.findByRole("dialog", { name: recordsTitle });
        expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
        expectKeptForm(props);
    });

    it.each(["escape", "backdrop"])("dismissing records via %s sends no RESTART request", async (action) => {
        updateMutateAsync.mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 2 }));
        const { props } = await renderDialog();
        await submitChangedDate();
        await screen.findByRole("dialog", { name: recordsTitle });
        const user = userEvent.setup();
        if (action === "escape") await user.keyboard("{Escape}");
        else await user.click(document.querySelector(`[data-component="${base}_start-date-records-confirmation_overlay"]`)!);
        await waitFor(() => expect(screen.queryByRole("dialog", { name: recordsTitle })).not.toBeInTheDocument());
        expectKeptForm(props);
    });

    it.each([undefined, { serviceStarted: true, recordedSessionCount: -1 }])(
        "keeps the existing error UI when the lock is unusable: %j", async (lock) => {
            updateMutateAsync.mockRejectedValueOnce(lockedError(lock));
            const { props } = await renderDialog();
            await submitChangedDate();
            expect(await screen.findByRole("alert")).toHaveTextContent("요청 ID: req-start-date-lock");
            expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
            expect(screen.queryByRole("dialog", { name: recordsTitle })).not.toBeInTheDocument();
            expect(props.onClose).not.toHaveBeenCalled();
            expect(updateMutateAsync).toHaveBeenCalledTimes(1);
        },
    );

    it("does not open confirmation for a status other than 409", async () => {
        updateMutateAsync.mockRejectedValueOnce(lockedError({ serviceStarted: true, recordedSessionCount: 0 }, 400));
        await renderDialog();
        await submitChangedDate();
        await screen.findByRole("alert");
        expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
    });

    it("uses existing error handling for a failed retry, even if it is another lock", async () => {
        updateMutateAsync.mockRejectedValue(lockedError({ serviceStarted: true, recordedSessionCount: 0 }));
        const { props } = await renderDialog();
        await submitChangedDate();
        await screen.findByRole("dialog", { name: startedTitle });
        await userEvent.setup().click(button("진행"));
        expect(await screen.findByRole("alert")).toHaveTextContent("요청 ID: req-start-date-lock");
        expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
        expect(updateMutateAsync).toHaveBeenCalledTimes(2);
        expect(props.onSuccess).not.toHaveBeenCalled();
        expect(props.onClose).not.toHaveBeenCalled();
        expect(input("startDate")).toHaveValue("2026-11-03");
    });

    it("preserves the end-date guard error behavior on retry", async () => {
        updateMutateAsync
            .mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 2 }))
            .mockRejectedValueOnce({ response: { status: 409, data: createProblemDetails({
                code: "SERVICE_RECORD_WRITE_TARGET_CHANGED", requestId: "req-end-date-changed", status: 409,
            }) } });
        await renderDialog();
        await submitChangedDate();
        await screen.findByRole("dialog", { name: recordsTitle });
        await userEvent.setup().click(button("모두 옮기기"));
        expect(await screen.findByRole("alert")).toHaveTextContent("그동안 서비스 종료일이 바뀌어 저장하지 않았어요.");
        expect(button("저장")).not.toBeDisabled();
    });

    it("disables both records actions while a retry is pending and prevents duplicate sends", async () => {
        let resolveRetry!: (value: typeof client) => void;
        updateMutateAsync
            .mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 2 }))
            .mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
        const { props } = await renderDialog();
        await submitChangedDate();
        await screen.findByRole("dialog", { name: recordsTitle });
        await userEvent.setup().click(button("처음부터 시작"));
        expect(button("처음부터 시작")).toBeDisabled();
        expect(button("모두 옮기기")).toBeDisabled();
        expect(modal(recordsTitle)).toHaveAttribute("aria-busy", "true");
        fireEvent.click(button("처음부터 시작"));
        fireEvent.click(button("모두 옮기기"));
        expect(updateMutateAsync).toHaveBeenCalledTimes(2);
        await act(async () => resolveRetry(client));
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it("discards the remembered request on close/reopen and sends the next attempt without a mode", async () => {
        updateMutateAsync.mockRejectedValueOnce(lockedError({ serviceStarted: true, recordedSessionCount: 3 }));
        const { props, rerender } = await renderDialog();
        await submitChangedDate();
        await screen.findByRole("dialog", { name: startedTitle });
        await act(async () => rerender(<ClientFormDialog {...props} open={false} />));
        await act(async () => rerender(<ClientFormDialog {...props} />));
        expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
        expect(screen.queryByRole("dialog", { name: recordsTitle })).not.toBeInTheDocument();
        expect(input("startDate")).toHaveValue("2026-11-02");
        fireEvent.change(input("address"), { target: { value: "새 주소" } });
        fireEvent.click(button("저장"));
        await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(2));
        expect(updateMutateAsync.mock.calls[1][0]).toEqual({ id: client.id, dto: { address: "새 주소" } });
    });
});
