/** Public labels and recovery copy shared by web and mobile error summaries. */
const PROBLEM_PRESENTATION = {
    "ko-KR": {
        unmappedField: "입력 항목",
        checkStatus: "다시 실행하기 전에 작업 상태를 확인해 주세요.",
    },
    "en-US": {
        unmappedField: "Input field",
        checkStatus: "Check the operation status before trying again.",
    },
} as const;

export function resolveProblemPresentation(locale: string | undefined) {
    return PROBLEM_PRESENTATION[locale === "en" || locale === "en-US" ? "en-US" : "ko-KR"];
}
