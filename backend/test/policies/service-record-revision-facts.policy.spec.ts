import {
    captureServiceRecordRevisionFacts,
    type ServiceRecordRevisionFactsDocument,
    type ServiceRecordRevisionFactsInput,
} from "application/policies/service-record-revision-facts.policy";

const BRANCH_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = 101;
const DOCUMENT_ID = "contract-document-1";
const TOKEN_ID = "22222222-2222-4222-8222-222222222222";

function detail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: DOCUMENT_ID,
        template: { id: "contract-template", name: "계약서" },
        current_status: {
            status_type: "070",
            step_type: "06",
            step_index: "3",
            step_name: "제공기관 확인",
            step_recipients: [],
        },
        fields: [
            { id: "이용자 성명", value: "김고객", type: "text" },
            { id: "계약 시작일", value: "2026-07-09", type: "date" },
            { id: "계약 종료일", value: "2027-01-04", type: "date" },
            { id: "서비스 기간", value: "20260709 ~ 20270104", type: "text" },
            { id: "본인부담금 수령 년도", value: "26", type: "text" },
            { id: "본인부담금 수령 월", value: "07", type: "text" },
            { id: "본인부담금 수령 일", value: "09", type: "text" },
            { id: "본인부담금", value: "462,000원", type: "text" },
            { id: "서비스 비용", value: "1,464,000", type: "text" },
        ],
        recipients: [{
            recipient_type: "02",
            id: "customer@example.com",
            name: "김고객",
            sms: "010-1111-2222",
        }],
        ...overrides,
    };
}

function documentRow(overrides: Partial<ServiceRecordRevisionFactsDocument> = {}): ServiceRecordRevisionFactsDocument {
    return {
        documentId: DOCUMENT_ID,
        branchId: BRANCH_ID,
        clientId: CLIENT_ID,
        documentVersion: null,
        templateId: "contract-template",
        templateVersion: "v12",
        mirrorGeneration: "mirror-generation-7",
        statusType: "070",
        stepType: "06",
        stepIndex: "3",
        stepName: "제공기관 확인",
        detailPayload: detail(),
        stage: "provider_review",
        workflowScope: {
            templateId: "contract-template",
            templateVersion: "v12",
            statusType: "070",
            stepType: "06",
            stepIndex: "3",
        },
        allowedFieldIds: [
            "이용자 성명",
            "계약 시작일",
            "계약 종료일",
            "서비스 기간",
            "본인부담금 수령 년도",
            "본인부담금 수령 월",
            "본인부담금 수령 일",
            "본인부담금",
            "서비스 비용",
        ],
        ...overrides,
    };
}

function input(
    document: ServiceRecordRevisionFactsDocument = documentRow(),
    receiptTokens: ServiceRecordRevisionFactsInput["receiptTokens"] = [{
        id: TOKEN_ID,
        eformsignDocId: 17,
        branchId: BRANCH_ID,
        clientId: CLIENT_ID,
        active: true,
        revokedAt: null,
    }],
    targetOverrides: Partial<ServiceRecordRevisionFactsInput["targetPeriod"]> = {},
): ServiceRecordRevisionFactsInput {
    return {
        document,
        receiptTokens,
        targetPeriod: {
            startDate: "2026-07-10",
            endDate: "2027-01-05",
            receiptPeriod: "2026-07-10~2027-01-05",
            fields: {
                "계약 시작일": "2026-07-10",
                "계약 종료일": "2027-01-05",
                "서비스 기간": "20260710 ~ 20270105",
            },
            ...targetOverrides,
        },
    };
}

