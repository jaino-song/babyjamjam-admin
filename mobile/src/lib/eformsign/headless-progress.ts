export type HeadlessProgressStepKey = "client-started" | "info-inserted" | "creating" | "sent";

export interface HeadlessProgressState {
    step: HeadlessProgressStepKey | null;
    completed: boolean;
    failed: boolean;
}

export interface HeadlessProgressEvent {
    step: HeadlessProgressStepKey | "failed";
    failedStep?: HeadlessProgressStepKey;
    reason?: string;
}

export interface HeadlessProgressStep {
    key: HeadlessProgressStepKey;
    label: string;
    errorLabel: string;
}

export const CONTRACT_CREATION_PROGRESS_STEPS: readonly HeadlessProgressStep[] = [
    { key: "client-started", label: "전자문서 클라이언트 시작", errorLabel: "전자문서 클라이언트 시작 실패" },
    { key: "info-inserted", label: "이용자 정보 입력 완료", errorLabel: "이용자 정보 입력 실패" },
    { key: "creating", label: "전자문서 생성 중", errorLabel: "전자문서 생성 실패" },
    { key: "sent", label: "전자문서 전송 완료", errorLabel: "전자문서 전송 실패" },
];

export const CONTRACT_FINALIZE_PROGRESS_STEPS: readonly HeadlessProgressStep[] = [
    { key: "client-started", label: "전자문서 클라이언트 시작", errorLabel: "전자문서 클라이언트 시작 실패" },
    { key: "info-inserted", label: "서비스 종료일 적용중", errorLabel: "서비스 종료일 적용 실패" },
    { key: "creating", label: "전자문서 최종 확인중", errorLabel: "전자문서 최종 확인 실패" },
    { key: "sent", label: "전자문서 처리 완료", errorLabel: "전자문서 처리 실패" },
];

export const INITIAL_HEADLESS_PROGRESS: HeadlessProgressState = {
    step: null,
    completed: false,
    failed: false,
};

export function createHeadlessProgressId(prefix = "headless"): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isHeadlessProgressStepKey(
    value: string,
    steps: readonly HeadlessProgressStep[],
): value is HeadlessProgressStepKey {
    return steps.some((item) => item.key === value);
}

export function getSafeHeadlessFailureMessage(reason: string | undefined): string {
    if (!reason) return "백엔드 자동 처리에 실패했습니다. 잠시 후 다시 시도해주세요.";
    if (/timed out|timeout/i.test(reason)) return "백엔드 자동 처리 시간이 초과되었습니다.";
    if (/chromium|browser|executable/i.test(reason)) return "백엔드 브라우저 실행에 실패했습니다.";
    if (/missing document_id/i.test(reason)) return "전자문서 전송 응답에서 문서 ID를 받지 못했습니다.";
    return "백엔드 자동 처리에 실패했습니다.";
}
