import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import { EformsignOperationAlreadyRunningError } from "infrastructure/locking/eformsign-operation-lock.service";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";

const RECOVERY_NONE = { action: "NONE", retry: { mode: "NEVER" } } as const;
const RECOVERY_CHECK_STATUS = { action: "CHECK_STATUS", retry: { mode: "NEVER" } } as const;

const TEST_PRINCIPAL = {
    userId: "test-user",
    branchId: "branch-1",
    globalRole: "owner",
    branchRole: "owner",
} as const;

function createCredentialBoundary() {
    return {
        withCredentials: jest.fn(async (
            _principal: unknown,
            _capability: unknown,
            operation: (credentials: { accessToken: string; refreshToken: string }) => unknown,
        ) => operation({ accessToken: "access-token", refreshToken: "refresh-token" })),
    };
}

describe("FinalizeDocumentHeadlessUsecase", () => {
    it("does not start a second finalization for the same document", async () => {
        const headlessService = { dispatchFinalize: jest.fn() };
        const credentialBoundary = createCredentialBoundary();
        const operationLock = {
            runExclusive: jest.fn().mockRejectedValue(new EformsignOperationAlreadyRunningError()),
        };
        const usecase = new FinalizeDocumentHeadlessUsecase(
            { generateStaffDocumentOptions: jest.fn(), fetchDocumentStatusCode: jest.fn() } as never,
            headlessService as never,
            credentialBoundary as never,
            { emit: jest.fn() } as never,
            operationLock as never,
        );

        await expect(usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL)).resolves.toEqual(expect.objectContaining({
            ok: false,
            reason: "operation_in_progress",
            fallbackHint: "manual_check",
            code: "DOCUMENT_FINALIZE_IN_PROGRESS",
            outcome: "NOT_APPLIED",
            recovery: RECOVERY_NONE,
        }));
        expect(credentialBoundary.withCredentials).not.toHaveBeenCalled();
        expect(headlessService.dispatchFinalize).not.toHaveBeenCalled();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it("finalizes a service record without requiring an end-date prefill", async () => {
        const eformsignService = {
            generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }),
        };
        const headlessService = {
            dispatchFinalize: jest.fn().mockResolvedValue({
                ok: true,
                durationMs: 640,
            }),
        };
        const credentialBoundary = createCredentialBoundary();
        const progressService = {
            emit: jest.fn(),
        };
        const documentMirrorService = {
            syncDocument: jest.fn().mockResolvedValue({ status: "synced" }),
        };

        const usecase = new FinalizeDocumentHeadlessUsecase(
            eformsignService as never,
            headlessService as never,
            credentialBoundary as never,
            progressService as never,
            undefined,
            documentMirrorService as never,
        );

        await expect(usecase.execute({
            documentId: "service-record-1",
            progressId: "progress-1",
        }, TEST_PRINCIPAL)).resolves.toEqual({
            ok: true,
            completed: true,
            durationMs: 640,
        });

        expect(eformsignService.generateStaffCompletionOptions).toHaveBeenCalledWith(
            "service-record-1",
            "access-token",
            "refresh-token",
            undefined,
        );
        expect(headlessService.dispatchFinalize).toHaveBeenCalledWith({
            documentOption: { mode: { type: "02" } },
            documentId: "service-record-1",
            onProgress: expect.any(Function),
        });
        expect(documentMirrorService.syncDocument).toHaveBeenCalledWith(
            "service-record-1",
            {
                branchId: "branch-1",
                globalRole: "owner",
                branchRole: "owner",
                userId: "test-user",
            },
            {
                force: true,
                publishChangeReason: "mirror:finalize",
                suppressOutboundAutomation: true,
                strictCompletionReconciliation: true,
            },
        );
    });

    it("retries a post-finalize mirror failure without changing the confirmed vendor result", async () => {
        jest.useFakeTimers();
        const documentMirrorService = {
            syncDocument: jest.fn()
                .mockRejectedValueOnce(new Error("PDF not ready"))
                .mockResolvedValueOnce({ status: "synced" }),
        };
        const usecase = new FinalizeDocumentHeadlessUsecase(
            {
                generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }),
            } as never,
            {
                dispatchFinalize: jest.fn().mockResolvedValue({
                    ok: true,
                    durationMs: 640,
                    gateOutcome: "request-send-clicked",
                }),
            } as never,
            createCredentialBoundary() as never,
            { emit: jest.fn() } as never,
            undefined,
            documentMirrorService as never,
        );

        await expect(usecase.execute({ documentId: "doc-retry" }, TEST_PRINCIPAL)).resolves.toEqual({
            ok: true,
            completed: true,
            durationMs: 640,
        });
        await jest.runAllTimersAsync();

        expect(documentMirrorService.syncDocument).toHaveBeenCalledTimes(2);
    });

    describe("when the run succeeds on the success latch", () => {
        /**
         * The latch exit stops at the SDK callback without necessarily having
         * clicked the popup 전송 that submits. Since the callback's completion
         * code is inferred rather than documented, this path must not be able to
         * report a completion eformsign never performed.
         */
        function buildUsecase(gateOutcome: string | undefined, fetchDocumentStatusCode: jest.Mock) {
            const eformsignService = {
                generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }),
                fetchDocumentStatusCode,
            };
            const headlessService = {
                dispatchFinalize: jest.fn().mockResolvedValue({
                    ok: true,
                    durationMs: 900,
                    ...(gateOutcome ? { gateOutcome } : {}),
                }),
            };
            return new FinalizeDocumentHeadlessUsecase(
                eformsignService as never,
                headlessService as never,
                createCredentialBoundary() as never,
                { emit: jest.fn() } as never,
            );
        }

        it("rejects the run when eformsign has not actually completed the document", async () => {
            // The incident shape: the SDK said success, the popup 전송 was never
            // clicked, and the document sat at 070 (제공기관 검토) untouched.
            jest.useFakeTimers();
            const usecase = buildUsecase("success-latched", jest.fn().mockResolvedValue("070"));

            const result = usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL);
            await jest.runAllTimersAsync();

            await expect(result).resolves.toEqual(
                expect.objectContaining({
                    ok: false,
                    reason: "eformsign reported success without submitting the document",
                    fallbackHint: "iframe",
                    code: "DOCUMENT_FINALIZE_UNCONFIRMED",
                    outcome: "UNKNOWN",
                    recovery: RECOVERY_CHECK_STATUS,
                }),
            );
        });

        it("accepts the run when eformsign confirms the document completed", async () => {
            const usecase = buildUsecase("success-latched", jest.fn().mockResolvedValue("003"));

            await expect(usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL)).resolves.toEqual({
                ok: true,
                completed: true,
                durationMs: 900,
            });
        });

        it("waits for a delayed vendor completion before rejecting a latched success", async () => {
            jest.useFakeTimers();
            const fetchDocumentStatusCode = jest.fn()
                .mockResolvedValueOnce("070")
                .mockResolvedValueOnce("072");
            const usecase = buildUsecase("success-latched", fetchDocumentStatusCode);

            const result = usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL);
            await jest.runAllTimersAsync();

            await expect(result).resolves.toEqual({
                ok: true,
                completed: true,
                durationMs: 900,
            });
            expect(fetchDocumentStatusCode).toHaveBeenCalledTimes(2);
        });

        it("retries an unreadable vendor response before requiring a manual check", async () => {
            jest.useFakeTimers();
            const fetchDocumentStatusCode = jest.fn()
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce("072");
            const usecase = buildUsecase("success-latched", fetchDocumentStatusCode);

            const result = usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL);
            await jest.runAllTimersAsync();

            await expect(result).resolves.toEqual({
                ok: true,
                completed: true,
                durationMs: 900,
            });
            expect(fetchDocumentStatusCode).toHaveBeenCalledTimes(2);
        });

        it("asks for a manual check when the vendor status cannot be read", async () => {
            jest.useFakeTimers();
            const usecase = buildUsecase("success-latched", jest.fn().mockResolvedValue(undefined));

            const result = usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL);
            await jest.runAllTimersAsync();

            await expect(result).resolves.toEqual(
                expect.objectContaining({
                    ok: false,
                    fallbackHint: "manual_check",
                    code: "DOCUMENT_FINALIZE_UNCONFIRMED",
                    outcome: "UNKNOWN",
                    recovery: RECOVERY_CHECK_STATUS,
                }),
            );
        });

        it("trusts a run that clicked the popup 전송 without consulting the vendor", async () => {
            const fetchDocumentStatusCode = jest.fn();
            const usecase = buildUsecase("request-send-clicked", fetchDocumentStatusCode);

            await expect(usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL)).resolves.toEqual({
                ok: true,
                completed: true,
                durationMs: 900,
            });
            expect(fetchDocumentStatusCode).not.toHaveBeenCalled();
        });
    });

    describe("when the run fails after 전송 was clicked", () => {
        /**
         * The gate emits "creating" on the 전송 click, so these runs sit on an
         * unknown side of the submit. Which fallback they earn depends entirely
         * on what eformsign says the document's status actually is.
         */
        function buildUsecase(
            fetchDocumentStatusCode: jest.Mock,
            reachedSend = true,
            fetchDocumentWorkflowState?: jest.Mock,
            sdkReportedSent = false,
        ) {
            const eformsignService = {
                generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }),
                fetchDocumentStatusCode,
                ...(fetchDocumentWorkflowState ? { fetchDocumentWorkflowState } : {}),
            };
            const headlessService = {
                dispatchFinalize: jest.fn().mockImplementation(async ({ onProgress }) => {
                    onProgress?.("client-started");
                    if (reachedSend) onProgress?.("creating");
                    if (sdkReportedSent) onProgress?.("sent");
                    return { ok: false, reason: "gate timeout", durationMs: 31_000 };
                }),
            };
            const progressService = { emit: jest.fn() };

            return {
                progressService,
                usecase: new FinalizeDocumentHeadlessUsecase(
                    eformsignService as never,
                    headlessService as never,
                    createCredentialBoundary() as never,
                    progressService as never,
                ),
            };
        }

        it("reports success when eformsign shows the document already completed", async () => {
            // 072 = doc_accept_reviewer: the finalize landed, only the SDK
            // callback went missing.
            const { usecase, progressService } = buildUsecase(jest.fn().mockResolvedValue("072"));

            await expect(usecase.execute({ documentId: "doc-1", progressId: "p-1" }, TEST_PRINCIPAL)).resolves.toEqual({
                ok: true,
                completed: true,
                durationMs: 31_000,
            });
            expect(progressService.emit).toHaveBeenCalledWith("p-1", "sent");
        });

        it("reports an advanced-but-incomplete provider step distinctly", async () => {
            const fetchDocumentStatusCode = jest.fn();
            const fetchDocumentWorkflowState = jest.fn()
                .mockResolvedValueOnce({
                    statusCode: "060",
                    stepType: "05",
                    stepIndex: "3",
                    stepName: "제공기관 확인",
                })
                .mockResolvedValueOnce({
                    statusCode: "070",
                    stepType: "06",
                    stepIndex: "4",
                    stepName: "제공기관 검토",
                });
            const { usecase, progressService } = buildUsecase(
                fetchDocumentStatusCode,
                true,
                fetchDocumentWorkflowState,
                true,
            );

            await expect(usecase.execute({ documentId: "doc-1", progressId: "p-1" }, TEST_PRINCIPAL))
                .resolves.toEqual({ ok: true, completed: false, durationMs: 31_000 });
            expect(fetchDocumentStatusCode).not.toHaveBeenCalled();
            expect(fetchDocumentWorkflowState).toHaveBeenCalledTimes(2);
            expect(progressService.emit).not.toHaveBeenCalledWith("p-1", "sent");
        });

        /**
         * The dispatch boundary keys its business key on the local row's
         * updatedDate, so an advanced document whose projection still names the
         * consumed generation refuses the very next click as
         * "dispatch_already_accepted". The refresh must therefore be awaited
         * before the caller is told to come back and finish the step.
         */
        it("refreshes the local projection before returning an advanced step", async () => {
            const fetchDocumentWorkflowState = jest.fn()
                .mockResolvedValueOnce({
                    statusCode: "060",
                    stepType: "05",
                    stepIndex: "3",
                    stepName: "제공기관 확인",
                })
                .mockResolvedValueOnce({
                    statusCode: "070",
                    stepType: "06",
                    stepIndex: "4",
                    stepName: "제공기관 검토",
                });
            const documentMirrorService = {
                syncDocument: jest.fn().mockResolvedValue({ status: "synced" }),
            };
            const usecase = new FinalizeDocumentHeadlessUsecase(
                {
                    generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }),
                    fetchDocumentStatusCode: jest.fn(),
                    fetchDocumentWorkflowState,
                } as never,
                {
                    dispatchFinalize: jest.fn().mockImplementation(async ({ onProgress }) => {
                        onProgress?.("client-started");
                        onProgress?.("creating");
                        return { ok: false, reason: "gate timeout", durationMs: 31_000 };
                    }),
                } as never,
                createCredentialBoundary() as never,
                { emit: jest.fn() } as never,
                undefined,
                documentMirrorService as never,
            );

            await expect(usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL))
                .resolves.toEqual({ ok: true, completed: false, durationMs: 31_000 });
            // Awaited, not queued: asserting after the call resolves would pass
            // for a fire-and-forget sync too.
            expect(documentMirrorService.syncDocument).toHaveBeenCalledTimes(1);
            expect(documentMirrorService.syncDocument).toHaveBeenCalledWith(
                "doc-1",
                expect.anything(),
                expect.objectContaining({ force: true }),
            );
        });

        it("treats a terminal rejection as failure instead of workflow advancement", async () => {
            const fetchDocumentWorkflowState = jest.fn()
                .mockResolvedValueOnce({
                    statusCode: "070",
                    stepType: "06",
                    stepIndex: "4",
                    stepName: "제공기관 검토",
                })
                .mockResolvedValueOnce({
                    statusCode: "071",
                    stepType: "06",
                    stepIndex: "4",
                    stepName: "검토 반려",
                });
            const { usecase, progressService } = buildUsecase(
                jest.fn(),
                true,
                fetchDocumentWorkflowState,
            );

            await expect(usecase.execute({ documentId: "doc-1", progressId: "p-1" }, TEST_PRINCIPAL))
                .resolves.toEqual(expect.objectContaining({
                    ok: false,
                    reason: "eformsign_terminal_failure",
                    fallbackHint: "manual_check",
                    code: "EFORMSIGN_TERMINAL_FAILURE",
                    outcome: "FAILED",
                    recovery: RECOVERY_NONE,
                }));
            expect(progressService.emit).not.toHaveBeenCalledWith("p-1", "sent");
        });

        it("requires a manual check when a send was attempted but the step remains pending", async () => {
            // 070 = doc_request_reviewer: still awaiting provider review. The
            // send click already happened, so reopening the iframe could send a
            // duplicate document and is never a safe fallback.
            jest.useFakeTimers();
            const { usecase } = buildUsecase(jest.fn().mockResolvedValue("070"));

            const result = usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL);
            await jest.runAllTimersAsync();

            await expect(result).resolves.toEqual(
                expect.objectContaining({
                    ok: false,
                    fallbackHint: "manual_check",
                    code: "DOCUMENT_FINALIZE_UNCONFIRMED",
                    outcome: "UNKNOWN",
                    recovery: RECOVERY_CHECK_STATUS,
                }),
            );
        });

        it("asks for a manual check when the vendor status cannot be read", async () => {
            jest.useFakeTimers();
            const { usecase } = buildUsecase(jest.fn().mockRejectedValue(new Error("502 Bad Gateway")));

            const result = usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL);
            await jest.runAllTimersAsync();

            await expect(result).resolves.toEqual(
                expect.objectContaining({
                    ok: false,
                    fallbackHint: "manual_check",
                    code: "DOCUMENT_FINALIZE_UNCONFIRMED",
                    outcome: "UNKNOWN",
                    recovery: RECOVERY_CHECK_STATUS,
                }),
            );
        });

        it("keeps a thrown SDK error on manual check after the send callback", async () => {
            const headlessService = {
                dispatchFinalize: jest.fn().mockImplementation(async ({ onProgress }) => {
                    await onProgress?.("creating");
                    throw new Error("headless SDK disconnected");
                }),
            };
            const usecase = new FinalizeDocumentHeadlessUsecase(
                { generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }) } as never,
                headlessService as never,
                createCredentialBoundary() as never,
                { emit: jest.fn() } as never,
            );

            await expect(usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL)).resolves.toEqual(
                expect.objectContaining({
                    ok: false,
                    reason: "headless SDK disconnected",
                    fallbackHint: "manual_check",
                    code: "DOCUMENT_FINALIZE_FAILED",
                    outcome: "NOT_APPLIED",
                    recovery: RECOVERY_NONE,
                }),
            );
        });

        it("does not consult the vendor when the run never reached 전송", async () => {
            const fetchDocumentStatusCode = jest.fn();
            const { usecase } = buildUsecase(fetchDocumentStatusCode, false);

            await expect(usecase.execute({ documentId: "doc-1" }, TEST_PRINCIPAL)).resolves.toEqual(
                expect.objectContaining({
                    ok: false,
                    fallbackHint: "iframe",
                    code: "DOCUMENT_FINALIZE_FAILED",
                    outcome: "NOT_APPLIED",
                    recovery: RECOVERY_NONE,
                }),
            );
            expect(fetchDocumentStatusCode).not.toHaveBeenCalled();
        });
    });
});

