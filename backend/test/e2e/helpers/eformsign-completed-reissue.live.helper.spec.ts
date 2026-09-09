import { EformsignApiError } from "infrastructure/api/eformsign-api.error";
import type {
    CreateDocumentPayload,
    EformsignApiDocumentResponse,
} from "domain/repositories/eformsign.client.interface";
import { chmod, mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    EFORMSIGN_COMPLETED_REISSUE_ALLOWLIST_FIELD_IDS,
    EFORMSIGN_COMPLETED_REISSUE_CREATE_FULL_TEST_NAME,
    EFORMSIGN_COMPLETED_REISSUE_EXPECTED_IDENTITY_FINGERPRINT,
    EFORMSIGN_COMPLETED_REISSUE_INTERNAL_RECIPIENT_ID,
    EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STATUS_TYPE,
    EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
    EFORMSIGN_COMPLETED_REISSUE_SOURCE_PDF_BYTES,
    EFORMSIGN_COMPLETED_REISSUE_SOURCE_PDF_SHA256,
    EFORMSIGN_COMPLETED_REISSUE_SOURCE_STATUS_TYPE,
    EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE,
    EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD,
    EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
    EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STATUS_TYPE,
    EFORMSIGN_COMPLETED_REISSUE_FOLLOWUP_FULL_TEST_NAME,
    EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STEP_GROUP,
    EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STEP_GROUP,
    EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STEP_INDEX,
    EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STEP_INDEX,
    EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STEP_TYPE,
    EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STEP_TYPE,
    CompletedReissueAlreadyAttemptedError,
    CompletedReissueAmbiguousError,
    assertCompletedReissueCreatePayload,
    assertCompletedReissueNewUserDocument,
    assertCompletedReissuePdfEvidence,
    assertCompletedReissueProviderFollowupDocument,
    assertCompletedReissueSourceUnchanged,
    assertCompletedReissueTemplateTopology,
    buildCompletedReissuePreflight,
    classifyCompletedReissueCreateError,
    completedReissueIdentityFingerprint,
    completedReissueOperationKey,
    completedReissueOperationKeyFromFingerprint,
    exactJestTestNamePattern,
    hasExactJestTestNameSelector,
    inspectCompletedReissuePdf,
    isCompletedReissueLiveGate,
    protectedCompletedReissueDocumentIds,
    reserveCompletedReissueAttempt,
    verifyCompletedReissueFollowup,
    runCompletedReissueProbe,
    snapshotCompletedReissueDocument,
    type CompletedReissuePdfEvidence,
    type CompletedReissuePdfRead,
    type CompletedReissueTemplateTopology,
} from "./eformsign-completed-reissue.live.helper";

const SYNTHETIC_NAME = "synthetic-user";
const SYNTHETIC_PHONE = "01000000000";
const SYNTHETIC_BIRTHDAY = "990101";
const SYNTHETIC_ADDRESS = "synthetic-address";
const SYNTHETIC_NEW_DOCUMENT_ID = "synthetic-new-document";
const SYNTHETIC_PDF_BODY = Buffer.from("%PDF-synthetic-unsigned", "ascii");
const SYNTHETIC_TARGET_PDF_SHA256 = "a".repeat(64);
const TEST_TMP_ROOT = tmpdir().replace(/^\/var(?=\/)/, "/private/var");

function secureMkdtemp(prefix: string): Promise<string> {
    return mkdtemp(join(TEST_TMP_ROOT, prefix));
}

const SYNTHETIC_IDENTITY_FINGERPRINT = completedReissueIdentityFingerprint(
    EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
    SYNTHETIC_NAME,
    SYNTHETIC_PHONE,
);

const SOURCE_FIELDS: Record<string, string> = {
    "이용자 성명": SYNTHETIC_NAME,
    "이용자 생년월일": SYNTHETIC_BIRTHDAY,
    "이용자 주소": SYNTHETIC_ADDRESS,
    "이용자 연락처": SYNTHETIC_PHONE,
    "계약 시작 년도": "26",
    "계약 시작 월": "07",
    "계약 시작 일": "09",
    "계약 종료 년도": "27",
    "계약 종료 월": "01",
    "계약 종료 일": "04",
    "서비스 비용": "1,464,000",
    "정부지원금": "1,002,000",
    "본인부담금": "462,000",
    "서비스 가격": "1,464,000",
    "본인부담금 수령 년도": "26",
    "본인부담금 수령 월": "07",
    "본인부담금 수령 일": "09",
    "서비스 기간": "20260709 ~ 20270104",
};

function targetFields(): Record<string, string> {
    return {
        ...SOURCE_FIELDS,
        "계약 종료 일": "07",
        "서비스 기간": "20260709 ~ 20270107",
    };
}

