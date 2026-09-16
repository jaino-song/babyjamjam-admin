import { captureProtectedPhoneCandidates } from "./protected-input.helper";

describe("protected phone input", () => {
    it("normalizes one supported phone and issues a candidate reference", () => {
        const result = captureProtectedPhoneCandidates("연락처: 010-1234-5678");

        expect(result.selectionNeeded).toBe(false);
        expect(result.normalizedPhone).toBe("01012345678");
        expect(result.selectedCandidateRef).toMatch(/^[0-9a-f-]{36}$/);
        expect(result.candidates).toEqual([
            { candidateRef: result.selectedCandidateRef, normalizedPhone: "01012345678" },
        ]);
    });

    it("returns all distinct candidates and never picks the last one", () => {
        const result = captureProtectedPhoneCandidates("010-1234-5678 또는 010 9876 5432");

        expect(result.selectionNeeded).toBe(true);
        expect(result.normalizedPhone).toBeUndefined();
        expect(result.selectedCandidateRef).toBeUndefined();
        expect(result.candidates.map((candidate) => candidate.normalizedPhone)).toEqual([
            "01012345678",
            "01098765432",
        ]);
    });

    it("does not auto-select a valid number when an incomplete correction is present", () => {
        const result = captureProtectedPhoneCandidates("기존 010-1234-5678, 정정 010-123");

        expect(result.selectionNeeded).toBe(true);
        expect(result.normalizedPhone).toBeUndefined();
        expect(result.selectedCandidateRef).toBeUndefined();
        expect(result.candidates.map((candidate) => candidate.normalizedPhone)).toEqual(["01012345678"]);
    });

    it("does not extract an eleven-digit substring from an overlong numeric token", () => {
        const result = captureProtectedPhoneCandidates("연락처 010123456789");

        expect(result).toEqual({ candidates: [], selectionNeeded: true });
    });

    it("does not persist or return raw text for unsupported input", () => {
        expect(captureProtectedPhoneCandidates("전화번호는 비공개입니다")).toEqual({
            candidates: [],
            selectionNeeded: false,
        });
    });

    it("marks a phone-like but incomplete correction as needing selection", () => {
        expect(captureProtectedPhoneCandidates("010-123-4567")).toEqual({ candidates: [], selectionNeeded: true });
    });
});
