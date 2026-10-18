import {
    classifySmsProviderRejection,
    classifySmsProviderOutcome,
} from "application/services/sms-provider-outcome.service";

describe("classifySmsProviderOutcome", () => {
    const createResult = (
        response: Record<string, unknown>,
        receiver = "01012345678",
    ) => ({
        request: { receiver },
        response: {
            message: "provider response",
            ...response,
        },
    });

    it("accepts a complete result-code-one response", () => {
        expect(classifySmsProviderOutcome(
            createResult({ result_code: 1, success_cnt: 1, error_cnt: 0 }),
            1,
        )).toBe("accepted");
    });

    it("accepts numeric response fields represented as strings", () => {
        expect(classifySmsProviderOutcome(
            createResult({ result_code: "1", success_cnt: "1", error_cnt: "0" }),
            1,
        )).toBe("accepted");
    });

    it("classifies a result-code-one partial batch as partial", () => {
        expect(classifySmsProviderOutcome(
            createResult(
                { result_code: 1, success_cnt: 1, error_cnt: 1 },
                "01012345678,01087654321",
            ),
            2,
        )).toBe("partial");
    });

    it("classifies a result-code-one all-failed batch as rejected", () => {
        expect(classifySmsProviderOutcome(
            createResult({ result_code: 1, success_cnt: 0, error_cnt: 1 }),
            1,
        )).toBe("rejected");
    });

    it.each([
        { result_code: 1, success_cnt: 1 },
        { result_code: 1, error_cnt: 0 },
        { result_code: 1, success_cnt: 2, error_cnt: 0 },
        { result_code: 1, success_cnt: 1, error_cnt: "malformed" },
    ])("keeps incomplete or contradictory result-code-one evidence unknown: %j", (response) => {
        expect(classifySmsProviderOutcome(createResult(response), 1)).toBe("unknown");
    });

    it("keeps a negative result with malformed counters unknown", () => {
        expect(classifySmsProviderOutcome(
            createResult({ result_code: -101, success_cnt: -1, error_cnt: 1 }),
            1,
        )).toBe("unknown");
    });

    it("classifies a negative result with absent counters as rejected", () => {
        expect(classifySmsProviderOutcome(
            createResult({ result_code: -101 }),
            1,
        )).toBe("rejected");
    });

    it("keeps a negative result with contradictory counters unknown", () => {
        expect(classifySmsProviderOutcome(
            createResult({ result_code: -101, success_cnt: 1, error_cnt: 0 }),
            1,
        )).toBe("unknown");
    });

    it.each([0, 2, "2"])(
        "keeps unregistered non-negative result code %s unknown",
        (resultCode) => {
            expect(classifySmsProviderOutcome(
                createResult({ result_code: resultCode, success_cnt: 1, error_cnt: 0 }),
                1,
            )).toBe("unknown");
        },
    );

    it("keeps a response whose recipient list does not match the request unknown", () => {
        expect(classifySmsProviderOutcome(
            createResult({ result_code: 1, success_cnt: 1, error_cnt: 0 }, "01012345678,01087654321"),
            1,
        )).toBe("unknown");
    });

    it("keeps a transport-shaped result without a response unknown", () => {
        expect(classifySmsProviderOutcome(
            { request: { receiver: "01012345678" } },
            1,
        )).toBe("unknown");
    });
});

describe("classifySmsProviderRejection", () => {
    it.each([
        [-101, "등록되지 않은 IP 입니다.", "인증 오류"],
        [-999, "잔액이 없습니다", "잔액 부족"],
        [-999, "충전이 필요합니다", "잔액 부족"],
        [-999, "포인트 부족", "잔액 부족"],
        [-999, "수신거부 번호", "수신 거부"],
        [-999, "수신 거부", "수신 거부"],
        [-999, "없는 번호", "잘못된 번호"],
        [-999, "가입자없음", "잘못된 번호"],
        [-999, "수신번호 형식 오류", "잘못된 번호"],
        [-999, "전화번호가 잘못되었습니다", "잘못된 번호"],
        [-999, "잘못된 전화번호", "잘못된 번호"],
        [-999, "수신번호\n형식 오류", "잘못된 번호"],
    ])("classifies %s / %s as permanent", (result_code, message, reason) => {
        expect(classifySmsProviderRejection({ response: { result_code, message } }))
            .toEqual({ kind: "permanent", reason });
    });

    it.each(["일시적인 서버 장애", "전화번호 확인", "형식 오류"])(
        "does not infer permanent failure from unrelated text: %s", (message) => {
            expect(classifySmsProviderRejection({ response: { result_code: -999, message } }))
                .toEqual({ kind: "transient", reason: message });
        },
    );
});