function fieldEntries(values: Readonly<Record<string, string>>): Array<{ id: string; value: string; type: string }> {
    return [
        ...EFORMSIGN_COMPLETED_REISSUE_ALLOWLIST_FIELD_IDS.map((id) => ({
            id,
            value: values[id] ?? "",
            type: id.includes("금") || id === "서비스 가격" ? "number" : "text",
        })),
        { id: "이용자 서명", value: "fixture-signature-must-not-copy", type: "signature" },
        { id: "도장", value: "fixture-stamp-must-not-copy", type: "stamp" },
        { id: "개인정보 처리 동의", value: "fixture-consent-must-not-copy", type: "consent" },
        { id: "제공인력 성명", value: "fixture-provider-must-not-copy", type: "text" },
        { id: "이용자 이메일", value: "fixture@example.test", type: "text" },
    ];
}

function documentFixture(
    documentId: string,
    stage: "source" | "user" | "provider",
    values: Readonly<Record<string, string>> = stage === "source" ? SOURCE_FIELDS : targetFields(),
): EformsignApiDocumentResponse {
    const stageData = stage === "source"
        ? {
            status_type: EFORMSIGN_COMPLETED_REISSUE_SOURCE_STATUS_TYPE,
            step_type: "06",
            step_index: "5",
            step_group: 2,
            step_recipients: [],
        }
        : stage === "user"
            ? {
                status_type: EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STATUS_TYPE,
                step_type: EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STEP_TYPE,
                step_index: EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STEP_INDEX,
                step_group: EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STEP_GROUP,
                step_recipients: [{
                    recipient_type: "external",
                    id: "synthetic-user-recipient",
                    name: SYNTHETIC_NAME,
                    sms: SYNTHETIC_PHONE,
                }],
            }
            : {
                status_type: EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STATUS_TYPE,
                step_type: EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STEP_TYPE,
                step_index: EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STEP_INDEX,
                step_group: EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STEP_GROUP,
                step_recipients: [{
                    recipient_type: "insider",
                    id: EFORMSIGN_COMPLETED_REISSUE_INTERNAL_RECIPIENT_ID,
                    name: "synthetic-provider",
                }],
            };
    return {
        id: documentId,
        document_number: `fixture-${stage}`,
        template: { id: EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID, name: "synthetic-template" },
        document_name: `fixture-${stage}`,
        creator: { recipient_type: "writer", id: "synthetic-writer", name: "synthetic-writer" },
        created_date: 1,
        updated_date: 2,
        current_status: {
            ...stageData,
            step_name: `synthetic-${stage}`,
            expired_date: 0,
            _expired: false,
        },
        fields: fieldEntries(values),
        histories: [{ status_type: stageData.status_type, safe: true }],
        previous_status: [{ status_type: "001" }],
        recipients: [{ recipient_type: "writer", id: "synthetic-writer" }],
    };
}

function templateFixture(): Record<string, unknown> {
    const option = (extra: Record<string, unknown> = {}) => ({
        receipients: [],
        use_reject_restrict: false,
        ...extra,
    });
    return {
        form_id: EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
        enabled: true,
        is_release: true,
        version: "1",
        config: {
            step_settings: [
                { seq: 1, type: "write", step_group: 1, option: option() },
                {
                    seq: 2,
                    type: "participant",
                    step_group: 3,
                    option: option({
                        outsider_auto_infos: { name: "이용자 성명", sms_number: "이용자 연락처" },
                    }),
                },
                {
                    seq: 3,
                    type: "participant",
                    step_group: 4,
                    option: option({
                        receipients: [{
                            receipient_type: "internal",
                            group: { id: EFORMSIGN_COMPLETED_REISSUE_INTERNAL_RECIPIENT_ID },
                        }],
                        specified_recipient_type: "groupormember",
                        use_receipient_specified: true,
                    }),
                },
                {
                    seq: 4,
                    type: "reviewer",
                    step_group: 5,
                    option: option({
                        specified_recipient_type: "beforewriter",
                        specified_recipient_seq: 3,
                        use_receipient_specified: true,
                    }),
                },
                { seq: 5, type: "complete", step_group: 2, option: option() },
            ],
        },
    };
}

const SOURCE_PDF_EVIDENCE: CompletedReissuePdfEvidence = {
    sha256: EFORMSIGN_COMPLETED_REISSUE_SOURCE_PDF_SHA256,
    byteLength: EFORMSIGN_COMPLETED_REISSUE_SOURCE_PDF_BYTES,
    pageCount: 9,
    hasExpectedEndDate: true,
    hasExpectedPeriod: true,
    expectedPeriodOccurrences: 3,
    hasForbiddenEndDate: false,
    hasForbiddenPeriod: false,
    forbiddenPeriodOccurrences: 0,
};

const TARGET_PDF_EVIDENCE: CompletedReissuePdfEvidence = {
    sha256: SYNTHETIC_TARGET_PDF_SHA256,
    byteLength: SYNTHETIC_PDF_BODY.length,
    pageCount: 9,
    hasExpectedEndDate: true,
    hasExpectedPeriod: true,
    expectedPeriodOccurrences: 2,
    hasForbiddenEndDate: false,
    hasForbiddenPeriod: false,
    forbiddenPeriodOccurrences: 0,
};

