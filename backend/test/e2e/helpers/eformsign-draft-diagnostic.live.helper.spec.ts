import { chmod, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let mockShortWrites = false;

jest.mock("node:fs/promises", () => {
    const actual = jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises");
    return {
        ...actual,
        open: async (...args: Parameters<typeof actual.open>) => {
            const handle = await actual.open(...args);
            if (!mockShortWrites) return handle;
            const originalWrite = handle.write.bind(handle);
            const writable = handle as unknown as {
                write: (buffer: Buffer, offset: number, length: number, position: number) => Promise<{ bytesWritten: number; buffer: Buffer }>;
            };
            let shortened = false;
            writable.write = async (buffer, offset, length, position) => {
                const writeLength = !shortened && length > 1 ? Math.max(1, Math.floor(length / 2)) : length;
                shortened = true;
                return originalWrite(buffer, offset, writeLength, position);
            };
            return handle;
        },
    };
});

import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import {
    EFORMSIGN_COMPLETED_REISSUE_EXPECTED_IDENTITY_FINGERPRINT,
    EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
    EFORMSIGN_COMPLETED_REISSUE_SOURCE_STATUS_TYPE,
    EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
    assertCompletedReissueTemplateTopology,
    completedReissueIdentityFingerprint,
    exactJestTestNamePattern,
    hasExactJestTestNameSelector,
    isCompletedReissueLiveGate,
} from "./eformsign-completed-reissue.live.helper";
import {
    EFORMSIGN_DRAFT_DIAGNOSTIC_ALLOWLIST_FIELD_IDS,
    EFORMSIGN_DRAFT_DIAGNOSTIC_DOC_API_ORIGIN,
    EFORMSIGN_DRAFT_DIAGNOSTIC_TOKEN_API_ORIGIN,
    EFORMSIGN_DRAFT_DIAGNOSTIC_CREATE_FULL_TEST_NAME,
    EFORMSIGN_DRAFT_DIAGNOSTIC_LEDGER_DIRECTORY,
    EFORMSIGN_DRAFT_DIAGNOSTIC_SYNTHETIC_NAME,
    assertDraftDiagnosticCreateBody,
    assertDraftDiagnosticNewDocument,
    assertDraftDiagnosticOfficialLiveOrigins,
    assertDraftDiagnosticSourceBaseline,
    buildDraftDiagnosticCreateBody,
    runDraftDiagnostic,
    type DraftDiagnosticApi,
    type DraftDiagnosticTemplate,
} from "./eformsign-draft-diagnostic.live.helper";

const SOURCE_NAME = "source-user";
const SOURCE_PHONE = "010-0000-0000";
const TEST_TOKEN = "synthetic-token";

function secureMkdtemp(): Promise<string> {
    const root = tmpdir().replace(/^\/var(?=\/)/, "/private/var");
    return mkdtemp(join(root, "bjj-draft-diagnostic-"));
}

function sourceFields(): Array<{ id: string; value: string; type: string }> {
    return [
        { id: "이용자 성명", value: SOURCE_NAME, type: "text" },
        { id: "이용자 연락처", value: SOURCE_PHONE, type: "text" },
        { id: "계약 시작 년도", value: "26", type: "text" },
        { id: "계약 시작 월", value: "07", type: "text" },
        { id: "계약 시작 일", value: "09", type: "text" },
        { id: "계약 종료 년도", value: "27", type: "text" },
        { id: "계약 종료 월", value: "01", type: "text" },
        { id: "계약 종료 일", value: "04", type: "text" },
        { id: "서비스 비용", value: "1,464,000", type: "number" },
        { id: "정부지원금", value: "1,002,000", type: "number" },
        { id: "본인부담금", value: "462,000", type: "number" },
        { id: "서비스 가격", value: "1,464,000", type: "number" },
        { id: "본인부담금 수령 년도", value: "26", type: "text" },
        { id: "본인부담금 수령 월", value: "07", type: "text" },
        { id: "본인부담금 수령 일", value: "09", type: "text" },
        { id: "서비스 기간", value: "20260709 ~ 20270104", type: "text" },
    ];
}

function sourceDocument(id = EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID): EformsignApiDocumentResponse {
    return {
        id,
        document_number: "fixture-source",
        template: { id: EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID, name: "fixture" },
        document_name: "fixture-source",
        creator: { recipient_type: "writer", id: "writer", name: "writer" },
        created_date: 1,
        updated_date: 2,
        current_status: {
            status_type: EFORMSIGN_COMPLETED_REISSUE_SOURCE_STATUS_TYPE,
            step_type: "01",
            step_index: "5",
            step_name: "완료",
            step_recipients: [],
            step_group: 2,
        },
        fields: sourceFields(),
        histories: [{ status_type: EFORMSIGN_COMPLETED_REISSUE_SOURCE_STATUS_TYPE }],
        previous_status: [{ status_type: "001" }],
        recipients: [],
    };
}

function templateFixture(): DraftDiagnosticTemplate {
    const option = (extra: Record<string, unknown> = {}) => ({
        receipients: [],
        use_reject_restrict: false,
        ...extra,
    });
    return assertCompletedReissueTemplateTopology({
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
                    option: option({ outsider_auto_infos: { name: "이용자 성명", sms_number: "이용자 연락처" } }),
                },
                {
                    seq: 3,
                    type: "participant",
                    step_group: 4,
                    option: option({
                        receipients: [{ receipient_type: "internal", group: { id: "142f6049d9af43e19b32ddf4c5139120" } }],
                        specified_recipient_type: "groupormember",
                        use_receipient_specified: true,
                    }),
                },
                {
                    seq: 4,
                    type: "reviewer",
                    step_group: 5,
                    option: option({ specified_recipient_type: "beforewriter", specified_recipient_seq: 3, use_receipient_specified: true }),
                },
                { seq: 5, type: "complete", step_group: 2, option: option() },
            ],
        },
    });
}

