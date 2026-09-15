import {
    CONTRACT_CREATION_PROGRESS_STEPS,
    INITIAL_HEADLESS_PROGRESS,
    SERVICE_RECORD_FINALIZE_PROGRESS_STEPS,
    getSafeHeadlessFailureMessage,
    resolveFailedHeadlessProgress,
    resolveNextHeadlessProgress,
    shouldOpenFinalizeIframe,
} from "../headless-progress";

describe("headless progress transitions", () => {
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

describe("getSafeHeadlessFailureMessage", () => {
    it("maps registered contract-send guard codes to Korean copy", () => {
        expect(getSafeHeadlessFailureMessage("CLIENT_ASSIGNMENT_REQUIRED"))
            .toBe("고객의 제공인력 배정을 먼저 저장한 뒤 다시 시도해 주세요.");
        expect(getSafeHeadlessFailureMessage("DOCUMENT_PROVIDER_MISMATCH"))
            .toBe("전자문서의 제공인력과 고객 배정 정보가 일치하지 않아요. 배정을 확인해 주세요.");
        expect(getSafeHeadlessFailureMessage("CLIENT_SERVICE_TERMINATED"))
            .toBe("해지된 고객에게는 전자문서를 발송할 수 없어요.");
    });

    it("keeps the existing fallbacks for unknown reasons", () => {
        expect(getSafeHeadlessFailureMessage(undefined))
            .toBe("백엔드 자동 처리에 실패했어요. 잠시 후 다시 시도해 주세요");
        expect(getSafeHeadlessFailureMessage("headless dispatch timed out after 130000ms"))
            .toBe("백엔드 자동 처리 시간이 초과됐어요");
        expect(getSafeHeadlessFailureMessage("failed to launch chromium executable"))
            .toBe("백엔드 브라우저를 실행하지 못했어요");
        expect(getSafeHeadlessFailureMessage("missing document_id in success callback"))
            .toBe("전자문서 전송 응답에서 문서 ID를 받지 못했어요");
        expect(getSafeHeadlessFailureMessage("mystery failure"))
            .toBe("백엔드 자동 처리에 실패했어요");
    });
});
