import type { AligoSmsDeliveryDetailRow } from "domain/ports/aligo-sms-api.port";
import {
    classifyCarrierCheck,
    formatCarrierFailureMessage,
} from "application/services/sms-carrier-check-classifier";

const row = (receiver: string, smsState: string, sendDate: string | null = null): AligoSmsDeliveryDetailRow => ({
    mdid: "1",
    receiver,
    smsState,
    sendDate,
});

describe("classifyCarrierCheck", () => {
    it("is delivered when every receiver succeeded", () => {
        const result = classifyCarrierCheck(
            ["01011112222", "01033334444"],
            [row("01011112222", "발송완료", "2026-10-14 10:00:00"), row("01033334444", "성공")],
        );
        expect(result.outcome).toBe("delivered");
        expect(result.failures).toEqual([]);
        expect(result.unrecognizedStates).toEqual([]);
        expect(result.recipients).toEqual([
            { receiver: "01011112222", smsState: "발송완료", sendDate: "2026-10-14 10:00:00", verdict: "success" },
            { receiver: "01033334444", smsState: "성공", sendDate: null, verdict: "success" },
        ]);
    });

    it("is failed when one receiver failed, recording the failure", () => {
        const result = classifyCarrierCheck(
            ["01011112222", "01033334444"],
            [row("01011112222", "발송완료"), row("01033334444", "가입자없음")],
        );
        expect(result.outcome).toBe("failed");
        expect(result.failures).toEqual([{ receiver: "01033334444", smsState: "가입자없음" }]);
        expect(result.unrecognizedStates).toEqual([]);
    });

    it("is unconfirmed for an empty expected list", () => {
        const result = classifyCarrierCheck([], [row("01011112222", "발송완료")]);
        expect(result.outcome).toBe("unconfirmed");
        expect(result.recipients).toEqual([]);
    });

    it("marks absent receivers missing and is unconfirmed when none failed", () => {
        const result = classifyCarrierCheck(
            ["01011112222", "01033334444"],
            [row("01011112222", "발송완료"), row("01099998888", "가입자없음")],
        );
        expect(result.outcome).toBe("unconfirmed");
        expect(result.recipients.map((r) => r.verdict)).toEqual(["success", "missing"]);
        expect(result.recipients[1]).toMatchObject({ smsState: null, sendDate: null });
        expect(result.failures).toEqual([]);
    });

    it("still reports failed when another receiver is missing", () => {
        const result = classifyCarrierCheck(
            ["01011112222", "01033334444"],
            [row("01011112222", "결번")],
        );
        expect(result.outcome).toBe("failed");
        expect(result.recipients.map((r) => r.verdict)).toEqual(["failure", "missing"]);
    });

    it("consumes one row per expected occurrence when the same number appears twice", () => {
        const result = classifyCarrierCheck(
            ["01011112222", "01011112222"],
            [row("01011112222", "발송완료")],
        );
        expect(result.recipients.map((r) => r.verdict)).toEqual(["success", "missing"]);
        expect(result.outcome).toBe("unconfirmed");

        const both = classifyCarrierCheck(
            ["01011112222", "01011112222"],
            [row("01011112222", "발송완료"), row("01011112222", "스팸차단")],
        );
        expect(both.recipients.map((r) => r.verdict)).toEqual(["success", "failure"]);
        expect(both.outcome).toBe("failed");
    });

    it("treats pending-like states as pending (unconfirmed)", () => {
        const result = classifyCarrierCheck(["01011112222"], [row("01011112222", "전송중")]);
        expect(result.recipients[0]?.verdict).toBe("pending");
        expect(result.outcome).toBe("unconfirmed");
        expect(result.unrecognizedStates).toEqual([]);
    });

    it("treats an empty smsState as pending", () => {
        const result = classifyCarrierCheck(["01011112222"], [row("01011112222", "")]);
        expect(result.recipients[0]).toMatchObject({ smsState: "", verdict: "pending" });
        expect(result.outcome).toBe("unconfirmed");
        expect(result.unrecognizedStates).toEqual([]);
    });

    it("treats an unrecognized state as failure and lists it once", () => {
        const result = classifyCarrierCheck(
            ["01011112222", "01033334444"],
            [row("01011112222", "알수없는상태"), row("01033334444", "알수없는상태")],
        );
        expect(result.outcome).toBe("failed");
        expect(result.failures).toHaveLength(2);
        expect(result.unrecognizedStates).toEqual(["알수없는상태"]);
    });

    it("does not list known failure tokens as unrecognized", () => {
        const result = classifyCarrierCheck(["01011112222"], [row("01011112222", "전원꺼짐/음영지역")]);
        expect(result.outcome).toBe("failed");
        expect(result.unrecognizedStates).toEqual([]);
    });

    it("matches hyphenated and digit-only numbers", () => {
        const result = classifyCarrierCheck(
            ["010-1111-2222"],
            [row("01011112222", "발송완료")],
        );
        expect(result.outcome).toBe("delivered");
        expect(result.recipients[0]?.receiver).toBe("01011112222");

        const reversed = classifyCarrierCheck(["01011112222"], [row("010-1111-2222", "발송완료")]);
        expect(reversed.outcome).toBe("delivered");
    });
});

describe("formatCarrierFailureMessage", () => {
    it("joins the last four digits and states", () => {
        expect(formatCarrierFailureMessage([
            { receiver: "01011111234", smsState: "가입자없음" },
            { receiver: "010-3333-5678", smsState: "결번" },
        ])).toBe("통신사 전달 실패: 1234 가입자없음, 5678 결번");
    });
});
