import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";

import { EFORMSIGN_END_DATE_FIELD_IDS } from "application/usecases/eformsign-doc/eformsign-end-date-field-ids";
import {
    EFORMSIGN_SDK_DATE_UPDATE_AFTER_STATUS_TYPE,
    EFORMSIGN_SDK_DATE_UPDATE_AFTER_STEP_GROUP,
    EFORMSIGN_SDK_DATE_UPDATE_AFTER_STEP_INDEX,
    EFORMSIGN_SDK_DATE_UPDATE_AFTER_STEP_TYPE,
    EFORMSIGN_SDK_DATE_UPDATE_BASELINE_END_DATE,
    EFORMSIGN_SDK_DATE_UPDATE_BASELINE_PDF_SHA256,
    EFORMSIGN_SDK_DATE_UPDATE_BASELINE_RECEIPT_PERIOD,
    EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STATUS_TYPE,
    EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STEP_GROUP,
    EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STEP_INDEX,
    EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STEP_TYPE,
    EFORMSIGN_SDK_DATE_UPDATE_DISPATCH_BRIDGE,
    EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID,
    EFORMSIGN_SDK_DATE_UPDATE_MONEY,
    EFORMSIGN_SDK_DATE_UPDATE_PREFILL_FIELDS,
    EFORMSIGN_SDK_DATE_UPDATE_RECIPIENT_ID,
    EFORMSIGN_SDK_DATE_UPDATE_RECIPIENT_TYPE,
    EFORMSIGN_SDK_DATE_UPDATE_SEND_ACTION,
    EFORMSIGN_SDK_DATE_UPDATE_TARGET_END_DATE,
    EFORMSIGN_SDK_DATE_UPDATE_TARGET_RECEIPT_PERIOD,
    EFORMSIGN_SDK_DATE_UPDATE_TEMPLATE_ID,
    EFORMSIGN_SDK_DATE_UPDATE_USER_EMAIL,
    assertCurrentParticipantSendAdvertised,
    assertDateUpdateAfterSendIdentity,
    assertDateUpdateBaselineFields,
    assertDateUpdateBeforeOpenIdentity,
    assertDateUpdateOnlyAllowedFieldChanges,
    assertDateUpdatePdfDownload,
    assertDateUpdatePrefillOption,
    assertDateUpdateSdkHtml,
    assertDateUpdateTargetFields,
    buildDateUpdatePrefillOption,
    buildDateUpdateSdkHtml,
    normalizeDateUpdateSdkProbeState,
} from "./eformsign-sdk-date-update.live.helper";
import type { SanitizedEformsignActionCallback } from "./eformsign-sdk-capability.live.helper";

function documentFixture(stage: "before" | "after" = "before"): EformsignApiDocumentResponse {
    const after = stage === "after";
    return {
        id: EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID,
        document_number: "date-update-fixture",
        template: { id: EFORMSIGN_SDK_DATE_UPDATE_TEMPLATE_ID, name: "date-update-fixture-template" },
        document_name: "date-update-fixture",
        creator: { recipient_type: "01", id: EFORMSIGN_SDK_DATE_UPDATE_USER_EMAIL, name: "fixture" },
        created_date: 1,
        updated_date: 2,
        current_status: {
            status_type: after ? EFORMSIGN_SDK_DATE_UPDATE_AFTER_STATUS_TYPE : EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STATUS_TYPE,
            step_type: after ? EFORMSIGN_SDK_DATE_UPDATE_AFTER_STEP_TYPE : EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STEP_TYPE,
            step_index: after ? EFORMSIGN_SDK_DATE_UPDATE_AFTER_STEP_INDEX : EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STEP_INDEX,
            step_name: after ? "제공기관 검토" : "제공기관 확인",
            step_recipients: [{
                recipient_type: EFORMSIGN_SDK_DATE_UPDATE_RECIPIENT_TYPE,
                id: EFORMSIGN_SDK_DATE_UPDATE_RECIPIENT_ID,
                name: "fixture-internal-member",
                sms: "",
            }],
            step_group: after ? EFORMSIGN_SDK_DATE_UPDATE_AFTER_STEP_GROUP : EFORMSIGN_SDK_DATE_UPDATE_BEFORE_STEP_GROUP,
            expired_date: 0,
            _expired: false,
        },
        fields: [
            { id: EFORMSIGN_END_DATE_FIELD_IDS.year, value: "27", type: "text" },
            { id: EFORMSIGN_END_DATE_FIELD_IDS.month, value: "01", type: "text" },
            { id: EFORMSIGN_END_DATE_FIELD_IDS.day, value: after ? "06" : "05", type: "text" },
            { id: "서비스 기간", value: after ? "20260709 ~ 20270106" : "20260709 ~ 20270105", type: "text" },
            ...Object.entries(EFORMSIGN_SDK_DATE_UPDATE_MONEY).map(([id, value]) => ({
                id,
                value: value.replace(/(\d)(?=(\d{3})+$)/g, "$1,"),
                type: "number",
            })),
            { id: "본인부담금 수령 년도", value: "26", type: "text" },
            { id: "본인부담금 수령 월", value: "07", type: "text" },
            { id: "본인부담금 수령 일", value: "09", type: "text" },
            { id: "immutable-field", value: "unchanged", type: "text" },
        ],
    };
}

