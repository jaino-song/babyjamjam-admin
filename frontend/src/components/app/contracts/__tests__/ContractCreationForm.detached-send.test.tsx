/**
 * A send keeps running on the server when the dialog hosting the form is closed
 * mid-send. The unmounted form must report the outcome by toast only (no parent
 * callbacks, no iframe/manual fallback), and the success footer offers two
 * equal buttons: 새 전자문서 발송 and 완료.
 *
 * Rendering-based, mirroring ContractCreationForm.outcome.test.tsx.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clientKeys } from "@/features/clients/hooks/keys";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { useFormStore } from "@/stores/form-store";
import { ContractCreationForm } from "../ContractCreationForm";

const mockOpenDocument = jest.fn();
const mockDispatchHeadless = jest.fn();
const mockGenerateDocument = jest.fn();
const mockAuthenticate = jest.fn();
const mockAdoptDocument = jest.fn();
const mockToast = jest.fn();

jest.mock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/hooks/useBusinessDayCalendar");
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
    useAllClients: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks/useEmployees", () => ({
    useEmployees: () => ({ data: [], isLoading: false }),
}));

// dev sync: the submit button now requires an area template for the selected
// area (`isAreaTemplateSelectionValid`), mirroring the sibling iframe-fallback
// test's fixture.
const mockAreaTemplates = [{
    id: "area-template-1",
    areaId: "인천",
    templateId: "template-1",
    templateName: "인천 산모 계약서",
}];

jest.mock("@/hooks", () => ({
    useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
    useVoucherYears: () => ({ data: [2026], isLoading: false }),
    useAreaTemplates: () => ({ data: mockAreaTemplates, isLoading: false }),
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

function renderForm(callbacks: Partial<React.ComponentProps<typeof ContractCreationForm>> = {}) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    function Harness() {
        const [activeStep, setActiveStep] = useState(CONTRACT_INFO_STEP_INDEX);
        return (
            <ContractCreationForm
                activeStep={activeStep}
                onActiveStepChange={setActiveStep}
                {...callbacks}
            />
        );
    }
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
    const view = render(
        <QueryClientProvider client={queryClient}>
            <Harness />
        </QueryClientProvider>,
    );
    return { ...view, invalidateSpy };
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function makeCallbacks() {
    return {
        onClose: jest.fn(),
        onSuccess: jest.fn(),
        onSessionStateChange: jest.fn(),
        onSubmissionStateChange: jest.fn(),
        onProcessingFailureChange: jest.fn(),
    };
}

async function startSendAndUnmount(callbacks: ReturnType<typeof makeCallbacks>) {
    const pending = createDeferred<unknown>();
    mockDispatchHeadless.mockReturnValue(pending.promise);
    const view = renderForm(callbacks);
    fireEvent.click(screen.getByTestId("contract-creation-submit"));
    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1), { timeout: 5000 });
    view.unmount();
    callbacks.onSessionStateChange.mockClear();
    callbacks.onSubmissionStateChange.mockClear();
    callbacks.onProcessingFailureChange.mockClear();
    return { pending, view };
}

async function settle() {
    // Let any (forbidden) deferred fallback run before asserting on it.
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
}

describe("ContractCreationForm — closed mid-send", () => {
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

    it("toasts success without touching the parent when the send succeeds after unmount", async () => {
        const callbacks = makeCallbacks();
        const { pending, view } = await startSendAndUnmount(callbacks);

        await act(async () => {
            pending.resolve({ ok: true, documentId: "doc-1", durationMs: 5 });
        });
        await settle();

        expect(mockToast).toHaveBeenCalledTimes(1);
        expect(mockToast).toHaveBeenCalledWith({ description: "송진호님께 전자문서를 보냈어요" });
        expect(view.invalidateSpy).toHaveBeenCalledWith({ queryKey: clientKeys.detail(42) });
        expect(callbacks.onSuccess).not.toHaveBeenCalled();
        expect(callbacks.onClose).not.toHaveBeenCalled();
        expect(callbacks.onSessionStateChange).not.toHaveBeenCalled();
        expect(callbacks.onSubmissionStateChange).not.toHaveBeenCalled();
    });

    it("toasts a destructive failure and opens no manual fallback when the send returns ok:false", async () => {
        const callbacks = makeCallbacks();
        const { pending } = await startSendAndUnmount(callbacks);

        await act(async () => {
            pending.resolve({ ok: false, reason: "chromium crashed", fallbackHint: "iframe", durationMs: 5 });
        });
        await settle();

        expect(mockToast).toHaveBeenCalledTimes(1);
        expect(mockToast).toHaveBeenCalledWith({
            variant: "destructive",
            description: "전자문서 발송에 실패했어요. 계약서 목록에서 상태를 확인해 주세요.",
        });
        expect(mockGenerateDocument).not.toHaveBeenCalled();
        expect(mockOpenDocument).not.toHaveBeenCalled();
        expect(callbacks.onSuccess).not.toHaveBeenCalled();
        expect(callbacks.onClose).not.toHaveBeenCalled();
        expect(callbacks.onSubmissionStateChange).not.toHaveBeenCalled();
    });

    it("adopts the sent document and toasts success on partial-apply after unmount", async () => {
        const callbacks = makeCallbacks();
        const { pending, view } = await startSendAndUnmount(callbacks);

        await act(async () => {
            pending.resolve({
                ok: false,
                reason: "local_persist_failed",
                outcome: "PARTIALLY_APPLIED",
                remoteDocumentId: "doc-remote-9",
                durationMs: 5,
            });
        });
        await settle();

        expect(mockAdoptDocument).toHaveBeenCalledWith("doc-remote-9", 42);
        expect(mockToast).toHaveBeenCalledTimes(1);
        expect(mockToast).toHaveBeenCalledWith({ description: "송진호님께 전자문서를 보냈어요" });
        expect(view.invalidateSpy).toHaveBeenCalledWith({ queryKey: clientKeys.detail(42) });
        expect(mockOpenDocument).not.toHaveBeenCalled();
        expect(mockGenerateDocument).not.toHaveBeenCalled();
        expect(callbacks.onSuccess).not.toHaveBeenCalled();
        expect(callbacks.onClose).not.toHaveBeenCalled();
    });

    it("adopts on local_persist_failed with a remote id even without a structured outcome", async () => {
        const callbacks = makeCallbacks();
        const { pending } = await startSendAndUnmount(callbacks);

        await act(async () => {
            pending.resolve({
                ok: false,
                reason: "local_persist_failed",
                remoteDocumentId: "doc-remote-9",
                durationMs: 5,
            });
        });
        await settle();

        expect(mockAdoptDocument).toHaveBeenCalledWith("doc-remote-9", 42);
        expect(mockToast).toHaveBeenCalledWith({ description: "송진호님께 전자문서를 보냈어요" });
    });

    it("toasts a non-destructive warning when the adopted document has mirror_sync_failed", async () => {
        mockAdoptDocument.mockResolvedValue({ documentId: "doc-remote-9", warnings: ["mirror_sync_failed"] });
        const callbacks = makeCallbacks();
        const { pending, view } = await startSendAndUnmount(callbacks);

        await act(async () => {
            pending.resolve({
                ok: false,
                outcome: "PARTIALLY_APPLIED",
                remoteDocumentId: "doc-remote-9",
                durationMs: 5,
            });
        });
        await settle();

        expect(mockToast).toHaveBeenCalledTimes(1);
        expect(mockToast).toHaveBeenCalledWith({
            description:
                "문서는 전송되었지만 동기화가 아직 끝나지 않았어요. 새 계약서를 다시 만들지 말고 잠시 후 목록에서 확인해 주세요.",
        });
        expect(view.invalidateSpy).toHaveBeenCalledWith({ queryKey: clientKeys.detail(42) });
        expect(callbacks.onSuccess).not.toHaveBeenCalled();
        expect(callbacks.onClose).not.toHaveBeenCalled();
    });

    it("toasts a destructive failure when adopting the sent document throws", async () => {
        mockAdoptDocument.mockRejectedValue(new Error("adopt failed"));
        const callbacks = makeCallbacks();
        const { pending } = await startSendAndUnmount(callbacks);

        await act(async () => {
            pending.resolve({
                ok: false,
                outcome: "PARTIALLY_APPLIED",
                remoteDocumentId: "doc-remote-9",
                durationMs: 5,
            });
        });
        await settle();

        expect(mockToast).toHaveBeenCalledTimes(1);
        expect(mockToast).toHaveBeenCalledWith({
            variant: "destructive",
            description: "문서는 전송되었으나 등록에 실패했어요. 계약서 목록에서 상태를 확인해 주세요.",
        });
        expect(callbacks.onSuccess).not.toHaveBeenCalled();
        expect(callbacks.onClose).not.toHaveBeenCalled();
    });

    it("toasts the unverified notice when the outcome is UNKNOWN after unmount", async () => {
        const callbacks = makeCallbacks();
        const { pending } = await startSendAndUnmount(callbacks);

        await act(async () => {
            pending.resolve({
                ok: false,
                reason: "dispatch_uncertain_manual_reconciliation_required",
                fallbackHint: "iframe",
                outcome: "UNKNOWN",
                durationMs: 5,
            });
        });
        await settle();

        expect(mockToast).toHaveBeenCalledTimes(1);
        expect(mockToast).toHaveBeenCalledWith({
            variant: "destructive",
            description:
                "발송 결과를 확인하지 못했어요. 계약서 목록에서 생성 여부를 먼저 확인하고, 확인 전에는 새로 만들지 마세요.",
        });
        expect(mockAdoptDocument).not.toHaveBeenCalled();
        expect(mockOpenDocument).not.toHaveBeenCalled();
        expect(mockGenerateDocument).not.toHaveBeenCalled();
        expect(callbacks.onSuccess).not.toHaveBeenCalled();
        expect(callbacks.onClose).not.toHaveBeenCalled();
    });

    it("toasts a destructive failure when the dispatch throws after unmount", async () => {
        let rejectDispatch!: (error: Error) => void;
        mockDispatchHeadless.mockReturnValue(
            new Promise((_, reject) => {
                rejectDispatch = reject;
            }),
        );
        const callbacks = makeCallbacks();
        const view = renderForm(callbacks);
        fireEvent.click(screen.getByTestId("contract-creation-submit"));
        await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1), { timeout: 5000 });
        view.unmount();

        await act(async () => {
            rejectDispatch(new Error("network down"));
        });
        await settle();

        expect(mockToast).toHaveBeenCalledWith({
            variant: "destructive",
            description:
                "발송 결과를 확인하지 못했어요. 계약서 목록에서 생성 여부를 먼저 확인하고, 확인 전에는 새로 만들지 마세요.",
        });
        expect(mockOpenDocument).not.toHaveBeenCalled();
        expect(callbacks.onSuccess).not.toHaveBeenCalled();
        expect(callbacks.onClose).not.toHaveBeenCalled();
    });

    it("does not toast when the form stays mounted", async () => {
        const callbacks = makeCallbacks();
        mockDispatchHeadless.mockResolvedValue({ ok: true, documentId: "doc-1", durationMs: 5 });
        renderForm(callbacks);
        fireEvent.click(screen.getByTestId("contract-creation-submit"));

        expect(await screen.findByText("계약서가 성공적으로 생성되었습니다.")).toBeInTheDocument();
        expect(mockToast).not.toHaveBeenCalled();
    });
});

describe("ContractCreationForm — success footer", () => {
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
        mockGenerateDocument.mockResolvedValue({ document: { id: "tpl-1" }, user_data: {} });
        mockDispatchHeadless.mockResolvedValue({ ok: true, documentId: "doc-1", durationMs: 5 });
        seedValidContractForm();
    });

    async function renderSucceeded(callbacks = makeCallbacks()) {
        renderForm(callbacks);
        fireEvent.click(screen.getByTestId("contract-creation-submit"));
        await screen.findByTestId("contract-creation-done");
        return callbacks;
    }

    it("shows 새 전자문서 발송 and 완료 at the same size", async () => {
        await renderSucceeded();

        const newSend = screen.getByTestId("contract-creation-new-send");
        const done = screen.getByTestId("contract-creation-done");
        // Equal full-width slots on mobile (service-record StickyActionBar layout),
        // the wizard's compact size from `sm`.
        const sizeClasses = ["w-full", "sm:h-9", "sm:w-auto", "sm:min-w-[calc(132px*var(--glint-ui-scale,1))]"];
        expect(newSend).toHaveClass(...sizeClasses);
        expect(done).toHaveClass(...sizeClasses);
        expect(newSend.parentElement).toHaveClass("grid", "auto-cols-fr", "grid-flow-col", "sm:flex");
        expect(newSend).toHaveAttribute("data-component", "desktop_contracts_creation_new-send");
        expect(done).toHaveAttribute("data-component", "desktop_contracts_creation_done");
        expect(newSend).toHaveTextContent("새 전자문서 발송");
        expect(done).toHaveTextContent("완료");
        // 새 전자문서 발송 is the secondary (outline) button, 완료 the primary one.
        expect(newSend.className).not.toBe(done.className);
        expect(newSend.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByText(/필수 항목 11개 중/)).not.toBeInTheDocument();
    });

    it("calls onSuccess from 완료", async () => {
        const callbacks = await renderSucceeded();

        fireEvent.click(screen.getByTestId("contract-creation-done"));

        expect(callbacks.onSuccess).toHaveBeenCalledTimes(1);
    });

    it("calls onSuccess from 완료 after the notification was dismissed", async () => {
        const callbacks = await renderSucceeded();
        // The notification's own acknowledge already called onSuccess once.
        fireEvent.click(screen.getByRole("button", { name: "확인" }));
        expect(callbacks.onSuccess).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByTestId("contract-creation-done"));

        expect(callbacks.onSuccess).toHaveBeenCalledTimes(2);
    });

    it("falls back to onClose from 완료 when the host passes no onSuccess", async () => {
        const onClose = jest.fn();
        renderForm({ onClose });
        fireEvent.click(screen.getByTestId("contract-creation-submit"));
        await screen.findByTestId("contract-creation-done");

        fireEvent.click(screen.getByTestId("contract-creation-done"));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("keeps 새 전자문서 발송 resetting the wizard to step 0", async () => {
        const callbacks = await renderSucceeded();

        fireEvent.click(screen.getByTestId("contract-creation-new-send"));

        expect(await screen.findByTestId("contract-creation-next")).toBeInTheDocument();
        expect(screen.queryByTestId("contract-creation-done")).not.toBeInTheDocument();
        expect(callbacks.onSuccess).not.toHaveBeenCalled();
    });
});