function newDocument(id = "a".repeat(32)): EformsignApiDocumentResponse {
    return {
        ...sourceDocument(id),
        document_number: "fixture-draft",
        document_name: "fixture-draft",
        current_status: {
            ...sourceDocument().current_status,
            status_type: "001",
            step_type: "01",
            step_index: "0",
            step_name: "작성",
            step_group: 1,
        },
        fields: buildDraftDiagnosticCreateBody().document.fields.map((field) => ({
            ...field,
            type: field.id.includes("금") || field.id === "서비스 가격" ? "number" : "text",
        })),
    };
}

function apiFor(
    responses: EformsignApiDocumentResponse[] = [sourceDocument(), sourceDocument(), newDocument()],
    onGet?: (documentId: string) => void | Promise<void>,
): DraftDiagnosticApi {
    return {
        getDocument: jest.fn(async (_token: string, documentId: string) => {
            await onGet?.(documentId);
            const response = responses.shift();
            if (!response) throw new Error("fixture response exhausted");
            return response;
        }),
    };
}

function config(
    docBase = EFORMSIGN_DRAFT_DIAGNOSTIC_DOC_API_ORIGIN,
    tokenBase = EFORMSIGN_DRAFT_DIAGNOSTIC_TOKEN_API_ORIGIN,
): { get: jest.Mock } {
    return {
        get: jest.fn((propertyPath: string) => propertyPath === "EFORMSIGN_API_URL" ? tokenBase : docBase),
    };
}

function successFetch(id = "a".repeat(32)): jest.MockedFunction<typeof fetch> {
    return jest.fn(async () => new Response(
        JSON.stringify({ document: { id, document_status: "001" } }),
        { status: 200 },
    )) as unknown as jest.MockedFunction<typeof fetch>;
}

