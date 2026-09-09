import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";

import {
    EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID,
    EFORMSIGN_SDK_CAPABILITY_RECIPIENT_ID,
    EFORMSIGN_SDK_CAPABILITY_RECIPIENT_TYPE,
    EFORMSIGN_SDK_CAPABILITY_STATUS_TYPE,
    EFORMSIGN_SDK_CAPABILITY_STEP_INDEX,
    EFORMSIGN_SDK_CAPABILITY_STEP_TYPE,
    EFORMSIGN_SDK_CAPABILITY_TEMPLATE_ID,
    EFORMSIGN_SDK_CAPABILITY_USER_EMAIL,
    getAdvertisedOperationalActions,
    assertEformsignSdkDocumentIdentity,
    assertEformsignSdkSnapshotsEqual,
    assertPdfDownload,
    assertReadonlyMode02Option,
    assertReadonlySdkHtml,
    buildReadonlySdkHtml,
    hashPdfBody,
    readEformsignSdkDocumentSnapshot,
    sanitizeActionCallback,
} from "./helpers/eformsign-sdk-capability.live.helper";

function documentFixture(): EformsignApiDocumentResponse {
    return {
        id: EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID,
        document_number: "probe-document-number",
        template: {
            id: EFORMSIGN_SDK_CAPABILITY_TEMPLATE_ID,
            name: "probe-template",
        },
        document_name: "probe-document",
        creator: {
            recipient_type: "01",
            id: EFORMSIGN_SDK_CAPABILITY_USER_EMAIL,
            name: "probe-creator",
        },
        created_date: 1,
        updated_date: 2,
        current_status: {
            status_type: EFORMSIGN_SDK_CAPABILITY_STATUS_TYPE,
            step_type: EFORMSIGN_SDK_CAPABILITY_STEP_TYPE,
            step_index: EFORMSIGN_SDK_CAPABILITY_STEP_INDEX,
            step_name: "probe-review",
            step_recipients: [{
                recipient_type: EFORMSIGN_SDK_CAPABILITY_RECIPIENT_TYPE,
                id: EFORMSIGN_SDK_CAPABILITY_RECIPIENT_ID,
                name: "probe-reviewer",
                sms: "",
            }],
            step_group: 1,
            expired_date: 0,
            _expired: false,
        },
        fields: [
            { id: "field-a", value: "value-a", type: "text" },
            { id: "field-b", value: "value-b", type: "text" },
        ],
    };
}

