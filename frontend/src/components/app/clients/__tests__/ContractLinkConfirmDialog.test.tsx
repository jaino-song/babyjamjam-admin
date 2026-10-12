import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { EformsignLinkConfirmation } from "@/services/eformsign";
import { eformsignApi } from "@/services/api";

import { ContractLinkConfirmDialog } from "../ContractLinkConfirmDialog";

const mockUpdateMutateAsync = jest.fn();

jest.mock("@/features/clients/hooks/use-clients", () => ({
    useUpdateClient: () => ({ mutateAsync: mockUpdateMutateAsync }),
}));

jest.mock("@/services/api", () => ({
    eformsignApi: {
        adoptDocument: jest.fn(),
        getLinkConfirmations: jest.fn(),
    },
}));

const adoptDocument = eformsignApi.adoptDocument as jest.Mock;
const getLinkConfirmations = eformsignApi.getLinkConfirmations as jest.Mock;

const UPDATE_FAILED = "고객 정보를 수정하지 못했습니다. 다시 시도해 주세요.";
const ADOPT_AFTER_UPDATE_FAILED = "고객 정보는 수정했지만 계약서를 연결하지 못했습니다. 다시 시도해 주세요.";
const ADOPT_FAILED = "계약서를 연결하지 못했습니다. 다시 시도해 주세요.";

function makeEntry(overrides: Partial<EformsignLinkConfirmation> = {}): EformsignLinkConfirmation {
    return {
        documentId: "doc-1",
        documentName: "서비스 계약서",
        statusType: "002",
        statusDetail: "고객 서명",
        createdDate: "2026-09-01T00:00:00.000Z",
        document: { name: "박계약", phone: "01011112222", birthday: "1990-01-02" },
        client: { id: 7, name: "김고객", phone: "01011112222", birthday: "1991-03-04" },
        differences: ["name", "birthday"],
        canConfirm: true,
        ...overrides,
    };
}

let queryClient: QueryClient;
let onClose: jest.Mock;

function renderDialog(entry: EformsignLinkConfirmation = makeEntry()) {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    onClose = jest.fn();
    return render(
        <QueryClientProvider client={queryClient}>
            <ContractLinkConfirmDialog
                entry={entry}
                clientId={7}
                dataComponentPrefix="test_prefix"
                onClose={onClose}
            />
        </QueryClientProvider>,
    );
}

function choose(name: string) {
    fireEvent.click(screen.getByRole("radio", { name }));
}

function confirmButton() {
    return screen.getByRole("button", { name: "확정" });
}

function chooseContractValues() {
    choose("계약서: 박계약");
    choose("계약서: 1990-01-02");
}

function chooseClientValues() {
    choose("고객 정보: 김고객");
    choose("고객 정보: 1991-03-04");
}

