import { assertLoginFailureContract, authFailureCode, sourceFailureCode, capabilityMatches, refusalEmail, scrubEnvironment } from "./eformsign-backup-fixture-app";
import { A, B, USERS, documentId, frozenDocuments, exerciseIntent } from "./eformsign-backup-fixture-data";

// Loading the generated client discovers backend/.env, even without a connection.
// Ordinary fixture helper imports must never initialize that loader.
jest.mock("@prisma/client", () => { throw new Error("INERT_IMPORT_LOADED_PRISMA"); });

describe("inert backup fixture helpers (no credentials or database)", () => {
    it("accepts canonical failed-login HTTP 201 independently of localized messages", () => {
        const rows = { sessions: ["session-b", "session-a"], refresh: ["refresh-a"] };
        for (const message of ["synthetic rejection", "다른 언어의 실패 메시지"]) {
            expect(() => assertLoginFailureContract({ status: 201, json: { success: false, message } }, rows, { ...rows, sessions: [...rows.sessions].reverse() })).not.toThrow();
        }
    });
    it("rejects wrong transport/success shapes without misclassifying them as rate limiting", () => {
        const rows = { sessions: [], refresh: [] };
        for (const response of [{ status: 401, json: { success: false } }, { status: 201, json: { success: true } }, { status: 201, json: {} }]) {
            expect(() => assertLoginFailureContract(response, rows, rows)).toThrow("LOGIN_FAILURE_CONTRACT_ORACLE");
        }
        expect(authFailureCode(new Error("LOGIN_FAILURE_CONTRACT_ORACLE"))).toBe("LOGIN_FAILURE_CONTRACT_ORACLE");
        expect(authFailureCode(new Error("REAL_RATE_LIMIT_ORACLE"))).toBe("REAL_RATE_LIMIT_ORACLE");
    });
    it("refuses authentication-success fields on a failed login even if empty or null", () => {
        const rows = { sessions: [], refresh: [] };
        for (const key of ["accessToken", "refreshToken", "user", "requiresBranchSelection", "onboardingRequired", "pendingAccountOnboardingToken", "data"]) {
            for (const value of [null, "", false, "synthetic-canary"]) {
                expect(() => assertLoginFailureContract({ status: 201, json: { success: false, [key]: value } }, rows, rows)).toThrow("LOGIN_FAILURE_CONTRACT_ORACLE");
            }
        }
    });
    it("refuses new or replaced session/refresh rows even when counts stay unchanged", () => {
        const rows = { sessions: ["session-a"], refresh: ["refresh-a"] };
        for (const after of [
            { ...rows, sessions: ["session-a", "session-b"] }, { ...rows, refresh: ["refresh-a", "refresh-b"] },
            { ...rows, sessions: ["session-b"] }, { ...rows, refresh: ["refresh-b"] },
        ]) expect(() => assertLoginFailureContract({ status: 201, json: { success: false } }, rows, after)).toThrow("LOGIN_FAILURE_CONTRACT_ORACLE");
    });
    it("reports only known authentication oracle codes and discards raw failures", () => {
        expect(authFailureCode(new Error("REAL_ME_FAILED"))).toBe("REAL_ME_FAILED");
        for (const error of [new Error("CANARY_PRIVATE_FAILURE"), new Error("secret@example.invalid"), "REAL_ME_FAILED", { message: "REAL_ME_FAILED" }]) expect(authFailureCode(error)).toBeUndefined();
    });
    it("reports only fixed source oracle codes without leaking raw HTTP or database failures", () => {
        expect(sourceFailureCode(new Error("MACHINE_COUNTS_ORACLE"))).toBe("MACHINE_COUNTS_ORACLE");
        for (const error of [new Error("CANARY_PRIVATE_FAILURE"), new Error("secret@example.invalid"), "MACHINE_COUNTS_ORACLE", { message: "MACHINE_COUNTS_ORACLE" }]) expect(sourceFailureCode(error)).toBeUndefined();
    });
    it("keeps the literal stage, raw status, kind and classification oracle", () => {
        const rows = frozenDocuments("basic");
        expect(rows).toHaveLength(13);
        expect(rows.filter(r => r.branchId === A && r.classification === "included").map(r => r.documentId)).toEqual([4, 5, 6, 9, 10].map(documentId));
        expect(rows.slice(0, 10).map(r => [r.stage, r.statusType])).toEqual([
            ["created", "001"], ["sent", "030"], ["opened", "034"], ["signed", "062"], ["reviewed", "072"], ["completed", "003"],
            ["created", "001"], ["sent", "030"], ["reviewed", "072"], ["completed", "003"],
        ]);
        expect(rows.slice(0, 10).map(r => r.classification)).toEqual([
            "excluded_by_policy", "excluded_by_policy", "policy_pending", "included", "included", "included",
            "excluded_by_policy", "excluded_by_policy", "included", "included",
        ]);
        expect(rows.slice(10).every(r => r.classification === "excluded_by_policy")).toBe(true);
        expect(rows.filter(r => r.branchId === B)).toHaveLength(1);
        expect(USERS[0]).toBe("10000000-0000-4000-8000-000000000010");
        expect(documentId(10)).toBe("20000000-0000-4000-8000-00000000000a");
    });
    it.each([
        ["basic", A, 12, 6], ["kst", A, 12, 6], ["pagination", A, 133, 127],
        ["basic", null, 13, 7], ["kst", null, 13, 7], ["pagination", null, 134, 128],
    ] as const)("freezes %s counts for branch %s", (profile, branch, total, excludedByPolicy) => {
        const rows = frozenDocuments(profile).filter(r => branch === null || r.branchId === branch);
        // Count only the frozen input literals. No classifier/projector/runtime oracle.
        expect({
            total: rows.length,
            included: rows.filter(r => r.classification === "included").length,
            excludedByPolicy: rows.filter(r => r.classification === "excluded_by_policy").length,
            policyPending: rows.filter(r => r.classification === "policy_pending").length,
            inaccessible: rows.filter(r => r.classification === "inaccessible").length,
            unknownTemplate: rows.filter(r => r.classification === "unknown_template").length,
        }).toEqual({ total, included: 5, excludedByPolicy, policyPending: 1, inaccessible: 0, unknownTemplate: 0 });
        expect(rows.filter(r => r.classification === "policy_pending").map(r => [r.documentId, r.stage, r.statusType])).toEqual([[documentId(3), "opened", "034"]]);
    });
    it("freezes pagination as 121 metadata-only selections and KST inclusive/exclusive boundaries", () => {
        expect(frozenDocuments("pagination").filter(r => r.branchId === A)).toHaveLength(133);
        const pagination = exerciseIntent("pagination");
        expect(pagination.ids).toHaveLength(121);
        expect(pagination.ids[0]).toBe(documentId(1001));
        expect(pagination.ids[120]).toBe(documentId(1121));
        expect(pagination.saved).toBe(0);
        expect(pagination.metadataOnly).toBe(121);
        expect(exerciseIntent("kst").ids).toEqual([documentId(1), documentId(12)]);
        expect(exerciseIntent("basic").scope.recordStages).toEqual(["reviewed"]);
    });
    it("refuses every email operation without reporting provider success", async () => {
        const email = refusalEmail();
        await expect(email.adapter.send({ to: "synthetic@example.invalid", subject: "synthetic", html: "" })).rejects.toThrow("QA_EMAIL_REFUSED");
        await expect(email.adapter.sendVerificationEmail("synthetic@example.invalid", null, "http://127.0.0.1")).rejects.toThrow("QA_EMAIL_REFUSED");
        await expect(email.adapter.sendPasswordResetEmail("synthetic@example.invalid", null, "http://127.0.0.1")).rejects.toThrow("QA_EMAIL_REFUSED");
        expect(email.count()).toBe(3);
    });
    it("checks a fixed capability including length without accepting coercion", () => {
        expect(capabilityMatches("a".repeat(64), "a".repeat(64))).toBe(true);
        for (const supplied of [undefined, ["a".repeat(64)], "a".repeat(63), "b".repeat(64)]) expect(capabilityMatches("a".repeat(64), supplied)).toBe(false);
    });
    it("scrubs before dynamic auth imports and enables actual tenant/PG guard behavior", () => {
        const previous = { ...process.env };
        try {
            Object.assign(process.env, { DATABASE_URL: "CANARY_DB", VALKEY_URL: "CANARY_VALKEY", AUTH_RATE_LIMIT_DISABLED: "true", RESEND_API_KEY: "CANARY_PROVIDER", LOCAL_AUTO_LOGIN_PASSWORD: "CANARY_PASSWORD" });
            scrubEnvironment("postgresql://synthetic@127.0.0.1:63241/owned?connection_limit=5", "/synthetic/backend");
            expect(process.env["TENANT_ISOLATION_MODE"]).toBe("enforce");
            expect(process.env["SCHEDULERS_ENABLED"]).toBe("false");
            expect(process.env["VALKEY_URL"]).toBeUndefined();
            expect(process.env["AUTH_RATE_LIMIT_DISABLED"]).toBeUndefined();
            expect(process.env["RESEND_API_KEY"]).toBeUndefined();
            expect(process.env["LOCAL_AUTO_LOGIN_PASSWORD"]).toBeUndefined();
            expect(process.env["DATABASE_URL"]).toBe(process.env["DIRECT_URL"]);
            expect(process.env["JWT_SECRET"]!.length).toBeGreaterThan(40);
        } finally { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, previous); }
    });
});