function preflightFixture(): {
    source: EformsignApiDocumentResponse;
    topology: CompletedReissueTemplateTopology;
    preflight: ReturnType<typeof buildCompletedReissuePreflight>;
} {
    const source = documentFixture(EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID, "source");
    const topology = assertCompletedReissueTemplateTopology(templateFixture());
    const preflight = buildCompletedReissuePreflight(
        source,
        topology,
        SOURCE_PDF_EVIDENCE,
        SYNTHETIC_IDENTITY_FINGERPRINT,
    );
    return { source, topology, preflight };
}

function pdfRead(evidence: CompletedReissuePdfEvidence): CompletedReissuePdfRead {
    return { body: SYNTHETIC_PDF_BODY, evidence, attempts: 1, statuses: [200] };
}

async function writeAcceptedLedgerFixture(ledgerDirectory: string): Promise<{
    operationKey: string;
    markerPath: string;
    resultPath: string;
    acceptancePath: string;
    documentId: string;
}> {
    const operationKey = completedReissueOperationKeyFromFingerprint(
        EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
        EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
        EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE,
        EFORMSIGN_COMPLETED_REISSUE_EXPECTED_IDENTITY_FINGERPRINT,
    );
    const artifactDirectory = join(ledgerDirectory, "artifacts", operationKey);
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
    const createdAt = "2026-09-08T00:00:00.000Z";
    const shared = {
        schemaVersion: 1,
        operationKey,
        sourceId: EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
        templateId: EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
        templateVersion: "1",
        targetEndDate: EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE,
        targetPeriod: EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD,
        recipientFingerprint: EFORMSIGN_COMPLETED_REISSUE_EXPECTED_IDENTITY_FINGERPRINT,
        canonicalPayloadHash: "b".repeat(64),
        artifactDirectory,
        createdAt,
    };
    const documentId = "synthetic-ledger-document";
    const markerPath = join(ledgerDirectory, `${operationKey}.attempt.json`);
    const resultPath = join(ledgerDirectory, `${operationKey}.result.json`);
    const acceptancePath = join(ledgerDirectory, `${operationKey}.acceptance.json`);
    await writeFile(markerPath, `${JSON.stringify(shared)}\n`, { mode: 0o600, flag: "wx" });
    await writeFile(resultPath, `${JSON.stringify({ ...shared, status: "created", documentId })}\n`, { mode: 0o600, flag: "wx" });
    await writeFile(acceptancePath, `${JSON.stringify({ ...shared, status: "accepted", documentId, acceptedAt: createdAt })}\n`, { mode: 0o600, flag: "wx" });
    return { operationKey, markerPath, resultPath, acceptancePath, documentId };
}

