import { resolveProblemPresentation } from "./problem-presentation";

describe("public problem presentation", () => {
    it.each(["ko", "ko-KR", "fr", undefined])("falls back safely for %s", (locale) => {
        expect(resolveProblemPresentation(locale)).toEqual({
            unmappedField: "입력 항목",
            checkStatus: "다시 실행하기 전에 작업 상태를 확인해 주세요.",
        });
    });
    it.each(["en", "en-US"])("preserves the status-check meaning in %s", (locale) => {
        expect(resolveProblemPresentation(locale)).toEqual({
            unmappedField: "Input field",
            checkStatus: "Check the operation status before trying again.",
        });
    });
});
