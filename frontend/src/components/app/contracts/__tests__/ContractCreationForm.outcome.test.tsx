/**
 * BJJ-319 5-4c: when the dispatch envelope carries the additive `outcome`
 * field (phase 5-4a), it is the primary classification. The legacy
 * reason/fallbackHint branches stay as the fallback for envelopes without the
 * field, so nothing regresses against an older backend.
 *
 * Rendering-based, mirroring ContractCreationForm.iframe-fallback.test.tsx.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { useFormStore } from "@/stores/form-store";
import { ContractCreationForm } from "../ContractCreationForm";

const mockOpenDocument = jest.fn();
const mockDispatchHeadless = jest.fn();
const mockGenerateDocument = jest.fn();
const mockAuthenticate = jest.fn();
const mockAdoptDocument = jest.fn();

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock("@/providers/LocaleProvider", () => ({
    useLocale: () => "ko",
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
    useGetAuthUser: () => ({ data: { phone: "010-1234-5678" } }),
}));

jest.mock("@/hooks/useEformsign", () => ({
    useEformsign: () => ({
        isLoaded: true,
        isLoading: false,
        error: null,
        openDocument: mockOpenDocument,
    }),
}));

jest.mock("@/services/api", () => ({
    eformsignApi: {
        authenticate: (...args: unknown[]) => mockAuthenticate(...args),
        dispatchHeadless: (...args: unknown[]) => mockDispatchHeadless(...args),
        generateDocument: (...args: unknown[]) => mockGenerateDocument(...args),
        createDocRecord: jest.fn().mockResolvedValue({}),
        adoptDocument: (...args: unknown[]) => mockAdoptDocument(...args),
    },
}));

const idleMutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 42 }), isPending: false });
jest.mock("@/hooks/useClients", () => ({
    useCreateClient: () => idleMutation(),
    useUpdateClient: () => idleMutation(),
    useDeleteClient: () => idleMutation(),
}));

jest.mock("@/hooks/useEmployees", () => ({
    useEmployees: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks", () => ({
    useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
    useVoucherYears: () => ({ data: [2026], isLoading: false }),
    useAreaTemplates: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/lib/sse/reconnecting-event-source", () => ({
    createReconnectingEventSource: () => ({ close: jest.fn() }),
}));

const CONTRACT_INFO_STEP_INDEX = 3;

function seedValidContractForm(): void {
    useFormStore.setState({
        clientId: 42,
        isManualEntry: false,
        name: "송진호",
        phone: "010-6621-1878",
        birthday: "960414",
        dueDate: "",
        address: "인천시 강다",
        employeeId: 7,
        employeeName: "김정인",
        employeePhone: "01057871878",
        showEmployee2: false,
        employee2Id: null,
        startDate: "2026-08-05",
        endDate: "2026-08-25",
        paymentDate: "2026-08-05",
        fullPrice: "1000000",
        grant: "800000",
        actualPrice: "200000",
        voucherType: "일반",
        voucherDuration: "15",
        area: "인천",
    });
}

function renderForm() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    function Harness() {
        const [activeStep, setActiveStep] = useState(CONTRACT_INFO_STEP_INDEX);
        return (
            <ContractCreationForm
                activeStep={activeStep}
                onActiveStepChange={setActiveStep}
            />
        );
    }
    return render(
        <QueryClientProvider client={queryClient}>
            <Harness />
        </QueryClientProvider>,
    );
}

async function submitAndWaitForDispatchVerdict() {
    fireEvent.click(screen.getByTestId("contract-creation-submit"));
    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1), { timeout: 5000 });
    // Give any (forbidden) deferred fallback or auto-retry a chance to fire
    // before asserting on it.
    await new Promise((resolve) => setTimeout(resolve, 700));
}

describe("ContractCreationForm — envelope outcome as primary classification", () => {
    beforeAll(() => {
        class ResizeObserverMock {
            observe = jest.fn();
            unobserve = jest.fn();
            disconnect = jest.fn();
        }
        global.ResizeObserver = ResizeObserverMock;
        Element.prototype.scrollIntoView = jest.fn();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthenticate.mockResolvedValue({ success: true });
        mockGenerateDocument.mockResolvedValue({ document: { id: "tpl-1" }, user_data: {} });
        mockAdoptDocument.mockResolvedValue({ documentId: "doc-remote-9" });
        seedValidContractForm();
    });

    it("locks with the 확인 필요 notice when the outcome is UNKNOWN, even against a stale iframe hint", async () => {
        // A legacy envelope shaped like this would have opened the editor via
        // `fallbackHint:"iframe"`; the structured verdict outranks the hint.
        mockDispatchHeadless.mockResolvedValue({
            ok: false,
            reason: "dispatch_uncertain_manual_reconciliation_required",
            fallbackHint: "iframe",
            outcome: "UNKNOWN",
            durationMs: 5,
        });

        renderForm();
        await submitAndWaitForDispatchVerdict();

        expect(await screen.findByTestId("contract-creation-unverified-notice")).toBeInTheDocument();
        expect(screen.getByText(/전자문서 목록에서 생성 여부를 먼저 확인/)).toBeInTheDocument();
        // No iframe, no manual re-entry, no automatic retry.
        expect(mockOpenDocument).not.toHaveBeenCalled();
        expect(mockGenerateDocument).not.toHaveBeenCalled();
        expect(mockDispatchHeadless).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId("contract-creation-manual")).not.toBeInTheDocument();
    });

    it("adopts the remote document when the outcome is PARTIALLY_APPLIED", async () => {
        mockDispatchHeadless.mockResolvedValue({
            ok: false,
            reason: "local_persist_failed",
            outcome: "PARTIALLY_APPLIED",
            remoteDocumentId: "doc-remote-9",
            durationMs: 5,
        });

        renderForm();
        await submitAndWaitForDispatchVerdict();

        await waitFor(() => expect(mockAdoptDocument).toHaveBeenCalledWith("doc-remote-9", 42));
        expect(mockOpenDocument).not.toHaveBeenCalled();
        expect(await screen.findByText("계약서가 성공적으로 생성되었습니다.")).toBeInTheDocument();
    });

    it("shows the check-list copy when PARTIALLY_APPLIED arrives without a remote document", async () => {
        mockDispatchHeadless.mockResolvedValue({
            ok: false,
            outcome: "PARTIALLY_APPLIED",
            durationMs: 5,
        });

        renderForm();
        await submitAndWaitForDispatchVerdict();

        expect(await screen.findByText(/새 계약서를 다시 만들지 말고/)).toBeInTheDocument();
        expect(mockAdoptDocument).not.toHaveBeenCalled();
        expect(mockOpenDocument).not.toHaveBeenCalled();
        expect(mockDispatchHeadless).toHaveBeenCalledTimes(1);
    });

    it("keeps the duplicate-force branch working for NOT_APPLIED envelopes", async () => {
        mockDispatchHeadless.mockResolvedValue({
            ok: false,
            reason: "duplicate_pending_document",
            outcome: "NOT_APPLIED",
            durationMs: 5,
        });

        renderForm();
        fireEvent.click(screen.getByTestId("contract-creation-submit"));
        await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1), { timeout: 5000 });

        // The legacy branch runs: staff are asked to confirm a forced retry —
        // the outcome did not lock the form the way UNKNOWN would.
        expect(await screen.findByText("최근 생성된 진행 중 문서가 있습니다. 그래도 새로 생성하시겠습니까?")).toBeInTheDocument();
        expect(mockAdoptDocument).not.toHaveBeenCalled();
        expect(mockOpenDocument).not.toHaveBeenCalled();
    });

    it("keeps the legacy reason branch unchanged when the envelope carries no outcome", async () => {
        mockDispatchHeadless.mockResolvedValue({
            ok: false,
            reason: "remote_unconfirmed",
            durationMs: 5,
        });

        renderForm();
        await submitAndWaitForDispatchVerdict();

        expect(await screen.findByText(/문서 생성 상태를 확인할 수 없어요/)).toBeInTheDocument();
        // The legacy branch sets the inline error, not the durable notice.
        expect(screen.queryByTestId("contract-creation-unverified-notice")).not.toBeInTheDocument();
        expect(mockOpenDocument).not.toHaveBeenCalled();
        expect(mockAdoptDocument).not.toHaveBeenCalled();
    });
});
