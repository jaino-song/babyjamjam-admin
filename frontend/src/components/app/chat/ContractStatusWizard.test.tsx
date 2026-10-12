import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import ContractStatusWizard from "./ContractStatusWizard";

let mockClient: Record<string, unknown> = {};
const mockGetDocument = jest.fn();

jest.mock("../clients/ClientAutocomplete", () => ({
    ClientAutocomplete: ({ onChange }: { onChange: (id: number | null, client: unknown) => void }) => (
        <button type="button" onClick={() => onChange(mockClient.id as number, mockClient)}>
            산모 고르기
        </button>
    ),
}));

jest.mock("@/services/api", () => ({
    eformsignApi: { getDocument: (...args: unknown[]) => mockGetDocument(...args) },
}));

const SUMMARY = {
    id: 7,
    name: "홍길동",
    documentStatus: "requested",
    serviceStatus: null,
    hasSigned: true,
    latestContractDocumentId: "doc-1",
    eDocId: "doc-1",
};

let queryClient: QueryClient;

async function submitFor(client: Record<string, unknown>, { expectFetch = true } = {}) {
    mockClient = client;
    const onCheck = jest.fn();
    render(
        <QueryClientProvider client={queryClient}>
            <ContractStatusWizard onCheck={onCheck} />
        </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "산모 고르기" }));
    if (expectFetch) {
        await waitFor(() => expect(mockGetDocument).toHaveBeenCalledWith("doc-1"));
    }
    // Let the document query settle (or stay pending) before the user clicks 조회하기.
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.click(screen.getByRole("button", { name: /조회하기/ }));
    return onCheck;
}

describe("ContractStatusWizard", () => {
    beforeEach(() => {
        mockGetDocument.mockReset();
        queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    });

    afterEach(() => {
        queryClient.clear();
    });

    it.each([true, false])("passes the selected client's hasSigned=%s through to the result", async (hasSigned) => {
        mockGetDocument.mockResolvedValue({ current_status: { status_type: "060" } });
        const onCheck = await submitFor({ ...SUMMARY, hasSigned });
        expect(onCheck).toHaveBeenCalledWith({
            clientId: 7,
            clientName: "홍길동",
            documentStatus: "requested",
            serviceStatus: null,
            hasSigned,
            rejectedByReviewer: false,
        });
    });

    it("flags a contract document whose display status is rejected_by_reviewer", async () => {
        mockGetDocument.mockResolvedValue({
            display_status: "rejected_by_reviewer",
            current_status: { status_type: "071" },
        });
        const onCheck = await submitFor(SUMMARY);
        expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({ hasSigned: true, rejectedByReviewer: true }));
    });

    it("flags a 071 contract document when the display status is absent", async () => {
        mockGetDocument.mockResolvedValue({ current_status: { status_type: "071" } });
        const onCheck = await submitFor(SUMMARY);
        expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({ rejectedByReviewer: true }));
    });

    it("does not flag a 070 contract document", async () => {
        mockGetDocument.mockResolvedValue({ current_status: { status_type: "070" } });
        const onCheck = await submitFor(SUMMARY);
        expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({ rejectedByReviewer: false }));
    });

    it("does not flag a non-rejected display status even when a stale 071 status code is present", async () => {
        mockGetDocument.mockResolvedValue({ display_status: "signed", current_status: { status_type: "071" } });
        const onCheck = await submitFor(SUMMARY);
        expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({ rejectedByReviewer: false }));
    });

    it("falls back to the summary while the document is still loading", async () => {
        mockGetDocument.mockReturnValue(new Promise(() => {}));
        const onCheck = await submitFor(SUMMARY);
        expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({ rejectedByReviewer: false }));
    });

    it("falls back to the summary when the document fails to load", async () => {
        mockGetDocument.mockRejectedValue(new Error("boom"));
        const onCheck = await submitFor(SUMMARY);
        expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({ rejectedByReviewer: false }));
    });

    it("falls back to the summary when a refresh fails while a stale rejected document is cached", async () => {
        queryClient.setQueryData(
            ["eformsign-docs", "document", "doc-1"],
            { display_status: "rejected_by_reviewer", current_status: { status_type: "071" } },
            { updatedAt: 0 },
        );
        mockGetDocument.mockRejectedValue(new Error("boom"));
        const onCheck = await submitFor(SUMMARY);
        // The hook retries once (about a second) before the query settles in error with the old data kept.
        await waitFor(() => expect(queryClient.getQueryState(["eformsign-docs", "document", "doc-1"])?.status).toBe("error"), {
            timeout: 5000,
        });
        expect(mockGetDocument).toHaveBeenCalledTimes(2);
        expect(queryClient.getQueryData(["eformsign-docs", "document", "doc-1"])).toBeDefined();
        fireEvent.click(screen.getByRole("button", { name: /조회하기/ }));
        expect(onCheck).toHaveBeenLastCalledWith(
            expect.objectContaining({ hasSigned: true, rejectedByReviewer: false }),
        );
    });

    it("falls back to the summary, without a fetch, when the client has no contract document", async () => {
        const onCheck = await submitFor(
            { ...SUMMARY, latestContractDocumentId: null, eDocId: null },
            { expectFetch: false },
        );
        expect(mockGetDocument).not.toHaveBeenCalled();
        expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({ rejectedByReviewer: false }));
    });

    it("reads the document of the latest contract, falling back to eDocId", async () => {
        mockGetDocument.mockResolvedValue({ current_status: { status_type: "071" } });
        const onCheck = await submitFor({ ...SUMMARY, latestContractDocumentId: null });
        expect(mockGetDocument).toHaveBeenCalledWith("doc-1");
        expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({ rejectedByReviewer: true }));
    });
});
