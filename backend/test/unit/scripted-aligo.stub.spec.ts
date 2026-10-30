import type { AligoSendSmsParams } from "domain/ports/aligo-sms-api.port";
import { classifySmsProviderOutcome } from "application/services/sms-provider-outcome.service";
import {
    SCRIPTED_ALIGO_CARRIER_FAIL_STATE,
    SCRIPTED_ALIGO_REJECT_MESSAGE,
    SCRIPTED_ALIGO_REJECT_RESULT_CODE,
    SCRIPTED_ALIGO_THROW_MESSAGE,
    ScriptedAligoStub,
} from "../e2e/helpers/scripted-aligo.stub";

describe("ScriptedAligoStub", () => {
    let stub: ScriptedAligoStub;

    beforeEach(() => {
        stub = new ScriptedAligoStub();
    });

    function sendParams(receiver: string): AligoSendSmsParams {
        return {
            sender: "01099998888",
            receiver,
            message: "테스트 발송 메시지",
            msgType: "SMS",
        };
    }

    function smsStatesByReceiver(rows: Array<{ receiver: string; smsState: string }>): Map<string, string> {
        return new Map(rows.map((row) => [row.receiver, row.smsState]));
    }

    it("defaults to accept with incrementing msg ids and records every send", async () => {
        const first = await stub.sendSms(sendParams("01011112222"));
        const second = await stub.sendSms(sendParams("01033334444"));

        expect(first).toMatchObject({
            result_code: 1,
            msg_id: 1,
            success_cnt: 1,
            error_cnt: 0,
            msg_type: "SMS",
        });
        expect(second.msg_id).toBe(2);
        expect(stub.sendCalls).toEqual([
            sendParams("01011112222"),
            sendParams("01033334444"),
        ]);
    });

    it("returns the provider-rejection shape for a scripted reject receiver", async () => {
        stub.script("01011112222", "reject");

        const response = await stub.sendSms(sendParams("01011112222"));

        expect(response).toMatchObject({
            result_code: SCRIPTED_ALIGO_REJECT_RESULT_CODE,
            message: SCRIPTED_ALIGO_REJECT_MESSAGE,
            msg_id: 0,
            success_cnt: 0,
            error_cnt: 1,
        });
        // The delivery layer must read this shape as a provider rejection,
        // not an uncertain outcome.
        expect(classifySmsProviderOutcome(
            { request: { receiver: "01011112222" }, response },
            1,
        )).toBe("rejected");
        // A rejection must not consume a msg id from the accept counter.
        const nextAccept = await stub.sendSms(sendParams("01033334444"));
        expect(nextAccept.msg_id).toBe(1);
    });

    it("normalizes formatted receivers when scripting", async () => {
        stub.script("010-1111-2222", "reject");

        const response = await stub.sendSms(sendParams("01011112222"));

        expect(response.result_code).toBe(SCRIPTED_ALIGO_REJECT_RESULT_CODE);
    });

    it("rejects with a thrown error for a scripted throw receiver", async () => {
        stub.script("01011112222", "throw");

        await expect(stub.sendSms(sendParams("01011112222")))
            .rejects.toThrow(SCRIPTED_ALIGO_THROW_MESSAGE);
        expect(stub.sendCalls).toHaveLength(1);
    });

    it("marks carrierFail receivers as 가입자없음 in delivery details while accepting the send", async () => {
        stub.script("01011112222", "carrierFail");

        const sent = await stub.sendSms(sendParams("01011112222,01033334444"));
        expect(sent.result_code).toBe(1);

        const mid = String(sent.msg_id);
        const details = await stub.getSmsDeliveryDetails(mid);
        const states = smsStatesByReceiver(details.rows);
        expect(states.get("01011112222")).toBe(SCRIPTED_ALIGO_CARRIER_FAIL_STATE);
        expect(states.get("01033334444")).toBe("발송완료");
        expect(stub.deliveryDetailCalls).toEqual([mid]);
    });

    it("preserves the …0000 → 가입자없음 convention for unscripted receivers", async () => {
        const sent = await stub.sendSms(sendParams("01055550000,01066667777"));

        const details = await stub.getSmsDeliveryDetails(String(sent.msg_id));
        const states = smsStatesByReceiver(details.rows);
        expect(states.get("01055550000")).toBe(SCRIPTED_ALIGO_CARRIER_FAIL_STATE);
        expect(states.get("01066667777")).toBe("발송완료");
    });

    it("resolves multi-receiver precedence as throw > reject > accept", async () => {
        stub.script("01022223333", "reject");
        stub.script("01033334444", "throw");

        // reject wins over accept
        const rejected = await stub.sendSms(sendParams("01011112222,01022223333"));
        expect(rejected.result_code).toBe(SCRIPTED_ALIGO_REJECT_RESULT_CODE);
        expect(classifySmsProviderOutcome(
            { request: { receiver: "01011112222,01022223333" }, response: rejected },
            2,
        )).toBe("rejected");

        // throw wins over reject
        await expect(stub.sendSms(sendParams("01022223333,01033334444")))
            .rejects.toThrow(SCRIPTED_ALIGO_THROW_MESSAGE);

        // carrierFail still accepts on send
        stub.clearScripts();
        stub.script("01011112222", "carrierFail");
        const accepted = await stub.sendSms(sendParams("01011112222,01044445555"));
        expect(accepted.result_code).toBe(1);
    });

    it("clearScripts removes only scripts and keeps recorded calls", async () => {
        stub.script("01011112222", "reject");
        await stub.sendSms(sendParams("01011112222"));

        stub.clearScripts();

        const accepted = await stub.sendSms(sendParams("01011112222"));
        expect(accepted.result_code).toBe(1);
        expect(stub.sendCalls).toHaveLength(2);
    });

    it("reset clears scripts, recorded calls and the msg id counter", async () => {
        stub.script("01011112222", "reject");
        await stub.sendSms(sendParams("01011112222"));
        await stub.getSmsDeliveryDetails("999");
        expect(stub.sendCalls).toHaveLength(1);
        expect(stub.deliveryDetailCalls).toEqual(["999"]);

        stub.reset();

        expect(stub.sendCalls).toHaveLength(0);
        expect(stub.deliveryDetailCalls).toHaveLength(0);
        const after = await stub.sendSms(sendParams("01011112222"));
        expect(after.result_code).toBe(1);
        expect(after.msg_id).toBe(1);
    });

    it("delegates history lookups and the default-sender policy to the e2e stub behavior", async () => {
        await expect(stub.listHistory()).resolves.toMatchObject({ result_code: -1 });
        await expect(stub.listSmsHistory()).resolves.toMatchObject({ result_code: -1 });
        expect(stub.getDefaultSenderPolicy()).toMatchObject({
            availability: "available",
            provider: "aligo",
            mode: "stub",
        });
    });
});