/**
 * 040 (doc_request_revoke) is a cancellation REQUEST, not progress and not an ending. It is
 * deliberately non-terminal (a later 060 must still land), so finalize has to handle it by
 * name: a status that merely changed from the starting one must not read as "advanced".
 */
describe("FinalizeDocumentHeadlessUsecase revoke-requested documents", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    const STEP_070 = { statusCode: "070", stepType: "06", stepIndex: "4", stepName: "제공기관 검토" };

    function build(options: {
        workflowStates?: Array<Record<string, string>>;
        statusCodes?: string[];
        localStatusType?: string;
    }) {
        const fetchDocumentWorkflowState = options.workflowStates
            ? options.workflowStates.reduce(
                (mock, state) => mock.mockResolvedValueOnce(state),
                jest.fn(),
            )
            : undefined;
        const fetchDocumentStatusCode = (options.statusCodes ?? []).reduce(
            (mock, code) => mock.mockResolvedValueOnce(code),
            jest.fn(),
        );
        const eformsignService = {
            generateStaffCompletionOptions: jest.fn().mockResolvedValue({ mode: { type: "02" } }),
            fetchDocumentStatusCode,
            ...(fetchDocumentWorkflowState ? { fetchDocumentWorkflowState } : {}),
        };
        const headlessService = {
            dispatchFinalize: jest.fn().mockImplementation(async ({ onProgress }) => {
                onProgress?.("client-started");
                onProgress?.("creating");
                return { ok: false, reason: "gate timeout", durationMs: 31_000 };
            }),
        };
        const dispatchBoundary = {
            claim: jest.fn().mockResolvedValue({
                disposition: "claimed",
                intent: { id: "intent-1", branchId: "branch-1" },
            }),
            markAccepted: jest.fn().mockResolvedValue(null),
            markUncertain: jest.fn().mockResolvedValue(null),
            releaseBeforeSend: jest.fn().mockResolvedValue(null),
        };
        const repository = {
            findByDocumentId: jest.fn().mockResolvedValue({
                id: 42,
                documentId: "doc-1",
                documentKind: EFORMSIGN_DOCUMENT_KIND.CONTRACT,
                clientId: 7,
                employeeScheduleId: null,
                templateId: "template-1",
                statusType: options.localStatusType ?? "070",
                expired: false,
                updatedDate: new Date("2026-10-01T00:00:00.000Z"),
            }),
        };
        const assignmentGuard = { assertAssignedClient: jest.fn().mockResolvedValue({ scheduleId: 1 }) };
        const progressService = { emit: jest.fn() };
        return {
            headlessService,
            dispatchBoundary,
            progressService,
            eformsignService,
            usecase: new FinalizeDocumentHeadlessUsecase(
                eformsignService as never,
                headlessService as never,
                createCredentialBoundary() as never,
                progressService as never,
                undefined,
                undefined,
                repository as never,
                assignmentGuard as never,
                dispatchBoundary as never,
            ),
        };
    }

    async function run(usecase: FinalizeDocumentHeadlessUsecase) {
        jest.useFakeTimers();
        const result = usecase.execute({ documentId: "doc-1", branchId: "branch-1", progressId: "p-1" }, TEST_PRINCIPAL);
        await jest.runAllTimersAsync();
        return result;
    }

    it("does not report a send timeout followed by vendor 040 as an advanced finalize", async () => {
        // Same step metadata, only the status code moved 070 -> 040: before this fix the
        // status change alone read as advancement.
        const { usecase, dispatchBoundary, progressService } = build({
            workflowStates: [STEP_070, ...Array.from({ length: 6 }, () => ({ ...STEP_070, statusCode: "040" }))],
        });

        const result = await run(usecase);

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            reason: "eformsign_revoke_requested",
            fallbackHint: "manual_check",
            code: "DOCUMENT_FINALIZE_UNCONFIRMED",
            outcome: "UNKNOWN",
            recovery: RECOVERY_CHECK_STATUS,
        }));
        expect(result).not.toHaveProperty("completed");
        expect(dispatchBoundary.markAccepted).not.toHaveBeenCalled();
        expect(dispatchBoundary.markUncertain).toHaveBeenCalledTimes(1);
        expect(progressService.emit).not.toHaveBeenCalledWith("p-1", "sent");
    });

    it("applies the same classification when only the status code can be read", async () => {
        const { usecase, dispatchBoundary } = build({
            statusCodes: Array.from({ length: 6 }, () => "040"),
        });

        const result = await run(usecase);

        expect(result).toEqual(expect.objectContaining({
            ok: false,
            reason: "eformsign_revoke_requested",
            fallbackHint: "manual_check",
        }));
        expect(dispatchBoundary.markAccepted).not.toHaveBeenCalled();
    });

    it("still settles a request that the vendor completes (042) as a terminal failure", async () => {
        const { usecase } = build({
            workflowStates: [
                STEP_070,
                { ...STEP_070, statusCode: "040" },
                { ...STEP_070, statusCode: "042" },
            ],
        });

        await expect(run(usecase)).resolves.toEqual(expect.objectContaining({
            ok: false,
            reason: "eformsign_terminal_failure",
            code: "EFORMSIGN_TERMINAL_FAILURE",
        }));
    });

    it("still reports a genuine advancement as advanced and records it", async () => {
        const { usecase, dispatchBoundary } = build({
            workflowStates: [
                { statusCode: "060", stepType: "05", stepIndex: "3", stepName: "제공기관 확인" },
                STEP_070,
            ],
        });

        await expect(run(usecase)).resolves.toEqual({ ok: true, completed: false, durationMs: 31_000 });
        expect(dispatchBoundary.markAccepted).toHaveBeenCalledWith(
            expect.anything(),
            "doc-1",
            { outcome: "advanced" },
        );
    });

    it.each(["040", "doc_request_revoke"])(
        "refuses up front when the local row is already revoke-requested (%s)",
        async (localStatusType) => {
            const { usecase, headlessService, dispatchBoundary } = build({
                workflowStates: [STEP_070],
                localStatusType,
            });

            await expect(run(usecase)).resolves.toEqual(expect.objectContaining({
                ok: false,
                reason: "authorization_denied",
                fallbackHint: "manual_check",
            }));
            expect(headlessService.dispatchFinalize).not.toHaveBeenCalled();
            expect(dispatchBoundary.claim).not.toHaveBeenCalled();
        },
    );
});
