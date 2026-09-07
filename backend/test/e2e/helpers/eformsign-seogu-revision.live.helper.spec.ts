import { stat } from "node:fs/promises";

import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { EFORMSIGN_END_DATE_FIELD_IDS } from "application/usecases/eformsign-doc/eformsign-end-date-field-ids";
import {
    EFORMSIGN_SEOGU_REVISION_BASELINE_END_DATE,
    EFORMSIGN_SEOGU_REVISION_BASELINE_PDF_SHA256,
    EFORMSIGN_SEOGU_REVISION_BASELINE_PERIOD,
    EFORMSIGN_SEOGU_REVISION_DECLINE_COMMENT,
    EFORMSIGN_SEOGU_REVISION_DISPATCH_BRIDGE,
    EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID,
    EFORMSIGN_SEOGU_REVISION_INITIAL_SIGNED_PDF_SHA256,
    EFORMSIGN_SEOGU_REVISION_MONEY,
    EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STATUS_TYPE,
    EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STEP_GROUP,
    EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STEP_INDEX,
    EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STEP_TYPE,
    EFORMSIGN_SEOGU_REVISION_PREFILL_FIELDS,
    EFORMSIGN_SEOGU_REVISION_RECIPIENT_ID,
    EFORMSIGN_SEOGU_REVISION_RECIPIENT_TYPE,
    EFORMSIGN_SEOGU_REVISION_REVIEW_STATUS_TYPE,
    EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_GROUP,
    EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_INDEX,
    EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_TYPE,
    EFORMSIGN_SEOGU_REVISION_SEND_ACTION,
    EFORMSIGN_SEOGU_REVISION_START_DATE,
    EFORMSIGN_SEOGU_REVISION_TARGET_END_DATE,
    EFORMSIGN_SEOGU_REVISION_TARGET_PERIOD,
    EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID,
    EFORMSIGN_SEOGU_REVISION_TEMPLATE_VERSION,
    EFORMSIGN_SEOGU_REVISION_USER_EMAIL,
    assertSeoguRevisionBaselineFields,
    assertSeoguRevisionHistoryPreserved,
    assertSeoguRevisionMode02Option,
    assertSeoguRevisionOnlyAllowedFieldChanges,
    assertSeoguRevisionParticipantDocument,
    assertSeoguRevisionPdfDownload,
    assertSeoguRevisionPrefillOption,
    assertSeoguRevisionReviewerDocument,
    assertSeoguRevisionSdkHtml,
    assertSeoguRevisionSendAdvertised,
    assertSeoguRevisionTemplateTopology,
    buildSeoguRevisionPrefillOption,
    buildSeoguRevisionSdkHtml,
    createSecureSeoguRevisionArtifactDirectory,
    downloadSeoguRevisionPdfWithReadonlyRetry,
    normalizeSeoguRevisionSdkProbeState,
    postSingleSeoguRevisionDecline,
    safeSeoguRevisionErrorReason,
    type SeoguRevisionConfigReader,
    type SeoguRevisionPdfReader,
} from "./eformsign-seogu-revision.live.helper";

const config: SeoguRevisionConfigReader = { get: () => "https://vendor.example.test" };

function templateFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const option = (extra: Record<string, unknown> = {}) => ({
        receipients: [],
        use_reject_restrict: false,
        ...extra,
    });
    return {
        form_id: EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID,
        version: EFORMSIGN_SEOGU_REVISION_TEMPLATE_VERSION,
        config: {
            step_settings: [
                { seq: 1, type: "write", step_group: 1, option: option() },
                { seq: 2, type: "participant", step_group: 3, option: option({ use_receipient_specified: false }) },
                {
                    seq: 3,
                    type: "participant",
                    step_group: EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STEP_GROUP,
                    option: option({
                        receipients: [{ receipient_type: "internal", group: { id: EFORMSIGN_SEOGU_REVISION_RECIPIENT_ID } }],
                        specified_recipient_type: "groupormember",
                        specified_recipient_seq: -1,
                        use_receipient_specified: true,
                    }),
                },
                {
                    seq: 4,
                    type: "reviewer",
                    step_group: EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_GROUP,
                    option: option({
                        specified_recipient_type: "beforewriter",
                        specified_recipient_seq: 3,
                        use_receipient_specified: true,
                    }),
                },
                { seq: 5, type: "complete", step_group: 2, option: option() },
            ],
        },
        ...overrides,
    };
}

