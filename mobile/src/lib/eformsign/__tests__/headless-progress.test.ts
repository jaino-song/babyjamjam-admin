import {
    CONTRACT_CREATION_PROGRESS_STEPS,
    INITIAL_HEADLESS_PROGRESS,
    SERVICE_RECORD_FINALIZE_PROGRESS_STEPS,
    resolveFailedHeadlessProgress,
    resolveNextHeadlessProgress,
    getHeadlessProviderFailureMessage,
    getSafeHeadlessFailureMessage,
    shouldOpenFinalizeIframe,
} from "../headless-progress";

describe("headless progress transitions", () => {
    it.each([
        "template_workflow_config_invalid",
        "template_workflow_unsupported",
        "template_workflow_config_unavailable",
    ] as const)("keeps %s as a safe actionable pre-send message", (reason) => {
        const message = getHeadlessProviderFailureMessage(reason);

        expect(message).toMatch(/^이번 요청에서 계약서를 발송하지 않았어요\./);
        expect(message).toContain("입력한 고객 정보와 날짜는 그대로 남아 있어요.");
        expect(getSafeHeadlessFailureMessage(reason)).toBe(message);
    });

    it("does not map malformed or unknown reasons", () => {
        expect(getHeadlessProviderFailureMessage("template_workflow_config_invalid ")).toBeNull();
        expect(getHeadlessProviderFailureMessage(undefined)).toBeNull();
    });

    it("omits the service end-date step for service-record finalization", () => {
        expect(SERVICE_RECORD_FINALIZE_PROGRESS_STEPS.map((step) => step.key)).toEqual([
            "client-started",
            "creating",
            "sent",
        ]);
    });

    it("advances steps monotonically", () => {
        const current = {
            step: "info-inserted" as const,
            completed: false,
            failed: false,
        };

        expect(resolveNextHeadlessProgress(
            current,
            "creating",
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toEqual({
            step: "creating",
            completed: false,
            failed: false,
        });
    });

    it("ignores duplicate or older steps", () => {
        const current = {
            step: "creating" as const,
            completed: false,
            failed: false,
        };

        expect(resolveNextHeadlessProgress(
            current,
            "creating",
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toBe(current);
        expect(resolveNextHeadlessProgress(
            current,
            "info-inserted",
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toBe(current);
    });

    it("does not regress completed progress", () => {
        const current = {
            step: "sent" as const,
            completed: true,
            failed: false,
        };

        expect(resolveNextHeadlessProgress(
            current,
            "creating",
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toBe(current);
        expect(resolveFailedHeadlessProgress(
            current,
            "creating",
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toBe(current);
    });

    it("does not overwrite failed progress", () => {
        const current = {
            step: "creating" as const,
            completed: false,
            failed: true,
        };

        expect(resolveNextHeadlessProgress(
            current,
            "sent",
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toBe(current);
        expect(resolveFailedHeadlessProgress(
            current,
            "info-inserted",
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toBe(current);
    });

    it("uses a safe failure fallback step", () => {
        expect(resolveFailedHeadlessProgress(
            INITIAL_HEADLESS_PROGRESS,
            undefined,
            CONTRACT_CREATION_PROGRESS_STEPS,
        )).toEqual({
            step: "client-started",
            completed: false,
            failed: true,
        });
    });

    it("opens the finalize iframe only for an explicit safe backend verdict", () => {
        expect(shouldOpenFinalizeIframe("iframe", false)).toBe(true);
        expect(shouldOpenFinalizeIframe("manual_check", false)).toBe(false);
        expect(shouldOpenFinalizeIframe(undefined, false)).toBe(false);
        expect(shouldOpenFinalizeIframe("iframe", true)).toBe(false);
    });
});