function baseMode02Option(): Record<string, unknown> {
    return {
        company: { id: "company" },
        layout: { lang_code: "ko" },
        user: {
            type: "01",
            id: EFORMSIGN_SDK_DATE_UPDATE_USER_EMAIL,
            access_token: "secret-token",
            refresh_token: "secret-refresh-token",
        },
        mode: {
            type: "02",
            template_id: EFORMSIGN_SDK_DATE_UPDATE_TEMPLATE_ID,
            document_id: EFORMSIGN_SDK_DATE_UPDATE_DOCUMENT_ID,
        },
    };
}

describe("eformsign SDK date-update helper guards", () => {
    it("pins the reviewed Jan05 to Jan06 revision and participant action", () => {
        expect(EFORMSIGN_SDK_DATE_UPDATE_BASELINE_END_DATE).toBe("2027-01-05");
        expect(EFORMSIGN_SDK_DATE_UPDATE_TARGET_END_DATE).toBe("2027-01-06");
        expect(EFORMSIGN_SDK_DATE_UPDATE_BASELINE_RECEIPT_PERIOD).toBe("20260709~20270105");
        expect(EFORMSIGN_SDK_DATE_UPDATE_TARGET_RECEIPT_PERIOD).toBe("20260709~20270106");
        expect(EFORMSIGN_SDK_DATE_UPDATE_BASELINE_PDF_SHA256).toHaveLength(64);
        expect(EFORMSIGN_SDK_DATE_UPDATE_SEND_ACTION).toEqual({ type: "01", code: "22" });
    });

    it("builds exactly the four approved prefill fields and rejects extras", () => {
        const option = buildDateUpdatePrefillOption(baseMode02Option());
        assertDateUpdatePrefillOption(option);
        expect((option["prefill"] as { fields: unknown[] }).fields).toEqual(EFORMSIGN_SDK_DATE_UPDATE_PREFILL_FIELDS);

        const extra = structuredClone(option);
        (extra["prefill"] as { fields: unknown[] }).fields.push({
            id: "immutable-field",
            value: "changed",
            enabled: true,
            required: false,
        });
        expect(() => assertDateUpdatePrefillOption(extra)).toThrow("exactly four");
        expect(() => buildDateUpdatePrefillOption({ ...baseMode02Option(), prefill: { fields: [] } }))
            .toThrow("must not already contain prefill");
    });

    it("uses official document/open wiring and keeps actionCallback observation-only", () => {
        const html = buildDateUpdateSdkHtml(buildDateUpdatePrefillOption(baseMode02Option()));
        expect(() => assertDateUpdateSdkHtml(html)).not.toThrow();
        expect(html).toContain("https://www.eformsign.com/plugins/jquery/jquery.min.js");
        expect(html).toContain("https://www.eformsign.com/lib/js/efs_embedded_v2.js");
        expect(html).toContain("sdk.document(option, iframeId, successCallback, errorCallback, actionCallback)");
        expect(html).toContain(`window[bridgeName]`);
        expect(html).toContain(EFORMSIGN_SDK_DATE_UPDATE_DISPATCH_BRIDGE);
        const callbackStart = html.indexOf("function actionCallback");
        const bridgeStart = html.indexOf("window[bridgeName]");
        expect(html.slice(callbackStart, bridgeStart)).not.toContain("sendAction");
        expect(html).not.toContain("sdk.sendAction({ type: \"01\", code: \"20\" })");
        expect(() => assertDateUpdateSdkHtml(html.replaceAll('code: "22"', 'code: "20"')))
            .toThrow("participant action code 22");
    });

    it("recognizes only fresh advertised code22 and strips callback secrets", () => {
        const state = normalizeDateUpdateSdkProbeState({
            actionCallbacks: [{
                type: "document",
                fn: "actionCallback",
                data: [
                    { name: "func_onload", code: "999", access_token: "secret" },
                    { name: "전송", code: "22", refresh_token: "secret" },
                ],
                access_token: "secret",
            }],
        });
        expect(JSON.stringify(state)).not.toContain("secret");
        expect(state.sendActionAttempted).toBeNull();
        expect(state.sendActionCount).toBeNull();
        expect(assertCurrentParticipantSendAdvertised(state.actionCallbacks)).toEqual([
            { name: "전송", code: "22" },
        ]);
        expect(() => assertCurrentParticipantSendAdvertised([
            { type: "document", fn: "actionCallback", data: [{ name: "func_onload", code: "999" }] },
        ])).toThrow("code 22");
    });

    it("requires exact participant identity before opening and reviewer identity after send", () => {
        const before = documentFixture("before");
        const after = documentFixture("after");
        expect(() => assertDateUpdateBeforeOpenIdentity(before)).not.toThrow();
        expect(() => assertDateUpdateAfterSendIdentity(after)).not.toThrow();
        expect(() => assertDateUpdateBaselineFields(before)).not.toThrow();
        expect(() => assertDateUpdateTargetFields(after)).not.toThrow();

        const wrongRecipient = documentFixture("before");
        wrongRecipient.current_status.step_recipients[0]!.id = "other-member";
        expect(() => assertDateUpdateBeforeOpenIdentity(wrongRecipient)).toThrow("reviewer recipient");

        const wrongStage = documentFixture("before");
        wrongStage.current_status.step_index = "4";
        expect(() => assertDateUpdateBeforeOpenIdentity(wrongStage)).toThrow("reviewed provider stage");

        const wrongGroup = documentFixture("after");
        wrongGroup.current_status.step_group = 4;
        expect(() => assertDateUpdateAfterSendIdentity(wrongGroup)).toThrow("step group");
    });

    it("allows only the four date fields to differ and preserves money/payment values", () => {
        const before = documentFixture("before");
        const after = documentFixture("after");
        expect(() => assertDateUpdateOnlyAllowedFieldChanges(before, after)).not.toThrow();

        const changedImmutable = documentFixture("after");
        changedImmutable.fields!.find((field) => field.id === "immutable-field")!.value = "changed";
        expect(() => assertDateUpdateOnlyAllowedFieldChanges(before, changedImmutable))
            .toThrow("outside the four-field allowlist");

        const changedPayment = documentFixture("after");
        changedPayment.fields!.find((field) => field.id === "본인부담금 수령 일")!.value = "10";
        expect(() => assertDateUpdateOnlyAllowedFieldChanges(before, changedPayment))
            .toThrow("outside the four-field allowlist");

        const changedMoney = documentFixture("after");
        changedMoney.fields!.find((field) => field.id === "서비스 비용")!.value = "1,464,001";
        expect(() => assertDateUpdateOnlyAllowedFieldChanges(before, changedMoney)).toThrow();

        const duplicateReceipt = documentFixture("after");
        duplicateReceipt.fields!.push({ id: "서비스 기간", value: "another", type: "text" });
        expect(() => assertDateUpdateTargetFields(duplicateReceipt)).toThrow("exactly one API value");
    });

    it("rejects non-PDF downloads while keeping PDF proof for later visual review", () => {
        const body = Buffer.from("%PDF-date-update", "ascii");
        expect(() => assertDateUpdatePdfDownload({ status: 200, contentType: "application/pdf", body })).not.toThrow();
        expect(() => assertDateUpdatePdfDownload({ status: 200, contentType: "application/json", body }))
            .toThrow("successful PDF");
    });

    it("keeps the sanitized callback type contract narrow", () => {
        const callbacks: SanitizedEformsignActionCallback[] = [{
            type: "document",
            fn: "actionCallback",
            data: [{ name: "전송", code: "22" }],
        }];
        expect(assertCurrentParticipantSendAdvertised(callbacks)[0]).toEqual({
            name: "전송",
            code: "22",
        });
    });
});