describe("eformsign SDK capability probe guards", () => {
    it("keeps only actionCallback name/code pairs and drops unknown payload data", () => {
        const sanitized = sanitizeActionCallback({
            type: "document",
            fn: "actionCallback",
            data: [
                {
                    name: "btn_approvalReject",
                    code: "10",
                    access_token: "sensitive-callback-value",
                },
                { name: "", code: "" },
                { name: "n".repeat(500), code: 99, extra: "discarded" },
            ],
            access_token: "sensitive-callback-value",
        });

        expect(sanitized).toEqual({
            type: "document",
            fn: "actionCallback",
            data: [
                { name: "btn_approvalReject", code: "10" },
                { name: "n".repeat(160), code: "99" },
            ],
        });
        expect(JSON.stringify(sanitized)).not.toContain("sensitive-callback-value");
        expect(sanitizeActionCallback({ fn: "successCallback", data: [] })).toBeNull();
    });

    it("keeps normal load callback codes separate from advertised operational actions", () => {
        const loadCallback = sanitizeActionCallback({
            type: "document",
            fn: "actionCallback",
            data: [{ name: "func_onload", code: "999" }, { name: "normal", code: "99" }],
        });
        const operationalCallback = sanitizeActionCallback({
            type: "document",
            fn: "actionCallback",
            data: [{ name: "btn_approvalReject", code: "10" }],
        });
        if (!loadCallback || !operationalCallback) throw new Error("fixture callbacks were not sanitized");

        expect(getAdvertisedOperationalActions([loadCallback, operationalCallback])).toEqual([
            { name: "btn_approvalReject", code: "10" },
        ]);
    });

    it("builds an official SDK page with only document registration and open", () => {
        const html = buildReadonlySdkHtml({
            mode: { type: "02" },
            layout: { viewer_toolbar: { "toolbar.save": "false" } },
        });

        expect(() => assertReadonlySdkHtml(html)).not.toThrow();
        expect(html).toContain("https://www.eformsign.com/plugins/jquery/jquery.min.js");
        expect(html).toContain("https://www.eformsign.com/lib/js/efs_embedded_v2.js");
        expect(html).toContain("sdk.document(option, iframeId, successCallback, errorCallback, actionCallback)");
        expect(html).toContain("sdk.open();");
    });

    it("requires the exact read-only mode02 option and omits prefill", () => {
        assertReadonlyMode02Option({
            mode: {
                type: "02",
                document_id: EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID,
                template_id: EFORMSIGN_SDK_CAPABILITY_TEMPLATE_ID,
            },
            user: {
                type: "01",
                id: EFORMSIGN_SDK_CAPABILITY_USER_EMAIL,
                access_token: "access-token",
                refresh_token: "refresh-token",
            },
        });

        expect(() => assertReadonlyMode02Option({
            mode: {
                type: "02",
                document_id: EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID,
                template_id: EFORMSIGN_SDK_CAPABILITY_TEMPLATE_ID,
            },
            user: { type: "01", id: EFORMSIGN_SDK_CAPABILITY_USER_EMAIL },
            prefill: { fields: [] },
        })).toThrow("must not prefill");
    });

    it("fails closed when the reviewed document identity or stage changes", () => {
        const before = documentFixture();
        const baseline = assertEformsignSdkDocumentIdentity(before);
        expect(baseline.fieldCount).toBe(2);
        expect(baseline.recipientCount).toBe(1);

        const wrongStage = documentFixture();
        wrongStage.current_status.step_index = "3";
        expect(() => assertEformsignSdkDocumentIdentity(wrongStage)).toThrow("reviewed provider stage");

        const wrongRecipient = documentFixture();
        wrongRecipient.current_status.step_recipients[0]!.id = "other-reviewer";
        expect(() => assertEformsignSdkDocumentIdentity(wrongRecipient)).toThrow("reviewer recipient");

        const extraRecipient = documentFixture();
        extraRecipient.current_status.step_recipients.push({
            recipient_type: EFORMSIGN_SDK_CAPABILITY_RECIPIENT_TYPE,
            id: EFORMSIGN_SDK_CAPABILITY_RECIPIENT_ID,
            name: "duplicate-reviewer",
            sms: "",
        });
        expect(() => assertEformsignSdkDocumentIdentity(extraRecipient)).toThrow("reviewer recipient");

        const wrongRecipientType = documentFixture();
        wrongRecipientType.current_status.step_recipients[0]!.recipient_type = "outsider";
        expect(() => assertEformsignSdkDocumentIdentity(wrongRecipientType)).toThrow("reviewer recipient");

        const expired = documentFixture();
        expired.current_status._expired = true;
        expect(() => assertEformsignSdkDocumentIdentity(expired)).toThrow("reviewer recipient");

        const wrongTemplate = documentFixture();
        wrongTemplate.template.id = "other-template";
        expect(() => assertEformsignSdkDocumentIdentity(wrongTemplate)).toThrow("template id");
    });

    it("detects any field or stage change in the immutable before/after snapshot", () => {
        const before = readEformsignSdkDocumentSnapshot(documentFixture());
        const same = readEformsignSdkDocumentSnapshot(documentFixture());
        expect(() => assertEformsignSdkSnapshotsEqual(before, same)).not.toThrow();

        const changedField = documentFixture();
        changedField.fields![0]!.value = "changed";
        expect(() => assertEformsignSdkSnapshotsEqual(
            before,
            readEformsignSdkDocumentSnapshot(changedField),
        )).toThrow("changed document fields");

        const changedStage = documentFixture();
        changedStage.current_status.step_name = "changed-stage";
        expect(() => assertEformsignSdkSnapshotsEqual(
            before,
            readEformsignSdkDocumentSnapshot(changedStage),
        )).toThrow("changed document fields");
    });

    it("accepts only a successful PDF response with a PDF signature", () => {
        const body = Buffer.from("%PDF-probe", "ascii");
        assertPdfDownload({
            status: 200,
            contentType: "application/pdf",
            body,
        });
        expect(hashPdfBody(body)).toHaveLength(64);
        expect(() => assertPdfDownload({
            status: 200,
            contentType: "application/json",
            body,
        })).toThrow("successful PDF");
    });
});
