import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { shouldRetryQuery } from "@/lib/queryClient";

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
        queryClient = new QueryClient({ defaultOptions: { queries: { retry: shouldRetryQuery, retryDelay: 0 } } });
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

    it("blocks submission with a busy spinner while the document is still loading", async () => {
        mockGetDocument.mockReturnValue(new Promise(() => {}));
        const onCheck = await submitFor(SUMMARY);
        const submit = screen.getByRole("button", { name: /조회하기/ });
        expect(submit).toBeDisabled();
        expect(submit).toHaveAttribute("aria-busy", "true");
        expect(submit.querySelector('[data-slot="spinner"]')).not.toBeNull();
        expect(onCheck).not.toHaveBeenCalled();
    });

    it("blocks a failed load and retries before reporting a 071 rejection", async () => {
        mockGetDocument.mockRejectedValueOnce({ response: { status: 404 } });
        const onCheck = await submitFor(SUMMARY);
        expect(await screen.findByRole("alert")).toHaveTextContent("불러오지 못했습니다");
        expect(screen.getByRole("button", { name: /조회하기/ })).toBeDisabled();
        expect(onCheck).not.toHaveBeenCalled();
        expect(mockGetDocument).toHaveBeenCalledTimes(1);

        let resolveDocument!: (document: unknown) => void;
        mockGetDocument.mockImplementationOnce(() => new Promise((resolve) => { resolveDocument = resolve; }));
        fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
        await waitFor(() => expect(mockGetDocument).toHaveBeenCalledTimes(2));
        expect(screen.getByRole("button", { name: /조회하기/ })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: /조회하기/ }));
        expect(onCheck).not.toHaveBeenCalled();
        await act(async () => resolveDocument({ current_status: { status_type: "071" } }));
        await waitFor(() => expect(screen.getByRole("button", { name: /조회하기/ })).toBeEnabled());
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /조회하기/ }));
        expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({ rejectedByReviewer: true }));
    });

    it("blocks a failed refresh even while a stale rejected document is cached", async () => {
        queryClient.setQueryData(
            ["eformsign-docs", "document", "doc-1"],
            { display_status: "rejected_by_reviewer", current_status: { status_type: "071" } },
            { updatedAt: 0 },
        );
        mockGetDocument.mockRejectedValue({ response: { status: 404 } });
        // Wait for the failed refresh before attempting submission.
        mockClient = SUMMARY;
        const onCheck = jest.fn();
        render(<QueryClientProvider client={queryClient}><ContractStatusWizard onCheck={onCheck} /></QueryClientProvider>);
        fireEvent.click(screen.getByRole("button", { name: "산모 고르기" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("불러오지 못했습니다");
        expect(mockGetDocument).toHaveBeenCalledTimes(1);
        expect(queryClient.getQueryData(["eformsign-docs", "document", "doc-1"])).toBeDefined();
        expect(screen.getByRole("button", { name: /조회하기/ })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: /조회하기/ }));
        expect(onCheck).not.toHaveBeenCalled();
    });

    it.each([[500, 4], [404, 1]])("inherits the retry policy for status %s (%s attempts)", async (status, attempts) => {
        mockGetDocument.mockRejectedValue({ response: { status } });
        const onCheck = await submitFor(SUMMARY);
        await screen.findByRole("alert");
        expect(mockGetDocument).toHaveBeenCalledTimes(attempts);
        expect(screen.getByRole("button", { name: /조회하기/ })).toBeDisabled();
        expect(onCheck).not.toHaveBeenCalled();
    });

    it("clears the previous failure and waits for the newly selected client's document", async () => {
        mockGetDocument.mockRejectedValueOnce({ response: { status: 404 } });
        const onCheck = await submitFor(SUMMARY);
        await screen.findByRole("alert");
        mockClient = { ...SUMMARY, id: 8, latestContractDocumentId: "doc-2" };
        let resolveDocument!: (document: unknown) => void;
        mockGetDocument.mockImplementationOnce(() => new Promise((resolve) => { resolveDocument = resolve; }));
        fireEvent.click(screen.getByRole("button", { name: "산모 고르기" }));
        await waitFor(() => expect(mockGetDocument).toHaveBeenCalledWith("doc-2"));
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: /조회하기/ })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: /조회하기/ }));
        expect(onCheck).not.toHaveBeenCalled();
        await act(async () => resolveDocument({ current_status: { status_type: "071" } }));
        await waitFor(() => expect(screen.getByRole("button", { name: /조회하기/ })).toBeEnabled());
        fireEvent.click(screen.getByRole("button", { name: /조회하기/ }));
        expect(onCheck).toHaveBeenCalledWith(expect.objectContaining({ clientId: 8, rejectedByReviewer: true }));
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