function documentFixture(stage: "participant" | "reviewer" = "participant", overrides: Partial<EformsignApiDocumentResponse> = {}): EformsignApiDocumentResponse {
    const reviewer = stage === "reviewer";
    return {
        id: EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID,
        document_number: "seogu-revision-fixture",
        template: { id: EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID, name: "Seogu v12" },
        document_name: "seogu-revision-fixture",
        creator: { recipient_type: "01", id: EFORMSIGN_SEOGU_REVISION_USER_EMAIL, name: "fixture" },
        created_date: 1,
        updated_date: 2,
        current_status: {
            status_type: reviewer ? EFORMSIGN_SEOGU_REVISION_REVIEW_STATUS_TYPE : EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STATUS_TYPE,
            step_type: reviewer ? EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_TYPE : EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STEP_TYPE,
            step_index: reviewer ? EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_INDEX : EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STEP_INDEX,
            step_name: reviewer ? "제공기관 검토" : "제공기관 확인",
            step_recipients: [{
                recipient_type: EFORMSIGN_SEOGU_REVISION_RECIPIENT_TYPE,
                id: EFORMSIGN_SEOGU_REVISION_RECIPIENT_ID,
                name: "fixture-internal-member",
                sms: "",
            }],
            step_group: reviewer ? EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_GROUP : EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STEP_GROUP,
            expired_date: 0,
            _expired: false,
        },
        fields: [
            { id: "계약 시작 년도", value: "26", type: "text" },
            { id: "계약 시작 월", value: "07", type: "text" },
            { id: "계약 시작 일", value: "09", type: "text" },
            { id: EFORMSIGN_END_DATE_FIELD_IDS.year, value: "27", type: "text" },
            { id: EFORMSIGN_END_DATE_FIELD_IDS.month, value: "01", type: "text" },
            { id: EFORMSIGN_END_DATE_FIELD_IDS.day, value: reviewer ? "06" : "05", type: "text" },
            { id: "서비스 기간", value: reviewer ? "20260709 ~ 20270106" : "20260709 ~ 20270105", type: "text" },
            ...Object.entries(EFORMSIGN_SEOGU_REVISION_MONEY).map(([id, value]) => ({
                id,
                value: value.replace(/(\d)(?=(\d{3})+$)/g, "$1,"),
                type: "number",
            })),
            { id: "본인부담금 수령 년도", value: "26", type: "text" },
            { id: "본인부담금 수령 월", value: "07", type: "text" },
            { id: "본인부담금 수령 일", value: "09", type: "text" },
            { id: "immutable-field", value: "unchanged", type: "text" },
        ],
        histories: [
            { action: "send", actor: "fixture", at: 1 },
            { action: "sign", actor: "fixture", at: 2 },
        ],
        ...overrides,
    };
}

function baseMode02Option(): Record<string, unknown> {
    return {
        company: { id: "company" },
        layout: { lang_code: "ko" },
        user: {
            type: "01",
            id: EFORMSIGN_SEOGU_REVISION_USER_EMAIL,
            access_token: "secret-token",
            refresh_token: "secret-refresh-token",
        },
        mode: {
            type: "02",
            template_id: EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID,
            document_id: EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID,
        },
    };
}