describe("service-record revision facts policy", () => {
    it("captures explicit source metadata, provider fields, participant, and frozen receipt input", () => {
        const result = captureServiceRecordRevisionFacts(input());

        expect(result.missingFacts).toEqual([]);
        expect(result.facts).toMatchObject({
            sourceDocument: {
                documentId: DOCUMENT_ID,
                documentVersion: null,
                templateId: "contract-template",
                templateVersion: "v12",
                mirrorGeneration: "mirror-generation-7",
                stage: "provider_review",
                participant: {
                    id: "customer@example.com",
                    name: "김고객",
                    phone: "010-1111-2222",
                },
                receivedDate: "2026-07-09",
                receivedAmount: "462000",
                startDate: "2026-07-09",
                endDate: "2027-01-04",
            },
        });
        expect(result.receiptInput).toEqual({
            expected: {
                serviceStartDate: "2026-07-10",
                serviceEndDate: "2027-01-05",
                receivedDate: "2026-07-09",
                amount: "462000",
            },
            tokens: { eformsignDocId: 17, tokenIds: [TOKEN_ID] },
            source: {
                documentId: DOCUMENT_ID,
                documentVersion: null,
                templateId: "contract-template",
                templateVersion: "v12",
                mirrorGeneration: "mirror-generation-7",
            },
        });
    });

    it("keeps original receipt facts while using only the explicit target period", () => {
        const result = captureServiceRecordRevisionFacts(input(documentRow({
            detailPayload: detail({
                fields: [
                    { id: "이용자 성명", value: "김고객", type: "text" },
                    { id: "계약 시작일", value: "2026-07-09", type: "date" },
                    { id: "계약 종료일", value: "2027-01-04", type: "date" },
                    { id: "본인부담금 수령일", value: "2026-07-09", type: "date" },
                    { id: "본인부담금", value: "462000", type: "number" },
                ],
            }),
        }), [], {
            startDate: "2026-07-11",
            endDate: "2027-01-08",
            receiptPeriod: "2026-07-11~2027-01-08",
            fields: { "서비스 기간": "20260711 ~ 20270108" },
        }));

        expect(result.missingFacts).toEqual([]);
        expect(result.facts?.sourceDocument.receivedDate).toBe("2026-07-09");
        expect(result.facts?.sourceDocument.receivedAmount).toBe("462000");
        expect(result.facts?.targetPeriod).toEqual({
            startDate: "2026-07-11",
            endDate: "2027-01-08",
            receiptPeriod: "2026-07-11~2027-01-08",
            fields: { "서비스 기간": "20260711 ~ 20270108" },
        });
        expect(result.receiptInput).toBeNull();
    });

    it("accepts an explicitly observed null document version", () => {
        const result = captureServiceRecordRevisionFacts(input(documentRow({ documentVersion: null })));

        expect(result.facts?.sourceDocument.documentVersion).toBeNull();
        expect(result.missingFacts).toEqual([]);
    });

    it("fails closed when template version or mirror generation has no producer value", () => {
        const row = documentRow();
        delete row.templateVersion;
        delete row.mirrorGeneration;
        const result = captureServiceRecordRevisionFacts(input({
            ...row,
            detailPayload: detail({
                updated_date: Date.parse("2026-07-02T00:00:00Z"),
                template: { id: "contract-template", name: "계약서" },
            }),
        }));

        expect(result.facts).toBeNull();
        expect(result.receiptInput).toBeNull();
        expect(result.missingFacts).toEqual(expect.arrayContaining([
            "sourceDocument.templateVersion",
            "sourceDocument.mirrorGeneration",
        ]));
    });

    it("rejects conflicting detail identity, duplicate fields, or cross-scope tokens", () => {
        const result = captureServiceRecordRevisionFacts(input(
            documentRow({
                detailPayload: detail({
                    id: "another-document",
                    fields: [
                        ...((detail()["fields"] ?? []) as unknown[]),
                        { id: "서비스 기간", value: "20260710 ~ 20270105", type: "text" },
                    ],
                }),
            }),
            [{
                id: TOKEN_ID,
                eformsignDocId: 17,
                branchId: "33333333-3333-4333-8333-333333333333",
                clientId: CLIENT_ID,
                active: true,
                revokedAt: null,
            }],
        ));

        expect(result.facts).toBeNull();
        expect(result.receiptInput).toBeNull();
        expect(result.missingFacts).toEqual(expect.arrayContaining([
            "sourceDocument.documentId.mismatch",
            "sourceDocument.fields.ambiguous",
            "receipt.tokens.scope",
        ]));
    });

    it("does not manufacture dates or amounts from duration, client-like values, or current time", () => {
        const row = documentRow({
            detailPayload: detail({
                fields: [
                    { id: "서비스 일수", value: "15", type: "number" },
                    { id: "서비스 비용", value: "462000", type: "number" },
                ],
            }),
        });

        const result = captureServiceRecordRevisionFacts(input(row, []));

        expect(result.facts).toBeNull();
        expect(result.missingFacts).toEqual(expect.arrayContaining([
            "sourceDocument.startDate",
            "sourceDocument.endDate",
            "sourceDocument.receivedDate",
            "sourceDocument.receivedAmount",
        ]));
    });

    it("treats an observed empty token set as receipt not-required without blocking contract facts", () => {
        const result = captureServiceRecordRevisionFacts(input(documentRow(), []));

        expect(result.facts).not.toBeNull();
        expect(result.receiptInput).toBeNull();
        expect(result.missingFacts).toEqual([]);
    });
});
