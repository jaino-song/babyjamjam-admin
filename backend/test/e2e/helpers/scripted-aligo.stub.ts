import {
    AligoSendSmsParams,
    AligoSmsDeliveryDetailsResult,
    AligoSmsResponse,
    IAligoSmsApiPort,
} from "domain/ports/aligo-sms-api.port";
import { E2eAligoApiStub } from "infrastructure/vendor-stubs/e2e-vendor-stubs";

/** Per-receiver provider outcome scripts for message-automation cron e2e specs. */
export type AligoScriptMode = "accept" | "reject" | "throw" | "carrierFail";

export const SCRIPTED_ALIGO_REJECT_RESULT_CODE = -101;
export const SCRIPTED_ALIGO_REJECT_MESSAGE = "scripted rejection";
export const SCRIPTED_ALIGO_THROW_MESSAGE = "scripted provider failure";
export const SCRIPTED_ALIGO_CARRIER_FAIL_STATE = "가입자없음";

/**
 * Scripted Aligo SMS double for message-automation cron e2e specs.
 *
 * Composes {@link E2eAligoApiStub} for the default behavior (accepted sends
 * with incrementing msg ids, mid → receiver delivery rows, the
 * `…0000` → 가입자없음 convention, fail-closed history lookups and the stub
 * default-sender policy) and layers per-receiver scripts on top:
 *
 * - "accept" (default): identical to E2eAligoApiStub.sendSms.
 * - "reject": provider rejection response (result_code -101, message
 *   "scripted rejection", success_cnt 0, error_cnt = receiver count, msg_id 0)
 *   — the shape classifySmsProviderOutcome classifies as "rejected".
 * - "throw": sendSms rejects with a thrown Error (uncertain dispatch path —
 *   the delivery layer never sees a provider response).
 * - "carrierFail": accept on send, but getSmsDeliveryDetails reports
 *   smsState 가입자없음 for that receiver (carrier delivery failure).
 *
 * Multi-receiver sends (comma-separated receiver) resolve per receiver:
 * any "throw" → throw; else any "reject" → rejection; else accept.
 * The rejection's error_cnt equals the comma-separated receiver count so the
 * delivery classifier still reads "rejected" (not "unknown") for multi-receiver
 * sends; for a single receiver that is exactly error_cnt 1.
 *
 * Keys are digits-only receiver numbers; script() normalizes its input, so
 * formatted numbers ("010-1111-2222") may be used when scripting.
 */
export class ScriptedAligoStub implements IAligoSmsApiPort {
    /** Every sendSms call, in order — including scripted rejections and throws. */
    readonly sendCalls: AligoSendSmsParams[] = [];
    /** Every mid passed to getSmsDeliveryDetails, in order. */
    readonly deliveryDetailCalls: string[] = [];

    private readonly scriptsByReceiver = new Map<string, AligoScriptMode>();
    private base = new E2eAligoApiStub();

    script(receiverDigits: string, mode: AligoScriptMode): void {
        const receiver = toDigits(receiverDigits);
        if (!receiver) {
            throw new Error("ScriptedAligoStub.script requires a receiver containing digits");
        }
        this.scriptsByReceiver.set(receiver, mode);
    }

    clearScripts(): void {
        this.scriptsByReceiver.clear();
    }

    /** Clears scripts, recorded calls, the msg id counter and issued mids. */
    reset(): void {
        this.clearScripts();
        this.sendCalls.length = 0;
        this.deliveryDetailCalls.length = 0;
        this.base = new E2eAligoApiStub();
    }

    listHistory(): Promise<unknown> {
        return this.base.listHistory();
    }

    listSmsHistory(): Promise<unknown> {
        return this.base.listSmsHistory();
    }

    getDefaultSenderPolicy() {
        return this.base.getDefaultSenderPolicy();
    }

    sendSms(params: AligoSendSmsParams): Promise<AligoSmsResponse> {
        this.sendCalls.push(params);
        const receivers = splitReceivers(params.receiver);
        const modes = receivers.map((receiver) => this.scriptsByReceiver.get(receiver));
        if (modes.includes("throw")) {
            return Promise.reject(new Error(SCRIPTED_ALIGO_THROW_MESSAGE));
        }
        if (modes.includes("reject")) {
            return Promise.resolve(this.buildRejectionResponse(params, receivers.length));
        }
        return this.base.sendSms(params);
    }

    async getSmsDeliveryDetails(mid: string): Promise<AligoSmsDeliveryDetailsResult> {
        this.deliveryDetailCalls.push(mid);
        const details = await this.base.getSmsDeliveryDetails(mid);
        return {
            ...details,
            rows: details.rows.map((row) => this.scriptsByReceiver.get(row.receiver) === "carrierFail"
                ? { ...row, smsState: SCRIPTED_ALIGO_CARRIER_FAIL_STATE }
                : row),
        };
    }

    private buildRejectionResponse(params: AligoSendSmsParams, receiverCount: number): AligoSmsResponse {
        return {
            result_code: SCRIPTED_ALIGO_REJECT_RESULT_CODE,
            message: SCRIPTED_ALIGO_REJECT_MESSAGE,
            // Falsy msg_id keeps the delivery layer from scheduling a carrier
            // check for a rejected send (aligoMid resolves to null).
            msg_id: 0,
            msg_type: params.msgType ?? "SMS",
            success_cnt: 0,
            error_cnt: receiverCount,
        };
    }
}

function toDigits(value: string): string {
    return value.replace(/\D/g, "");
}

function splitReceivers(receiver: string): string[] {
    return receiver.split(",").map((value) => toDigits(value)).filter(Boolean);
}