describe("eformsign Seogu revision helper guards", () => {
    afterEach(() => jest.restoreAllMocks());

    it("pins the Seogu v12 document, stages, dates, PDF baselines, and participant action", () => {
        expect(EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID).toBe("d5adcc5ecd99431f841151a0c7540759");
        expect(EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID).toBe("1159de2d31fa444d92db3bd25afadd92");
        expect(EFORMSIGN_SEOGU_REVISION_TEMPLATE_VERSION).toBe("12");
        expect(EFORMSIGN_SEOGU_REVISION_BASELINE_END_DATE).toBe("2027-01-05");
        expect(EFORMSIGN_SEOGU_REVISION_TARGET_END_DATE).toBe("2027-01-06");
        expect(EFORMSIGN_SEOGU_REVISION_BASELINE_PERIOD).toBe("20260709~20270105");
        expect(EFORMSIGN_SEOGU_REVISION_TARGET_PERIOD).toBe("20260709~20270106");
        expect(EFORMSIGN_SEOGU_REVISION_START_DATE).toBe("2026-07-09");
        expect(EFORMSIGN_SEOGU_REVISION_BASELINE_PDF_SHA256).toHaveLength(64);
        expect(EFORMSIGN_SEOGU_REVISION_INITIAL_SIGNED_PDF_SHA256).toHaveLength(64);
        expect(EFORMSIGN_SEOGU_REVISION_SEND_ACTION).toEqual({ type: "01", code: "22" });
    });

    it("accepts only the five-step sequential topology with explicit reviewer inheritance", () => {
        expect(assertSeoguRevisionTemplateTopology(templateFixture())).toMatchObject({
            templateId: EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID,
            version: "12",
            stepCount: 5,
            sequential: true,
            parallel: false,
            rejectRestrictionsFalse: true,
            reviewerPreviousSequence: 3,
            participantSequence: 3,
            userParticipantUnselected: true,
        });

        const wrongTemplate = templateFixture({ form_id: "other-template" });
        expect(() => assertSeoguRevisionTemplateTopology(wrongTemplate)).toThrow(/outside the exact allowlist/);
        const wrongVersion = templateFixture({ version: "11" });
        expect(() => assertSeoguRevisionTemplateTopology(wrongVersion)).toThrow(/v12/);
        const duplicateGroups = templateFixture();
        const duplicateConfig = duplicateGroups["config"] as Record<string, unknown>;
        const duplicateSettings = duplicateConfig["step_settings"] as Array<Record<string, unknown>>;
        duplicateSettings[4] = { ...duplicateSettings[4], step_group: EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_GROUP };
        expect(() => assertSeoguRevisionTemplateTopology(duplicateGroups)).toThrow(/parallel step groups/);

        const wrongParticipantGroup = templateFixture();
        const wrongParticipantConfig = wrongParticipantGroup["config"] as Record<string, unknown>;
        const wrongParticipantSettings = wrongParticipantConfig["step_settings"] as Array<Record<string, unknown>>;
        wrongParticipantSettings[2] = { ...wrongParticipantSettings[2], step_group: 8 };
        expect(() => assertSeoguRevisionTemplateTopology(wrongParticipantGroup)).toThrow(/participant step group/);

        const wrongReviewerGroup = templateFixture();
        const wrongReviewerConfig = wrongReviewerGroup["config"] as Record<string, unknown>;
        const wrongReviewerSettings = wrongReviewerConfig["step_settings"] as Array<Record<string, unknown>>;
        wrongReviewerSettings[3] = { ...wrongReviewerSettings[3], step_group: 9 };
        expect(() => assertSeoguRevisionTemplateTopology(wrongReviewerGroup)).toThrow(/reviewer step group/);
    });

    it("requires the exact participant/reviewer stage, recipient, and expiry", () => {
        expect(() => assertSeoguRevisionParticipantDocument(documentFixture("participant"))).not.toThrow();
        expect(() => assertSeoguRevisionReviewerDocument(documentFixture("reviewer"))).not.toThrow();

        const wrongStage = documentFixture("participant");
        wrongStage.current_status.step_index = "4";
        expect(() => assertSeoguRevisionParticipantDocument(wrongStage)).toThrow(/reviewed provider stage/);

        const wrongRecipient = documentFixture("reviewer");
        wrongRecipient.current_status.step_recipients[0]!.id = "other-member";
        expect(() => assertSeoguRevisionReviewerDocument(wrongRecipient)).toThrow(/exact allowlist/);

        const expired = documentFixture("reviewer");
        expired.current_status.expired_date = 7;
        expect(() => assertSeoguRevisionReviewerDocument(expired)).toThrow(/exact allowlist/);
    });

    it("pins baseline and target date vectors while accepting comma-formatted money", () => {
        const before = documentFixture("participant");
        const after = documentFixture("reviewer");
        expect(() => assertSeoguRevisionBaselineFields(before)).not.toThrow();
        expect(() => assertSeoguRevisionOnlyAllowedFieldChanges(before, after)).not.toThrow();

        const changedImmutable = documentFixture("reviewer");
        changedImmutable.fields!.find((field) => field.id === "immutable-field")!.value = "changed";
        expect(() => assertSeoguRevisionOnlyAllowedFieldChanges(before, changedImmutable)).toThrow(/outside the four-field allowlist/);

        const changedMoney = documentFixture("reviewer");
        changedMoney.fields!.find((field) => field.id === "서비스 비용")!.value = "1,464,001";
        expect(() => assertSeoguRevisionOnlyAllowedFieldChanges(before, changedMoney)).toThrow();

        const duplicatePeriod = documentFixture("reviewer");
        duplicatePeriod.fields!.push({ id: "서비스 기간", value: EFORMSIGN_SEOGU_REVISION_TARGET_PERIOD, type: "text" });
        expect(() => assertSeoguRevisionOnlyAllowedFieldChanges(before, duplicatePeriod)).toThrow(/exactly one API value/);

        const removedHistory = documentFixture("reviewer");
        removedHistory.histories = [{ action: "send", actor: "fixture", at: 1 }];
        expect(() => assertSeoguRevisionHistoryPreserved(before, removedHistory)).toThrow(/removed or changed/);

        const appendedHistory = documentFixture("reviewer");
        appendedHistory.histories = [...(before.histories ?? []), { action: "decline", actor: "fixture", at: 3 }];
        expect(() => assertSeoguRevisionHistoryPreserved(before, appendedHistory)).not.toThrow();
    });

    it("rejects an after-query response with only part of the end-date vector updated", () => {
        const before = documentFixture("participant");
        const partialAfter = documentFixture("reviewer");
        const endDay = partialAfter.fields?.find((field) => field.id === EFORMSIGN_END_DATE_FIELD_IDS.day);
        if (!endDay) throw new Error("fixture end date day is missing");
        endDay.value = "05";

        expect(() => assertSeoguRevisionOnlyAllowedFieldChanges(before, partialAfter)).toThrow(/target fields were not at Jan06/);
    });

    it("builds only the four approved prefill fields and rejects writer-route options", () => {
        const option = buildSeoguRevisionPrefillOption(baseMode02Option());
        assertSeoguRevisionMode02Option(baseMode02Option());
        assertSeoguRevisionPrefillOption(option);
        expect(option["prefill"]).toEqual({ fields: EFORMSIGN_SEOGU_REVISION_PREFILL_FIELDS });

        const extra = structuredClone(option);
        (extra["prefill"] as { fields: unknown[] }).fields.push({ id: "immutable-field", value: "changed", enabled: true, required: false });
        expect(() => assertSeoguRevisionPrefillOption(extra)).toThrow(/exactly four/);

        expect(() => assertSeoguRevisionMode02Option({
            ...baseMode02Option(),
            mode: { ...(baseMode02Option()["mode"] as Record<string, unknown>), type: "01" },
        })).toThrow(/mode02/);
        expect(() => assertSeoguRevisionMode02Option({
            ...baseMode02Option(),
            mode: { ...(baseMode02Option()["mode"] as Record<string, unknown>), request_type: "doc_update" },
        })).toThrow(/writer update route/);
    });

    it("uses official SDK wiring, ignores onload 999, and gates code22 once", () => {
        const html = buildSeoguRevisionSdkHtml(optionWithPrefill());
        expect(() => assertSeoguRevisionSdkHtml(html)).not.toThrow();
        expect(html).toContain("https://www.eformsign.com/plugins/jquery/jquery.min.js");
        expect(html).toContain("https://www.eformsign.com/lib/js/efs_embedded_v2.js");
        expect(html).toContain(EFORMSIGN_SEOGU_REVISION_DISPATCH_BRIDGE);
        expect(html).not.toContain(".click(");
        expect(html).not.toContain("doc_update");

        const callbackStart = html.indexOf("function actionCallback");
        const bridgeStart = html.indexOf("window[bridgeName]");
        expect(html.slice(callbackStart, bridgeStart)).not.toContain("sendAction");
        expect(() => assertSeoguRevisionSdkHtml(html.replaceAll('code: "22"', 'code: "20"'))).toThrow(/code 22/);

        const state = normalizeSeoguRevisionSdkProbeState({
            actionCallbacks: [{
                type: "document",
                fn: "actionCallback",
                data: [
                    { name: "func_onload", code: "999", access_token: "secret" },
                    { name: "arbitrary vendor label", code: "22", refresh_token: "secret" },
                ],
                access_token: "secret",
            }],
            sendActionAttempted: true,
            sendActionCount: 1,
            sendActionType: "01",
            sendActionCode: "22",
        });
        expect(JSON.stringify(state)).not.toContain("secret");
        expect(assertSeoguRevisionSendAdvertised(state.actionCallbacks)).toEqual([{ name: "arbitrary vendor label", code: "22" }]);
        expect(() => assertSeoguRevisionSendAdvertised([
            { type: "document", fn: "actionCallback", data: [{ name: "func_onload", code: "999" }] },
        ])).toThrow(/code 22/);
    });

    it("sends exactly one decline comment without previous_steps and never retries", async () => {
        const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ document_id: EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID }),
        } as Response);
        const evidence = await postSingleSeoguRevisionDecline(config, "token");
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`https://vendor.example.test/v2.0/api/documents/${EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID}/decline`);
        expect(init.method).toBe("POST");
        expect(init.redirect).toBe("error");
        expect(JSON.parse(String(init.body))).toEqual({ comment: EFORMSIGN_SEOGU_REVISION_DECLINE_COMMENT });
        expect(JSON.parse(String(init.body))).not.toHaveProperty("previous_steps");
        expect(evidence).toMatchObject({ attempted: true, responseReceived: true, httpSuccess: true, responseIdMatches: true, transportError: false });

        fetchSpy.mockReset().mockRejectedValue(new Error("network"));
        await expect(postSingleSeoguRevisionDecline(config, "token")).resolves.toMatchObject({ transportError: true });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        await expect(postSingleSeoguRevisionDecline(config, "token", "other-document")).rejects.toThrow(/exact allowlist/);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("accepts PDFs only and retries read-only generated output a bounded number of times", async () => {
        const body = Buffer.from("%PDF-seogu-revision", "ascii");
        expect(() => assertSeoguRevisionPdfDownload({ status: 200, contentType: "application/pdf", body })).not.toThrow();
        expect(() => assertSeoguRevisionPdfDownload({ status: 200, contentType: "application/json", body })).toThrow(/successful PDF/);

        let calls = 0;
        const reader: SeoguRevisionPdfReader = {
            downloadDocumentFile: async () => {
                calls += 1;
                if (calls < 3) return { status: 503, contentType: "application/json", contentDisposition: null, body: Buffer.from("processing") };
                return { status: 200, contentType: "application/pdf", contentDisposition: null, body };
            },
        };
        await expect(downloadSeoguRevisionPdfWithReadonlyRetry(reader, "token")).resolves.toMatchObject({ attempts: 3, statuses: [503, 503, 200], body });
        expect(calls).toBe(3);

        let refusalCalls = 0;
        const refusal: SeoguRevisionPdfReader = {
            downloadDocumentFile: async () => {
                refusalCalls += 1;
                return { status: 503, contentType: "application/json", contentDisposition: null, body: Buffer.from("processing") };
            },
        };
        await expect(downloadSeoguRevisionPdfWithReadonlyRetry(refusal, "token")).rejects.toThrow(/successful PDF/);
        expect(refusalCalls).toBe(3);
    });

    it("retries transient non-PDF 200 responses, stops on nonretryable status, and enforces the document allowlist", async () => {
        const body = Buffer.from("%PDF-seogu-revision-ready", "ascii");
        let transientCalls = 0;
        const transientReader: SeoguRevisionPdfReader = {
            downloadDocumentFile: async () => {
                transientCalls += 1;
                if (transientCalls < 3) {
                    return {
                        status: 200,
                        contentType: "application/json",
                        contentDisposition: null,
                        body: Buffer.from('{"state":"processing"}', "ascii"),
                    };
                }
                return { status: 200, contentType: "application/pdf", contentDisposition: null, body };
            },
        };
        await expect(downloadSeoguRevisionPdfWithReadonlyRetry(transientReader, "offline-token")).resolves.toMatchObject({
            attempts: 3,
            statuses: [200, 200, 200],
            body,
        });
        expect(transientCalls).toBe(3);

        let nonPdfExhaustionCalls = 0;
        const nonPdfExhaustionReader: SeoguRevisionPdfReader = {
            downloadDocumentFile: async () => {
                nonPdfExhaustionCalls += 1;
                return {
                    status: 200,
                    contentType: "application/json",
                    contentDisposition: null,
                    body: Buffer.from('{"state":"processing"}', "ascii"),
                };
            },
        };
        await expect(downloadSeoguRevisionPdfWithReadonlyRetry(nonPdfExhaustionReader, "offline-token")).rejects.toThrow(/successful PDF/);
        expect(nonPdfExhaustionCalls).toBe(3);

        let nonretryableCalls = 0;
        const nonretryableReader: SeoguRevisionPdfReader = {
            downloadDocumentFile: async () => {
                nonretryableCalls += 1;
                return {
                    status: 401,
                    contentType: "application/json",
                    contentDisposition: null,
                    body: Buffer.from("unauthorized", "ascii"),
                };
            },
        };
        await expect(downloadSeoguRevisionPdfWithReadonlyRetry(nonretryableReader, "offline-token")).rejects.toThrow(/successful PDF/);
        expect(nonretryableCalls).toBe(1);

        const allowlistReader: SeoguRevisionPdfReader = { downloadDocumentFile: jest.fn() };
        await expect(downloadSeoguRevisionPdfWithReadonlyRetry(allowlistReader, "offline-token", "other-document"))
            .rejects.toThrow(/outside the exact allowlist/);
        expect(allowlistReader.downloadDocumentFile).not.toHaveBeenCalled();
    });

    it("accepts a syntactically valid stale PDF immediately while leaving freshness unproven", async () => {
        const staleBody = Buffer.from("%PDF-stale-baseline", "ascii");
        const reader: SeoguRevisionPdfReader = {
            downloadDocumentFile: jest.fn().mockResolvedValue({
                status: 200,
                contentType: "application/pdf",
                contentDisposition: null,
                body: staleBody,
            }),
        };

        await expect(downloadSeoguRevisionPdfWithReadonlyRetry(reader, "offline-token")).resolves.toEqual({
            attempts: 1,
            statuses: [200],
            body: staleBody,
        });
        expect(reader.downloadDocumentFile).toHaveBeenCalledTimes(1);
        // Format validation does not compare document content or prove that this output is fresh.
    });

    it("sanitizes unknown failures without exposing response details", () => {
        expect(safeSeoguRevisionErrorReason(new Error("secret-token response body"), "probe")).toBe("probe failed (Error)");
        expect(safeSeoguRevisionErrorReason({ status: 503, vendorCode: "X" }, "pdf")).toBe("pdf returned vendor status 503 (X)");
    });

    it("creates mode-safe artifact directories", async () => {
        const directory = await createSecureSeoguRevisionArtifactDirectory();
        expect((await stat(directory)).mode & 0o777).toBe(0o700);
    });
});

function optionWithPrefill(): Record<string, unknown> {
    return buildSeoguRevisionPrefillOption(baseMode02Option());
}