describe("eformsign draft diagnostic helper", () => {
    afterEach(() => jest.restoreAllMocks());

    it("serializes exactly the reduced 15-field no-notification body", () => {
        const body = buildDraftDiagnosticCreateBody();

        expect(body.template_id).toBe(EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID);
        expect(body.document.recipients).toEqual([]);
        expect(body.document.fields).toHaveLength(15);
        expect(body.document.fields.map((field) => field.id)).toEqual([...EFORMSIGN_DRAFT_DIAGNOSTIC_ALLOWLIST_FIELD_IDS]);
        expect(body.document.fields.find((field) => field.id === "이용자 성명")?.value)
            .toBe(EFORMSIGN_DRAFT_DIAGNOSTIC_SYNTHETIC_NAME);
        expect(body.document).not.toHaveProperty("document_name");
        expect(body.document).not.toHaveProperty("recipient");
        expect(body.document).not.toHaveProperty("reviewer");
        expect(JSON.stringify(body)).not.toMatch(/연락처|이메일|생년월일|주소|서명|도장|동의|provider|staff/i);
        assertDraftDiagnosticCreateBody(body);
    });

    it("uses one exact POST URL and one fetch, then fsyncs the id before read-only GETs", async () => {
        const ledgerDirectory = await secureMkdtemp();
        const events: string[] = [];
        const fetchMock = successFetch();
        fetchMock.mockImplementationOnce(async () => {
            events.push("fetch");
            const marker = await readFile(join(ledgerDirectory, "attempt.json"), "utf8");
            const result = await readFile(join(ledgerDirectory, "result.json"), "utf8");
            expect(JSON.parse(marker).status).toBe("reserved");
            expect(JSON.parse(result).status).toBe("reserved");
            return new Response(JSON.stringify({ document: { id: "a".repeat(32) } }), { status: 200 });
        });
        const api = apiFor(undefined, (id) => {
            events.push(`get:${id}`);
            if (id !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID) {
                const resultPath = join(ledgerDirectory, "result.json");
                void readFile(resultPath, "utf8").then((raw) => expect(JSON.parse(raw).documentId).toBe("a".repeat(32)));
            }
        });

        const result = await runDraftDiagnostic({
            accessToken: TEST_TOKEN,
            api,
            config: config(),
            template: templateFixture(),
            ledgerDirectory,
            fetchImpl: fetchMock,
            expectedIdentityFingerprint: completedReissueIdentityFingerprint(
                EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
                SOURCE_NAME,
                SOURCE_PHONE,
            ),
        });

        expect(result.status).toBe("created");
        expect(result.documentId).toBe("a".repeat(32));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(String(url)).toBe(`${EFORMSIGN_DRAFT_DIAGNOSTIC_DOC_API_ORIGIN}/v2.0/api/documents?template_id=${EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID}`);
        expect(init?.method).toBe("POST");
        expect(init?.headers).toEqual(expect.objectContaining({
            Authorization: `Bearer ${TEST_TOKEN}`,
            "Content-Type": "application/json",
        }));
        expect(init?.headers).toEqual(expect.objectContaining({ "Idempotency-Key": expect.any(String) }));
        expect(JSON.parse(String(init?.body))).toEqual(buildDraftDiagnosticCreateBody());
        expect(events).toEqual([
            `get:${EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID}`,
            "fetch",
            `get:${EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID}`,
            `get:${"a".repeat(32)}`,
        ]);
    });

    it("completes short writes before reading a captured document id", async () => {
        const ledgerDirectory = await secureMkdtemp();
        mockShortWrites = true;
        const api = apiFor(undefined, async (id) => {
            if (id !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID) {
                const persisted = JSON.parse(await readFile(join(ledgerDirectory, "result.json"), "utf8")) as Record<string, unknown>;
                expect(persisted["status"]).toBe("created_unverified");
                expect(persisted["documentId"]).toBe("a".repeat(32));
            }
        });

        try {
            const result = await runDraftDiagnostic({
                accessToken: TEST_TOKEN,
                api,
                config: config(),
                template: templateFixture(),
                ledgerDirectory,
                fetchImpl: successFetch(),
                expectedIdentityFingerprint: completedReissueIdentityFingerprint(
                    EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
                    SOURCE_NAME,
                    SOURCE_PHONE,
                ),
            });

            expect(result.status).toBe("created");
            expect(JSON.parse(await readFile(join(ledgerDirectory, "result.json"), "utf8"))).toMatchObject({
                status: "created",
                documentId: "a".repeat(32),
            });
        } finally {
            mockShortWrites = false;
        }
    });

    it.each([
        ["429", new Response(JSON.stringify({ code: "4000012" }), { status: 429 }), "vendor_http", 429, "4000012", "ambiguous"],
        ["5xx", new Response(JSON.stringify({ error_code: "5000001" }), { status: 503 }), "vendor_http", 503, "5000001", "ambiguous"],
        ["timeout", new DOMException("timed out", "TimeoutError"), "timeout", null, null, "ambiguous"],
        ["network", new TypeError("connection reset"), "transport", null, null, "ambiguous"],
    ] as const)("makes exactly one POST attempt for %s and records only safe failure metadata", async (_label, failure, category, httpStatus, vendorCode, resultStatus) => {
        const ledgerDirectory = await secureMkdtemp();
        const fetchMock = jest.fn(async () => {
            if (failure instanceof Response) return failure;
            throw failure;
        }) as unknown as jest.MockedFunction<typeof fetch>;

        await expect(runDraftDiagnostic({
            accessToken: TEST_TOKEN,
            api: apiFor(),
            config: config(),
            template: templateFixture(),
            ledgerDirectory,
            fetchImpl: fetchMock,
            expectedIdentityFingerprint: completedReissueIdentityFingerprint(
                EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
                SOURCE_NAME,
                SOURCE_PHONE,
            ),
        })).rejects.toMatchObject({ metadata: { category, httpStatus, vendorCode } });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const result = JSON.parse(await readFile(join(ledgerDirectory, "result.json"), "utf8")) as Record<string, unknown>;
        expect(result).toMatchObject({ status: resultStatus, failureCategory: category, httpStatus, vendorCode });
        expect(result).not.toHaveProperty("error");
        expect(result).not.toHaveProperty("message");
        expect(JSON.stringify(result)).not.toContain(TEST_TOKEN);
        expect(JSON.stringify(result)).not.toContain("connection reset");
        expect(JSON.stringify(result)).not.toContain("timed out");
    });

    it("retains a known document id as created_unverified when a postcondition fails", async () => {
        const ledgerDirectory = await secureMkdtemp();
        const changedSource = sourceDocument();
        changedSource.fields = (changedSource.fields ?? []).map((field) => field.id === "서비스 기간"
            ? { ...field, value: "changed" }
            : field);

        await expect(runDraftDiagnostic({
            accessToken: TEST_TOKEN,
            api: apiFor([sourceDocument(), changedSource, newDocument()]),
            config: config(),
            template: templateFixture(),
            ledgerDirectory,
            fetchImpl: successFetch(),
            expectedIdentityFingerprint: completedReissueIdentityFingerprint(
                EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
                SOURCE_NAME,
                SOURCE_PHONE,
            ),
        })).rejects.toMatchObject({ metadata: { category: "postcondition" } });

        expect(JSON.parse(await readFile(join(ledgerDirectory, "result.json"), "utf8"))).toMatchObject({
            status: "created_unverified",
            documentId: "a".repeat(32),
            failureCategory: "postcondition",
        });
    });

    it("preserves a numeric vendor code when a 200 body has no document id", async () => {
        const ledgerDirectory = await secureMkdtemp();
        const fetchMock = jest.fn(async () => new Response(JSON.stringify({ code: "4000012" }), { status: 200 })) as unknown as jest.MockedFunction<typeof fetch>;

        await expect(runDraftDiagnostic({
            accessToken: TEST_TOKEN,
            api: apiFor(),
            config: config(),
            template: templateFixture(),
            ledgerDirectory,
            fetchImpl: fetchMock,
            expectedIdentityFingerprint: completedReissueIdentityFingerprint(
                EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
                SOURCE_NAME,
                SOURCE_PHONE,
            ),
        })).rejects.toMatchObject({ metadata: { category: "response_shape", httpStatus: 200, vendorCode: "4000012" } });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(JSON.parse(await readFile(join(ledgerDirectory, "result.json"), "utf8"))).toMatchObject({
            status: "ambiguous",
            documentId: null,
            failureCategory: "response_shape",
            httpStatus: 200,
            vendorCode: "4000012",
        });
    });

    it("records a response-body failure without leaking the raw body", async () => {
        const ledgerDirectory = await secureMkdtemp();
        const raw = `secret-token-and-phone ${TEST_TOKEN} 010-0000-0000`;
        const fetchMock = jest.fn(async () => ({
            status: 200,
            ok: true,
            json: async () => { throw new Error(raw); },
        })) as unknown as jest.MockedFunction<typeof fetch>;

        await expect(runDraftDiagnostic({
            accessToken: TEST_TOKEN,
            api: apiFor(),
            config: config(),
            template: templateFixture(),
            ledgerDirectory,
            fetchImpl: fetchMock,
            expectedIdentityFingerprint: completedReissueIdentityFingerprint(
                EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
                SOURCE_NAME,
                SOURCE_PHONE,
            ),
        })).rejects.toMatchObject({ metadata: { category: "response_body", httpStatus: 200, vendorCode: null } });

        const result = await readFile(join(ledgerDirectory, "result.json"), "utf8");
        expect(result).not.toContain(raw);
        expect(result).not.toContain(TEST_TOKEN);
        expect(result).not.toContain(SOURCE_PHONE);
        expect(JSON.parse(result)).toMatchObject({ status: "ambiguous" });
    });

    it("requires exact official live origins before vendor work", () => {
        expect(() => assertDraftDiagnosticOfficialLiveOrigins(config())).not.toThrow();
        expect(() => assertDraftDiagnosticOfficialLiveOrigins(
            config(EFORMSIGN_DRAFT_DIAGNOSTIC_DOC_API_ORIGIN, `${EFORMSIGN_DRAFT_DIAGNOSTIC_TOKEN_API_ORIGIN}/v2`),
        )).toThrow();
        expect(() => assertDraftDiagnosticOfficialLiveOrigins(
            config(`${EFORMSIGN_DRAFT_DIAGNOSTIC_DOC_API_ORIGIN}/v2.0/api`, EFORMSIGN_DRAFT_DIAGNOSTIC_TOKEN_API_ORIGIN),
        )).toThrow();
        expect(() => assertDraftDiagnosticOfficialLiveOrigins(
            config(EFORMSIGN_DRAFT_DIAGNOSTIC_DOC_API_ORIGIN, "https://user:pass@api.eformsign.com"),
        )).toThrow();
    });

    it("blocks an existing operation before any GET or POST", async () => {
        const ledgerDirectory = await secureMkdtemp();
        await writeFile(join(ledgerDirectory, "attempt.json"), "existing", { mode: 0o600 });
        const fetchMock = successFetch();
        const api = apiFor();

        await expect(runDraftDiagnostic({
            accessToken: TEST_TOKEN,
            api,
            config: config(),
            template: templateFixture(),
            ledgerDirectory,
            fetchImpl: fetchMock,
            expectedIdentityFingerprint: completedReissueIdentityFingerprint(
                EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
                SOURCE_NAME,
                SOURCE_PHONE,
            ),
        })).rejects.toMatchObject({ name: "DraftDiagnosticAlreadyAttemptedError" });

        expect(fetchMock).not.toHaveBeenCalled();
        expect(api.getDocument).not.toHaveBeenCalled();
    });

    it("requires exact identity and topology guards", () => {
        const source = sourceDocument();
        expect(assertDraftDiagnosticSourceBaseline(
            source,
            completedReissueIdentityFingerprint(EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID, SOURCE_NAME, SOURCE_PHONE),
        )).toHaveLength(64);
        expect(() => assertDraftDiagnosticSourceBaseline(
            { ...source, current_status: { ...source.current_status, status_type: "001" } },
            EFORMSIGN_COMPLETED_REISSUE_EXPECTED_IDENTITY_FINGERPRINT,
        )).toThrow();
        expect(() => assertDraftDiagnosticNewDocument(newDocument(), "b".repeat(32))).toThrow();
        expect(exactJestTestNamePattern(EFORMSIGN_DRAFT_DIAGNOSTIC_CREATE_FULL_TEST_NAME)).toContain("^");
        expect(hasExactJestTestNameSelector(EFORMSIGN_DRAFT_DIAGNOSTIC_CREATE_FULL_TEST_NAME, [
            "node", "jest", "--testNamePattern", exactJestTestNamePattern(EFORMSIGN_DRAFT_DIAGNOSTIC_CREATE_FULL_TEST_NAME),
        ])).toBe(true);
        expect(hasExactJestTestNameSelector(EFORMSIGN_DRAFT_DIAGNOSTIC_CREATE_FULL_TEST_NAME, [
            "node", "jest", "--testNamePattern", "draft diagnostic",
        ])).toBe(false);
        expect(isCompletedReissueLiveGate(EFORMSIGN_DRAFT_DIAGNOSTIC_CREATE_FULL_TEST_NAME, { LIVE_E2E: "1" }, [
            "node", "jest", "--testNamePattern", exactJestTestNamePattern(EFORMSIGN_DRAFT_DIAGNOSTIC_CREATE_FULL_TEST_NAME),
        ])).toBe(true);
    });

    it("keeps the fixed ledger directory secure", async () => {
        expect(EFORMSIGN_DRAFT_DIAGNOSTIC_LEDGER_DIRECTORY).toBe("/Users/jaino/.local/state/babyjamjam/phase0-draft-diagnostic");
        const directory = await secureMkdtemp();
        await chmod(directory, 0o700);
        expect((await stat(directory)).mode & 0o777).toBe(0o700);
        expect(await readdir(directory)).toEqual([]);
    });
});