describe("completed eformsign reissue helper guards", () => {
    it("preflights the source, exact template topology, target payload, and deterministic key", () => {
        const first = preflightFixture();
        const second = preflightFixture();

        expect(first.topology).toMatchObject({
            templateId: EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
            version: "1",
            enabled: true,
            released: true,
        });
        expect(first.topology.steps.map((step) => [step.sequence, step.type, step.stepGroup]))
            .toEqual([[1, "write", 1], [2, "participant", 3], [3, "participant", 4], [4, "reviewer", 5], [5, "complete", 2]]);
        expect(first.preflight.operationKey).toHaveLength(64);
        expect(first.preflight.operationKey).toBe(second.preflight.operationKey);
        expect(first.preflight.canonicalPayloadHash).toHaveLength(64);
        expect(first.preflight.payload.documentName).toBeUndefined();
        expect(first.preflight.payload.reviewer).toBeUndefined();
        expect(first.preflight.payload.recipient).toEqual({ name: SYNTHETIC_NAME, sms: SYNTHETIC_PHONE });
        expect(first.preflight.payload.prefillFields.map((field) => field.id))
            .toEqual([...EFORMSIGN_COMPLETED_REISSUE_ALLOWLIST_FIELD_IDS]);
        expect(first.preflight.payload.prefillFields.map((field) => field.id))
            .not.toContain("이용자 서명");
        assertCompletedReissueCreatePayload(first.preflight.payload, first.preflight);

        const semanticVariant = {
            ...SOURCE_FIELDS,
            "이용자 연락처": "010-0000-0000",
            "계약 시작 년도": "2026",
            "계약 시작 월": "7",
            "계약 시작 일": "9",
            "계약 종료 년도": "2027",
            "계약 종료 월": "1",
            "계약 종료 일": "4",
            "서비스 비용": "1464000",
            "정부지원금": "1002000",
            "본인부담금": "462000",
            "서비스 가격": "1464000",
            "본인부담금 수령 년도": "2026",
            "본인부담금 수령 월": "7",
            "본인부담금 수령 일": "9",
            "서비스 기간": "2026-07-09 ~ 2027-01-04",
        };
        const semanticVariantPreflight = buildCompletedReissuePreflight(
            documentFixture(EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID, "source", semanticVariant),
            first.topology,
            SOURCE_PDF_EVIDENCE,
            SYNTHETIC_IDENTITY_FINGERPRINT,
        );
        expect(semanticVariantPreflight.operationKey).toBe(first.preflight.operationKey);
        expect(semanticVariantPreflight.canonicalPayloadHash).not.toBe(first.preflight.canonicalPayloadHash);
        expect(completedReissueOperationKey(
            EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
            EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
            EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE,
            { name: SYNTHETIC_NAME, sms: "010-0000-0000" },
        )).toBe(first.preflight.operationKey);
    });

    it("fails closed on identity, terminal source, PDF, and topology drift", () => {
        const { source, topology } = preflightFixture();
        const wrongIdentity = { ...SOURCE_FIELDS, "이용자 연락처": "01011112222" };
        expect(() => buildCompletedReissuePreflight(
            documentFixture(EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID, "source", wrongIdentity),
            topology,
            SOURCE_PDF_EVIDENCE,
            SYNTHETIC_IDENTITY_FINGERPRINT,
        )).toThrow("source user identity");

        const wrongStatus = documentFixture(EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID, "source");
        wrongStatus.current_status.status_type = "002";
        expect(() => buildCompletedReissuePreflight(wrongStatus, topology, SOURCE_PDF_EVIDENCE, SYNTHETIC_IDENTITY_FINGERPRINT))
            .toThrow("terminal status");
        expect(() => buildCompletedReissuePreflight(source, topology, {
            ...SOURCE_PDF_EVIDENCE,
            hasForbiddenEndDate: true,
        }, SYNTHETIC_IDENTITY_FINGERPRINT)).toThrow("source PDF");

        const malformedTemplate = templateFixture();
        const settings = (malformedTemplate["config"] as { step_settings: Array<Record<string, unknown>> }).step_settings;
        settings[1]!["option"] = {
            receipients: [{ receipient_type: "external", id: "selected-user" }],
            use_reject_restrict: false,
        };
        expect(() => assertCompletedReissueTemplateTopology(malformedTemplate)).toThrow("user participant topology");
    });

    it("blocks a semantic-format variant on the existing marker before any create call", async () => {
        const first = preflightFixture();
        const semanticVariant = {
            ...SOURCE_FIELDS,
            "이용자 연락처": "010-0000-0000",
            "계약 시작 년도": "2026",
            "계약 시작 월": "7",
            "계약 시작 일": "9",
            "계약 종료 년도": "2027",
            "계약 종료 월": "1",
            "계약 종료 일": "4",
            "서비스 비용": "1464000",
            "정부지원금": "1002000",
            "본인부담금": "462000",
            "서비스 가격": "1464000",
            "본인부담금 수령 년도": "2026",
            "본인부담금 수령 월": "7",
            "본인부담금 수령 일": "9",
            "서비스 기간": "2026-07-09 ~ 2027-01-04",
        };
        const variantSource = documentFixture(EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID, "source", semanticVariant);
        const ledgerDirectory = await secureMkdtemp("completed-reissue-semantic-");
        await reserveCompletedReissueAttempt(first.preflight, ledgerDirectory);
        const createDocument = jest.fn(async () => ({ documentId: SYNTHETIC_NEW_DOCUMENT_ID, status: "created" }));

        await expect(runCompletedReissueProbe({
            accessToken: "synthetic-access-token",
            api: {
                getDocument: jest.fn(async () => variantSource),
                createDocument,
            },
            fileReader: { downloadDocumentFile: jest.fn() },
            templateReader: { getTemplateConfig: jest.fn(async () => templateFixture()) },
            expectedIdentityFingerprint: SYNTHETIC_IDENTITY_FINGERPRINT,
            ledgerDirectory,
            readPdf: async () => pdfRead(SOURCE_PDF_EVIDENCE),
        })).rejects.toBeInstanceOf(CompletedReissueAlreadyAttemptedError);
        expect(createDocument).not.toHaveBeenCalled();
    });

    it("rejects every existing ledger namespace collision, symlink, and symlink ancestor before create", async () => {
        const collisionKinds = ["attempt", "result", "acceptance", "failure", "artifact"] as const;
        for (const kind of collisionKinds) {
            const { source, preflight } = preflightFixture();
            const ledgerDirectory = await secureMkdtemp(`completed-reissue-${kind}-`);
            const artifactRoot = join(ledgerDirectory, "artifacts");
            await mkdir(artifactRoot, { mode: 0o700 });
            const collisionPath = kind === "attempt"
                ? join(ledgerDirectory, `${preflight.operationKey}.attempt.json`)
                : kind === "result"
                    ? join(ledgerDirectory, `${preflight.operationKey}.result.json`)
                    : kind === "acceptance"
                        ? join(ledgerDirectory, `${preflight.operationKey}.acceptance.json`)
                        : kind === "failure"
                        ? join(ledgerDirectory, `${preflight.operationKey}.failure.json`)
                        : join(artifactRoot, preflight.operationKey);
            if (kind === "artifact") await mkdir(collisionPath, { mode: 0o700 });
            else await writeFile(collisionPath, "collision\n", { mode: 0o600, flag: "wx" });
            const createDocument = jest.fn(async () => ({ documentId: SYNTHETIC_NEW_DOCUMENT_ID, status: "created" }));
            await expect(runCompletedReissueProbe({
                accessToken: "synthetic-access-token",
                api: { getDocument: jest.fn(async () => source), createDocument },
                fileReader: { downloadDocumentFile: jest.fn() },
                templateReader: { getTemplateConfig: jest.fn(async () => templateFixture()) },
                expectedIdentityFingerprint: SYNTHETIC_IDENTITY_FINGERPRINT,
                ledgerDirectory,
                readPdf: async () => pdfRead(SOURCE_PDF_EVIDENCE),
            })).rejects.toBeInstanceOf(CompletedReissueAlreadyAttemptedError);
            expect(createDocument).not.toHaveBeenCalled();
        }

        const symlinkLedger = await secureMkdtemp("completed-reissue-symlink-");
        const symlinkTarget = await secureMkdtemp("completed-reissue-target-");
        const { source: symlinkSource, preflight } = preflightFixture();
        const symlinkPath = join(symlinkLedger, `${preflight.operationKey}.attempt.json`);
        await symlink(symlinkTarget, symlinkPath, "dir");
        const symlinkCreate = jest.fn(async () => ({ documentId: SYNTHETIC_NEW_DOCUMENT_ID, status: "created" }));
        await expect(runCompletedReissueProbe({
            accessToken: "synthetic-access-token",
            api: { getDocument: jest.fn(async () => symlinkSource), createDocument: symlinkCreate },
            fileReader: { downloadDocumentFile: jest.fn() },
            templateReader: { getTemplateConfig: jest.fn(async () => templateFixture()) },
            expectedIdentityFingerprint: SYNTHETIC_IDENTITY_FINGERPRINT,
            ledgerDirectory: symlinkLedger,
            readPdf: async () => pdfRead(SOURCE_PDF_EVIDENCE),
        })).rejects.toThrow("namespace symlink");
        expect(symlinkCreate).not.toHaveBeenCalled();

        const ancestorBase = await secureMkdtemp("completed-reissue-ancestor-");
        const ancestorTarget = await secureMkdtemp("completed-reissue-ancestor-target-");
        const ancestorLink = join(ancestorBase, "link");
        await symlink(ancestorTarget, ancestorLink, "dir");
        const ancestorCreate = jest.fn(async () => ({ documentId: SYNTHETIC_NEW_DOCUMENT_ID, status: "created" }));
        await expect(runCompletedReissueProbe({
            accessToken: "synthetic-access-token",
            api: { getDocument: jest.fn(async () => symlinkSource), createDocument: ancestorCreate },
            fileReader: { downloadDocumentFile: jest.fn() },
            templateReader: { getTemplateConfig: jest.fn(async () => templateFixture()) },
            expectedIdentityFingerprint: SYNTHETIC_IDENTITY_FINGERPRINT,
            ledgerDirectory: join(ancestorLink, "ledger"),
            readPdf: async () => pdfRead(SOURCE_PDF_EVIDENCE),
        })).rejects.toThrow("symlink ancestor");
        expect(ancestorCreate).not.toHaveBeenCalled();
    });

    it("runs one injected create, durably records its result before postconditions, and never downloads in offline mode", async () => {
        const { source, preflight } = preflightFixture();
        const freshDocument = documentFixture(SYNTHETIC_NEW_DOCUMENT_ID, "user");
        const logs: Array<Record<string, string | number | null>> = [];
        const ledgerDirectory = await secureMkdtemp("completed-reissue-test-");
        const getDocument = jest.fn(async (_token: string, documentId: string) => {
            if (documentId === EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID) {
                if (getDocument.mock.calls.length > 1) {
                    const entries = await readdir(ledgerDirectory);
                    expect(entries).toContain(`${preflight.operationKey}.result.json`);
                }
                return source;
            }
            return freshDocument;
        });
        const createDocument = jest.fn(async (_token: string, payload: CreateDocumentPayload) => {
            expect(payload.idempotencyKey).toBe(preflight.operationKey);
            return { documentId: SYNTHETIC_NEW_DOCUMENT_ID, status: "created" };
        });
        const fileReader = {
            downloadDocumentFile: jest.fn(async () => {
                throw new Error("offline probe must not call the vendor PDF endpoint");
            }),
        };
        const result = await runCompletedReissueProbe({
            accessToken: "synthetic-access-token",
            api: { getDocument, createDocument },
            fileReader,
            templateReader: { getTemplateConfig: jest.fn(async () => templateFixture()) },
            ledgerDirectory,
            expectedIdentityFingerprint: SYNTHETIC_IDENTITY_FINGERPRINT,
            logger: (event) => logs.push(event),
            readPdf: async (_reader, _token, documentId) => (
                documentId === EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID
                    ? pdfRead(SOURCE_PDF_EVIDENCE)
                    : pdfRead(TARGET_PDF_EVIDENCE)
            ),
        });

        expect(createDocument).toHaveBeenCalledTimes(1);
        expect(fileReader.downloadDocumentFile).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            status: "created_visual_pending",
            documentId: SYNTHETIC_NEW_DOCUMENT_ID,
            targetEndDate: EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE,
            targetPeriod: EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD,
            visualInspection: "pending",
        });
        const markerPath = join(ledgerDirectory, `${preflight.operationKey}.attempt.json`);
        const resultPath = join(ledgerDirectory, `${preflight.operationKey}.result.json`);
        const acceptancePath = join(ledgerDirectory, `${preflight.operationKey}.acceptance.json`);
        expect((await stat(markerPath)).mode & 0o777).toBe(0o600);
        expect((await stat(resultPath)).mode & 0o777).toBe(0o600);
        expect((await stat(acceptancePath)).mode & 0o777).toBe(0o600);
        const ledgerText = await readFile(resultPath, "utf8");
        expect(ledgerText).toContain(SYNTHETIC_NEW_DOCUMENT_ID);
        const artifactEntries = await readdir(join(ledgerDirectory, "artifacts", preflight.operationKey));
        expect(artifactEntries).toContain("new-user-stage.pdf");
        expect(artifactEntries).not.toContain("new-unsigned.pdf");
        const logText = JSON.stringify(logs);
        expect(logText).not.toContain(SYNTHETIC_NAME);
        expect(logText).not.toContain(SYNTHETIC_PHONE);
        expect(logText).not.toContain(SYNTHETIC_BIRTHDAY);
        expect(logText).not.toContain(SYNTHETIC_ADDRESS);
        await expect(reserveCompletedReissueAttempt(preflight, ledgerDirectory)).rejects.toBeInstanceOf(CompletedReissueAlreadyAttemptedError);
    });

    it("refuses any pre-existing marker, including arbitrary marker contents, and keeps retry classification conservative", async () => {
        const { preflight } = preflightFixture();
        const ledgerDirectory = await secureMkdtemp("completed-reissue-marker-");
        const markerPath = join(ledgerDirectory, `${preflight.operationKey}.attempt.json`);
        await writeFile(markerPath, "arbitrary marker contents\n", { mode: 0o600, flag: "wx" });
        await expect(reserveCompletedReissueAttempt(preflight, ledgerDirectory)).rejects.toBeInstanceOf(CompletedReissueAlreadyAttemptedError);

        expect(classifyCompletedReissueCreateError(new EformsignApiError("rate limited", 429))).toBe("prework_rejected");
        expect(classifyCompletedReissueCreateError(new EformsignApiError("bad request", 400))).toBe("ambiguous");
        expect(classifyCompletedReissueCreateError(new EformsignApiError("request timeout", 408))).toBe("ambiguous");
        expect(classifyCompletedReissueCreateError(new EformsignApiError("conflict", 409))).toBe("ambiguous");
        expect(classifyCompletedReissueCreateError(new EformsignApiError("too early", 425))).toBe("ambiguous");
        expect(classifyCompletedReissueCreateError(new EformsignApiError("server unavailable", 503))).toBe("ambiguous");
        expect(classifyCompletedReissueCreateError(new Error("transport timeout"))).toBe("ambiguous");
    });

    it("persists only redacted structured create-error metadata while keeping the outcome ambiguous", async () => {
        const cases = [
            {
                error: new EformsignApiError(
                    'raw provider body Bearer secret-token {"response":"must-not-persist"}',
                    409,
                    "4000012",
                ),
                expected: {
                    httpStatus: 409,
                    vendorCode: "4000012",
                    name: "EformsignApiError",
                    category: "vendor_http_error",
                },
            },
            {
                error: new Error("createDocument: no document id in response raw-body-secret"),
                expected: {
                    httpStatus: null,
                    vendorCode: null,
                    name: "Error",
                    category: "runtime_error",
                },
            },
        ] as const;
        for (const testCase of cases) {
            const { source, preflight } = preflightFixture();
            const ledgerDirectory = await secureMkdtemp("completed-reissue-create-error-");
            const getDocument = jest.fn(async () => source);
            await expect(runCompletedReissueProbe({
                accessToken: "synthetic-access-token",
                api: {
                    getDocument,
                    createDocument: jest.fn(async () => {
                        throw testCase.error;
                    }),
                },
                fileReader: { downloadDocumentFile: jest.fn() },
                templateReader: { getTemplateConfig: jest.fn(async () => templateFixture()) },
                expectedIdentityFingerprint: SYNTHETIC_IDENTITY_FINGERPRINT,
                ledgerDirectory,
                readPdf: async () => pdfRead(SOURCE_PDF_EVIDENCE),
            })).rejects.toBeInstanceOf(CompletedReissueAmbiguousError);
            const metadataPath = join(
                ledgerDirectory,
                "artifacts",
                preflight.operationKey,
                "create-error.json",
            );
            const metadataText = await readFile(metadataPath, "utf8");
            expect(JSON.parse(metadataText)).toEqual(testCase.expected);
            expect(metadataText).not.toContain("secret-token");
            expect(metadataText).not.toContain("raw-body");
            expect(metadataText).not.toContain("must-not-persist");
            const result = JSON.parse(
                await readFile(join(ledgerDirectory, `${preflight.operationKey}.result.json`), "utf8"),
            ) as Record<string, unknown>;
            expect(result["status"]).toBe("ambiguous");
            expect(getDocument).toHaveBeenCalledTimes(1);
        }
    });

    it("rejects tampered result relations before the readonly followup can issue a GET", async () => {
        const tamperCases = [
            {
                label: "result document id",
                mutate: async (fixture: Awaited<ReturnType<typeof writeAcceptedLedgerFixture>>) => {
                    const record = JSON.parse(await readFile(fixture.resultPath, "utf8")) as Record<string, unknown>;
                    record["documentId"] = "tampered-result-document";
                    await writeFile(fixture.resultPath, `${JSON.stringify(record)}\n`);
                },
            },
            {
                label: "result canonical payload hash",
                mutate: async (fixture: Awaited<ReturnType<typeof writeAcceptedLedgerFixture>>) => {
                    const record = JSON.parse(await readFile(fixture.resultPath, "utf8")) as Record<string, unknown>;
                    record["canonicalPayloadHash"] = "c".repeat(64);
                    await writeFile(fixture.resultPath, `${JSON.stringify(record)}\n`);
                },
            },
            {
                label: "attempt operation key",
                mutate: async (fixture: Awaited<ReturnType<typeof writeAcceptedLedgerFixture>>) => {
                    const record = JSON.parse(await readFile(fixture.markerPath, "utf8")) as Record<string, unknown>;
                    record["operationKey"] = "d".repeat(64);
                    await writeFile(fixture.markerPath, `${JSON.stringify(record)}\n`);
                },
            },
        ] as const;
        for (const tamperCase of tamperCases) {
            const ledgerDirectory = await secureMkdtemp(`completed-reissue-tamper-${tamperCase.label.replace(/\s+/g, "-")}-`);
            const fixture = await writeAcceptedLedgerFixture(ledgerDirectory);
            await tamperCase.mutate(fixture);
            const getDocument = jest.fn();
            await expect(verifyCompletedReissueFollowup({
                accessToken: "synthetic-access-token",
                api: { getDocument },
                fileReader: { downloadDocumentFile: jest.fn() },
                ledgerDirectory,
                readPdf: async () => pdfRead(TARGET_PDF_EVIDENCE),
            })).rejects.toBeInstanceOf(Error);
            expect(getDocument).not.toHaveBeenCalled();
        }
    });

    it("keeps a post-create result-write failure ambiguous and blocks a retry", async () => {
        const { source, preflight } = preflightFixture();
        const ledgerDirectory = await secureMkdtemp("completed-reissue-result-fault-");
        const resultPath = join(ledgerDirectory, `${preflight.operationKey}.result.json`);
        const createDocument = jest.fn(async () => {
            await chmod(resultPath, 0o400);
            return { documentId: SYNTHETIC_NEW_DOCUMENT_ID, status: "created" };
        });
        const getDocument = jest.fn(async () => source);
        await expect(runCompletedReissueProbe({
            accessToken: "synthetic-access-token",
            api: { getDocument, createDocument },
            fileReader: { downloadDocumentFile: jest.fn() },
            templateReader: { getTemplateConfig: jest.fn(async () => templateFixture()) },
            expectedIdentityFingerprint: SYNTHETIC_IDENTITY_FINGERPRINT,
            ledgerDirectory,
            readPdf: async () => pdfRead(SOURCE_PDF_EVIDENCE),
        })).rejects.toBeInstanceOf(CompletedReissueAmbiguousError);
        expect(createDocument).toHaveBeenCalledTimes(1);
        expect(getDocument).toHaveBeenCalledTimes(1);
        await expect(reserveCompletedReissueAttempt(preflight, ledgerDirectory)).rejects.toBeInstanceOf(CompletedReissueAlreadyAttemptedError);
    });

    it("keeps selector gates exact and verifies immutable-source, user-stage, provider-stage, and PDF guards", () => {
        const exactPattern = exactJestTestNamePattern(EFORMSIGN_COMPLETED_REISSUE_CREATE_FULL_TEST_NAME);
        const acceptedSelectors = [
            ["node", "jest", "--testNamePattern", exactPattern],
            ["node", "jest", `--testNamePattern=${exactPattern}`],
            ["node", "jest", "--test-name-pattern", exactPattern],
            ["node", "jest", `--test-name-pattern=${exactPattern}`],
            ["node", "jest", "-t", exactPattern],
            ["node", "jest", `-t=${exactPattern}`],
        ];
        for (const argv of acceptedSelectors) {
            expect(hasExactJestTestNameSelector(EFORMSIGN_COMPLETED_REISSUE_CREATE_FULL_TEST_NAME, argv)).toBe(true);
            expect(isCompletedReissueLiveGate(EFORMSIGN_COMPLETED_REISSUE_CREATE_FULL_TEST_NAME, { LIVE_E2E: "1" }, argv)).toBe(true);
        }
        const rejectedSelectors = [
            ["node", "jest", "--testNamePattern", exactPattern, "--testNamePattern", exactPattern],
            ["node", "jest", "--testNamePattern", exactPattern, "-t", exactPattern],
            ["node", "jest", `--testNamePattern=${exactPattern}`, "-t=other"],
            ["node", "jest", "--watch", "false", "--testNamePattern", exactPattern],
            ["node", "jest", "--watch=true", "--testNamePattern", exactPattern],
            ["node", "jest", "--watchAll", "--testNamePattern", exactPattern],
            ["node", "jest", "--watchAll=false", "--testNamePattern", exactPattern],
            ["node", "jest", "--watch-all", "--testNamePattern", exactPattern],
            ["node", "jest", "--watch-all=true", "--testNamePattern", exactPattern],
            ["node", "jest", "-w", "--testNamePattern", exactPattern],
            ["node", "jest", "-w=true", "--testNamePattern", exactPattern],
            ["node", "jest", "--testNamePattern"],
        ];
        for (const argv of rejectedSelectors) {
            expect(hasExactJestTestNameSelector(EFORMSIGN_COMPLETED_REISSUE_CREATE_FULL_TEST_NAME, argv)).toBe(false);
            expect(isCompletedReissueLiveGate(EFORMSIGN_COMPLETED_REISSUE_CREATE_FULL_TEST_NAME, { LIVE_E2E: "1" }, argv)).toBe(false);
        }
        expect(isCompletedReissueLiveGate(EFORMSIGN_COMPLETED_REISSUE_CREATE_FULL_TEST_NAME, { LIVE_E2E: "0" }, acceptedSelectors[0])).toBe(false);
        expect(hasExactJestTestNameSelector(EFORMSIGN_COMPLETED_REISSUE_FOLLOWUP_FULL_TEST_NAME, acceptedSelectors[0])).toBe(false);

        const { source, preflight } = preflightFixture();
        expect(() => assertCompletedReissueSourceUnchanged(preflight, source, SOURCE_PDF_EVIDENCE)).not.toThrow();
        const changedSource = documentFixture(EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID, "source");
        changedSource.fields!.find((field) => field.id === "서비스 비용")!.value = "1,464,001";
        expect(() => assertCompletedReissueSourceUnchanged(preflight, changedSource, SOURCE_PDF_EVIDENCE)).toThrow("immutable");

        const newUser = documentFixture(SYNTHETIC_NEW_DOCUMENT_ID, "user");
        expect(() => assertCompletedReissueNewUserDocument(newUser, preflight, SYNTHETIC_NEW_DOCUMENT_ID)).not.toThrow();
        expect(() => assertCompletedReissueNewUserDocument(newUser, preflight, "wrong-durable-document-id")).toThrow("user signer stage");
        expect(() => assertCompletedReissueNewUserDocument(documentFixture(EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID, "user"), preflight, SYNTHETIC_NEW_DOCUMENT_ID)).toThrow();

        const provider = documentFixture(SYNTHETIC_NEW_DOCUMENT_ID, "provider");
        expect(() => assertCompletedReissueProviderFollowupDocument(provider, SYNTHETIC_NEW_DOCUMENT_ID)).not.toThrow();
        provider.current_status.status_type = "071";
        expect(() => assertCompletedReissueProviderFollowupDocument(provider, SYNTHETIC_NEW_DOCUMENT_ID)).toThrow("provider participant stage");

        const targetEvidence = inspectCompletedReissuePdf(
            SYNTHETIC_PDF_BODY,
            1,
            "계약 종료 2027-01-07 서비스 기간 20260709 ~ 20270107 서비스 기간 20260709 ~ 20270107",
            { endDate: EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE, period: EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD },
        );
        expect(() => assertCompletedReissuePdfEvidence(targetEvidence, {
            endDate: EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE,
            period: EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD,
        })).not.toThrow();
        expect(() => assertCompletedReissuePdfEvidence({ ...targetEvidence, expectedPeriodOccurrences: 1 }, {
            endDate: EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE,
            period: EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD,
        })).toThrow("PDF markers");
        expect(protectedCompletedReissueDocumentIds()).toEqual(expect.arrayContaining([
            EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
            "d5adcc5ecd99431f841151a0c7540759",
            "27e3c3287859433dbd8a680525c5338d",
        ]));
        expect(EFORMSIGN_COMPLETED_REISSUE_EXPECTED_IDENTITY_FINGERPRINT).toHaveLength(64);
        expect(snapshotCompletedReissueDocument(source).fieldVectorHash).toHaveLength(64);
    });
});