describe("ContractLinkConfirmDialog", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUpdateMutateAsync.mockReset();
        adoptDocument.mockReset();
        getLinkConfirmations.mockReset();
        mockUpdateMutateAsync.mockResolvedValue({});
        adoptDocument.mockResolvedValue({ documentId: "doc-1" });
        // After a failed adopt the dialog re-reads the pending list; by default the entry is still there.
        getLinkConfirmations.mockResolvedValue([makeEntry()]);
    });

    afterEach(() => {
        cleanup();
    });

    describe("what the dialog shows", () => {
        it("shows the phone, one row per differing item, the two values of each, and the note", () => {
            renderDialog();

            expect(screen.getByRole("heading", { name: "계약서 연결 확인" })).toBeInTheDocument();
            expect(
                screen.getByText(
                    "전화번호는 같지만 아래 내용이 달라 자동으로 연결하지 않았습니다. 항목마다 맞는 값을 고른 뒤 확정하세요.",
                ),
            ).toBeInTheDocument();
            expect(screen.getByText("010-1111-2222")).toBeInTheDocument();
            expect(screen.getByRole("radiogroup", { name: "이름" })).toBeInTheDocument();
            expect(screen.getByRole("radiogroup", { name: "생년월일" })).toBeInTheDocument();
            expect(screen.getByRole("radio", { name: "계약서: 박계약" })).toBeInTheDocument();
            expect(screen.getByRole("radio", { name: "고객 정보: 김고객" })).toBeInTheDocument();
            expect(screen.getByRole("radio", { name: "계약서: 1990-01-02" })).toBeInTheDocument();
            expect(screen.getByRole("radio", { name: "고객 정보: 1991-03-04" })).toBeInTheDocument();
            expect(
                screen.getByText("'계약서' 값을 고르면 고객 정보가 그 값으로 수정됩니다."),
            ).toBeInTheDocument();
        });

        it("shows only the rows that differ", () => {
            renderDialog(makeEntry({ differences: ["birthday"] }));

            expect(screen.queryByRole("radiogroup", { name: "이름" })).not.toBeInTheDocument();
            expect(screen.getByRole("radiogroup", { name: "생년월일" })).toBeInTheDocument();
        });

        it("preselects nothing and keeps 확정 disabled until every row has a choice", () => {
            renderDialog();

            for (const radio of screen.getAllByRole("radio")) {
                expect(radio).not.toBeChecked();
            }
            expect(confirmButton()).toBeDisabled();

            choose("고객 정보: 김고객");
            expect(confirmButton()).toBeDisabled();

            choose("계약서: 1990-01-02");
            expect(confirmButton()).toBeEnabled();
        });

        it("shows a missing value as 없음 that cannot be chosen", () => {
            renderDialog(makeEntry({ differences: ["birthday"], document: { name: "박계약", phone: "01011112222", birthday: null } }));

            const missing = screen.getByRole("radio", { name: "계약서: 없음" });
            expect(missing).toBeDisabled();
            expect(confirmButton()).toBeDisabled();

            choose("고객 정보: 1991-03-04");
            expect(confirmButton()).toBeEnabled();
        });

        it("says so when both sides are missing and needs no choice for that row", () => {
            renderDialog(
                makeEntry({
                    differences: ["birthday"],
                    document: { name: "박계약", phone: "01011112222", birthday: null },
                    client: { id: 7, name: "김고객", phone: "01011112222", birthday: null },
                }),
            );

            expect(screen.getByText("양쪽 모두 정보가 없습니다")).toBeInTheDocument();
            expect(screen.queryAllByRole("radio")).toHaveLength(0);
            expect(confirmButton()).toBeEnabled();
        });
    });

    describe("confirming", () => {
        it("updates the client with exactly the contract-chosen fields, then adopts, in that order", async () => {
            const order: string[] = [];
            mockUpdateMutateAsync.mockImplementation(async () => {
                order.push("update");
                return {};
            });
            adoptDocument.mockImplementation(async () => {
                order.push("adopt");
                return { documentId: "doc-1" };
            });
            renderDialog();

            chooseContractValues();
            fireEvent.click(confirmButton());

            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(order).toEqual(["update", "adopt"]);
            expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
            expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
                id: 7,
                dto: { name: "박계약", birthday: "1990-01-02" },
            });
            expect(adoptDocument).toHaveBeenCalledTimes(1);
            expect(adoptDocument).toHaveBeenCalledWith("doc-1", 7);
        });

        it("sends only the field whose contract value was chosen", async () => {
            renderDialog();

            choose("계약서: 박계약");
            choose("고객 정보: 1991-03-04");
            fireEvent.click(confirmButton());

            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(mockUpdateMutateAsync).toHaveBeenCalledWith({ id: 7, dto: { name: "박계약" } });
        });

        it("does not update the client when only the client's values were chosen, and still adopts", async () => {
            renderDialog();

            chooseClientValues();
            fireEvent.click(confirmButton());

            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
            expect(adoptDocument).toHaveBeenCalledTimes(1);
            expect(adoptDocument).toHaveBeenCalledWith("doc-1", 7);
        });

        it("refreshes the contracts, the pending list and the client once linked", async () => {
            renderDialog();
            const invalidate = jest.spyOn(queryClient, "invalidateQueries");

            chooseClientValues();
            fireEvent.click(confirmButton());

            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
            expect(keys).toEqual(
                expect.arrayContaining([
                    ["eformsign-docs", "client", 7],
                    ["eformsign-docs", "link-confirmations", 7],
                    ["clients"],
                    ["clients", "detail", 7],
                ]),
            );
        });

        it("treats an adopt response with warnings as a success", async () => {
            adoptDocument.mockResolvedValue({ documentId: "doc-1", warnings: ["mirror_sync_failed"] });
            renderDialog();

            chooseClientValues();
            fireEvent.click(confirmButton());

            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(screen.queryByRole("alert")).not.toBeInTheDocument();
            expect(getLinkConfirmations).not.toHaveBeenCalled();
        });

        it("runs one sequence when 확정 is clicked twice", async () => {
            let releaseUpdate: () => void = () => undefined;
            mockUpdateMutateAsync.mockReturnValue(
                new Promise((resolve) => {
                    releaseUpdate = () => resolve({});
                }),
            );
            renderDialog();

            chooseContractValues();
            fireEvent.click(confirmButton());
            fireEvent.click(confirmButton());
            expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
            expect(confirmButton()).toBeDisabled();

            releaseUpdate();
            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
            expect(adoptDocument).toHaveBeenCalledTimes(1);
        });

        it("calls nothing when cancelled", () => {
            renderDialog();

            chooseContractValues();
            fireEvent.click(screen.getByRole("button", { name: "취소" }));

            expect(onClose).toHaveBeenCalledTimes(1);
            expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
            expect(adoptDocument).not.toHaveBeenCalled();
            expect(getLinkConfirmations).not.toHaveBeenCalled();
        });
    });

    describe("when something fails", () => {
        it("stays open and does not adopt when the client update fails", async () => {
            mockUpdateMutateAsync.mockRejectedValue(new Error("boom"));
            renderDialog();

            chooseContractValues();
            fireEvent.click(confirmButton());

            expect(await screen.findByRole("alert")).toHaveTextContent(UPDATE_FAILED);
            expect(adoptDocument).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
            expect(confirmButton()).toBeEnabled();
        });

        it("tries the update again on the next 확정 when the first update failed", async () => {
            mockUpdateMutateAsync.mockRejectedValueOnce(new Error("boom"));
            renderDialog();

            chooseContractValues();
            fireEvent.click(confirmButton());
            await screen.findByRole("alert");

            fireEvent.click(confirmButton());

            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(2);
            expect(adoptDocument).toHaveBeenCalledTimes(1);
        });

        it("says the client was updated when adopt fails after the update, and a second 확정 only retries adopt", async () => {
            adoptDocument.mockRejectedValueOnce(new Error("boom"));
            renderDialog();

            chooseContractValues();
            fireEvent.click(confirmButton());

            expect(await screen.findByRole("alert")).toHaveTextContent(ADOPT_AFTER_UPDATE_FAILED);
            expect(onClose).not.toHaveBeenCalled();
            expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
            // The client already holds the contract's values, so the choices cannot change any more.
            for (const radio of screen.getAllByRole("radio")) {
                expect(radio).toBeDisabled();
            }

            fireEvent.click(confirmButton());

            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
            expect(adoptDocument).toHaveBeenCalledTimes(2);
        });

        it("says the contract was not linked when adopt fails and nothing was updated", async () => {
            adoptDocument.mockRejectedValue(new Error("boom"));
            renderDialog();

            chooseClientValues();
            fireEvent.click(confirmButton());

            expect(await screen.findByRole("alert")).toHaveTextContent(ADOPT_FAILED);
            expect(screen.getByRole("alert")).not.toHaveTextContent("고객 정보는 수정했지만");
            expect(mockUpdateMutateAsync).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
        });

        it("closes as a success when adopt fails but the refreshed list no longer has the document", async () => {
            adoptDocument.mockRejectedValue(new Error("boom"));
            getLinkConfirmations.mockResolvedValue([]);
            renderDialog();

            chooseContractValues();
            fireEvent.click(confirmButton());

            await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
            expect(getLinkConfirmations).toHaveBeenCalledTimes(1);
            expect(getLinkConfirmations).toHaveBeenCalledWith(7);
            expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        });

        it("shows the error when adopt fails and the refresh itself fails", async () => {
            adoptDocument.mockRejectedValue(new Error("boom"));
            getLinkConfirmations.mockRejectedValue(new Error("down"));
            renderDialog();

            chooseClientValues();
            fireEvent.click(confirmButton());

            expect(await screen.findByRole("alert")).toHaveTextContent(ADOPT_FAILED);
            expect(onClose).not.toHaveBeenCalled();
        });

        it("keeps the dialog open when the refreshed list still has the document", async () => {
            adoptDocument.mockRejectedValue(new Error("boom"));
            getLinkConfirmations.mockResolvedValue([makeEntry({ differences: ["birthday"] })]);
            renderDialog();

            chooseClientValues();
            fireEvent.click(confirmButton());

            expect(await screen.findByRole("alert")).toHaveTextContent(ADOPT_FAILED);
            expect(onClose).not.toHaveBeenCalled();
        });
    });
});
