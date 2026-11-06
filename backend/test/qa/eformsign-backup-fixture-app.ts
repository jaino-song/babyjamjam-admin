import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import type { INestApplication } from "@nestjs/common";
import { WorkerError } from "domain/eformsign-backup/worker/worker-error";
import type { EmailPort } from "domain/ports/email.port";
import {
    A, B, COMPANY, USERS, RECORD_TEMPLATE, TEMPLATE, demand, seed, cleanup,
    frozenDocuments, exerciseIntent, attributableRows, assertOtherTablesEmpty,
    type Profile, type PrivateCredentials, type Seeded,
} from "./eformsign-backup-fixture-data";
import type { FixtureConsumer } from "./eformsign-backup-fixture-worker";
import { buildMinimalPdf } from "../infrastructure/eformsign-backup/worker/helpers/pdf-fixture-minimal";

export function scrubEnvironment(url: string, backend: string): void {
    const allowed: Record<string, string> = {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin", NODE_PATH: backend,
        TS_NODE_PROJECT: path.join(backend, "tsconfig.json"), NODE_ENV: "development",
        DATABASE_URL: url, DIRECT_URL: url, DATABASE_CONNECTION_MODE: "direct", TENANT_ISOLATION_MODE: "enforce", SCHEDULERS_ENABLED: "false",
        JWT_SECRET: randomBytes(48).toString("base64url"), DEVELOPMENT_FRONTEND_URL: "http://127.0.0.1:3003",
        EFORMSIGN_COMPANY_ID: COMPANY, EFORMSIGN_TEMPLATE_ID: TEMPLATE,
        EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID: RECORD_TEMPLATE, EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID_10: RECORD_TEMPLATE,
        EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID_15: RECORD_TEMPLATE, EFORMSIGN_SERVICE_RECORD_TEMPLATE_ID_20: RECORD_TEMPLATE,
        KAKAO_CLIENT_ID: "synthetic-qa-constructor", KAKAO_CALLBACK_URL: "http://127.0.0.1:3003/auth/kakao/callback",
    };
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, allowed);
}

export function refusalEmail() {
    let refused = 0;
    const reject = async (): Promise<string> => { refused++; throw new Error("QA_EMAIL_REFUSED"); };
    const adapter: EmailPort = { send: reject, sendVerificationEmail: reject, sendPasswordResetEmail: reject };
    return { adapter, count: () => refused };
}
export function capabilityMatches(expected: string, actual: unknown): boolean {
    return typeof actual === "string" && Buffer.byteLength(actual) === Buffer.byteLength(expected)
        && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
interface FixtureOptions {
    url: string; backend: string; session: string; port: number; profile: Profile; owner: PrivateCredentials;
    capability: string; nonce: string; nativeOnly: boolean; manifest: { path: string; digest: string };
}
type Json = Record<string, unknown>;
export function assertPublicManualRun(run: Json): void {
    const keys = ["id", "status", "scope", "cut", "createdAt", "startedAt", "finishedAt", "summary", "coverage", "backupComplete", "failureCode"];
    demand(Object.keys(run).length === keys.length && Object.keys(run).every(k => keys.includes(k)), "PUBLIC_RUN_FIELDS_ORACLE");
    demand(run["coverage"] === "unverified" && run["backupComplete"] === false, "PUBLIC_RUN_FIELDS_ORACLE");
    const summary = run["summary"] as Json;
    demand(summary && Object.keys(summary).sort().join() === "attention,drive,local,metadataOnly,saved,target", "PUBLIC_RUN_FIELDS_ORACLE");
    for (const key of ["local", "drive"]) {
        const result = summary[key] as Json;
        demand(result && Object.keys(result).sort().join() === "saved,state", "PUBLIC_RUN_FIELDS_ORACLE");
    }
}
export function assertPublicManualDocument(document: Json): void {
    const keys = ["documentId", "ordinal", "kind", "currentMilestone", "documentCreatedAt", "classification", "local", "drive"];
    demand(Object.keys(document).length === keys.length && Object.keys(document).every(k => keys.includes(k)), "PUBLIC_DOCUMENT_FIELDS_ORACLE");
    for (const key of ["local", "drive"]) demand(["verified", "partial", "blocked", "unverified", "metadata_only", "not_required"].includes(String(document[key])), "PUBLIC_DOCUMENT_FIELDS_ORACLE");
}
export function assertNativeDocumentObservations(profile: Profile, documents: readonly Json[]): void {
    // C1 reports unconfigured Drive as not_required before evaluating metadata
    // eligibility; aggregate Drive remains excluded for every native scope.
    demand(documents.every(d => d["local"] === (profile === "basic" ? "verified" : "metadata_only")
        && d["drive"] === "not_required"), "PRODUCT_OBSERVATION_ORACLE");
}
export async function assertNativeLocalArtifacts(session: string, profile: Profile, documents: readonly string[]): Promise<void> {
    for (const document of documents) {
        const artifactRoot = path.join(session, "archive", "eformsign", COMPANY, document, "artifacts");
        if (profile === "basic") {
            for (const type of ["document", "audit_trail"]) {
                const expected = buildMinimalPdf(`backup-qa ${document} ${type}`);
                const digest = createHash("sha256").update(expected).digest("hex");
                // Mirror file types use underscores; C1 archive keys use hyphens.
                const archiveType = type === "audit_trail" ? "audit-trail" : type;
                const actual = await fs.readFile(path.join(artifactRoot, archiveType, `${digest}.pdf`))
                    .catch(() => { throw new Error("LOCAL_ARTIFACT_ORACLE"); });
                demand(actual.equals(expected), "LOCAL_ARTIFACT_ORACLE");
            }
        } else {
            const entries = await fs.readdir(artifactRoot).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
            demand(entries.length === 0, "METADATA_ONLY_LOCAL_ORACLE");
        }
    }
}
interface AuthRows { sessions: string[]; refresh: string[] }
// Frozen ea7513ab: AuthController.login returns { success:false, message } on
// invalid credentials (POST's default 201), before AuthService issues a session.
// Compare security meaning; never inspect or publish the localized message.
export function assertLoginFailureContract(response: { status: number; json: Json }, before: AuthRows, after: AuthRows): void {
    const sameIds = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    demand(response.status === 201 && response.json?.["success"] === false
        && Object.keys(response.json).every(key => key === "success" || key === "message")
        && sameIds(before.sessions, after.sessions) && sameIds(before.refresh, after.refresh), "LOGIN_FAILURE_CONTRACT_ORACLE");
}
export function authFailureCode(error: unknown): string | undefined {
    const codes = ["LOGIN_FAILURE_CONTRACT_ORACLE", "REAL_LOGIN_FAILED", "REAL_RATE_LIMIT_ORACLE", "OWNER_BRANCH_SELECTION_MISSING", "REAL_BRANCH_SELECTION_FAILED", "REAL_ME_FAILED", "NO_JWT_ORACLE", "UNSELECTED_JWT_ORACLE", "OWNER_ORACLE", "VIEWER_ORACLE", "SPOOF_ORACLE", "SELECT_B_ORACLE"];
    return error instanceof Error && codes.includes(error.message) ? error.message : undefined;
}
export function sourceFailureCode(error: unknown): string | undefined {
    const codes = ["MACHINE_GUARD_ORACLE", "MACHINE_COMPANY_ORACLE", "MACHINE_SNAPSHOT_ORACLE", "MACHINE_COUNTS_ORACLE", "MACHINE_PAGE_ORACLE", "FROZEN_EXPORT_ORACLE", "FROZEN_STAGE_ORACLE", "SOURCE_COUNTS_ORACLE", "FROZEN_DATE_ORACLE", "METADATA_ARTIFACT_ORACLE"];
    return error instanceof Error && codes.includes(error.message) ? error.message : undefined;
}
export function phaseFailureCode(error: unknown): string {
    const codes = [
    "CLAIM_LIMIT",
    "EXERCISE_TIMEOUT",
    "FOREIGN_BRANCH",
    "FOREIGN_CANDIDATE",
    "FOREIGN_COUNTER",
    "FOREIGN_CREDENTIAL",
    "FOREIGN_DOCUMENT",
    "FOREIGN_FILE",
    "FOREIGN_MEMBERSHIP",
    "FOREIGN_REFRESH",
    "FOREIGN_RESULT",
    "FOREIGN_ROWS",
    "FOREIGN_RUN",
    "FOREIGN_SESSION",
    "FOREIGN_SNAPSHOT",
    "FOREIGN_USER",
    "LOCAL_ARTIFACT_ORACLE",
    "MANUAL_ERROR_ORACLE",
    "MANUAL_RENEWED_ORACLE",
    "MANUAL_STALE_ORACLE",
    "METADATA_ONLY_LOCAL_ORACLE",
    "NATIVE_PAGINATION_REQUIRED",
    "PRODUCT_BRANCH_ORACLE",
    "PRODUCT_COVERAGE_ORACLE",
    "PRODUCT_DOCUMENTS_FAILED",
    "PRODUCT_DRIVE_ORACLE",
    "PRODUCT_GET_FAILED",
    "PRODUCT_IDEMPOTENCY_ORACLE",
    "PRODUCT_OBSERVATION_ORACLE",
    "PRODUCT_PAGINATION_ORACLE",
    "PRODUCT_PHASE_UNKNOWN",
    "PRODUCT_POST_FAILED",
    "PRODUCT_ROUTES_UNAVAILABLE",
    "PRODUCT_SELECTION_ORACLE",
    "PRODUCT_SUMMARY_ORACLE",
    "PROFILE_NOT_SEEDED",
    "PUBLIC_DOCUMENT_FIELDS_ORACLE",
    "PUBLIC_RUN_FIELDS_ORACLE",
    "SESSION_LIMIT"
];
    return error instanceof Error && codes.includes(error.message) ? error.message : "NATIVE_PHASE_FAILED";
}
function sendSafe(message: unknown): void {
    if (process.connected) process.send?.(message as object, () => undefined);
}
async function request(base: string, route: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
    demand(/^http:\/\/127\.0\.0\.1:\d+$/.test(base));
    demand(route.startsWith("/") && !route.startsWith("//"));
    const response = await fetch(base + route, {
        method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const bytes = await response.text();
    demand(bytes.length <= 2_000_000, "HTTP_BODY_LIMIT");
    let json: Json = {};
    try { json = JSON.parse(bytes) as Json; } catch { /* Failure is checked by the caller, never prints the body. */ }
    return { status: response.status, json, rateLimit: response.headers.get("RateLimit-Limit") };
}

/** Dynamic imports below intentionally occur after environment scrub and private chdir. */
export async function createFixture(options: FixtureOptions) {
    scrubEnvironment(options.url, options.backend);
    demand(require.main === module && process.connected, "NATIVE_ENTRY_REQUIRED");
    const transport = createRequire(__filename)(path.join(options.backend, "scripts/eformsign-backup-qa.mjs")) as {
        environmentSnapshot(): Record<string, string | undefined>;
        assertEnvironment(snapshot: Record<string, string | undefined>): void;
        installPrivateAlias(file: string, digest: string): Promise<{ exports: typeof import("@prisma/client"); audit(): void }>;
    };
    const environment = transport.environmentSnapshot();
    const { exports: privateClient, audit } = await transport.installPrivateAlias(options.manifest.path, options.manifest.digest);
    const { PrismaClient } = privateClient;
    const unchanged = () => { transport.assertEnvironment(environment); audit(); };
    const common = await import("@nestjs/common");
    common.Logger.overrideLogger(false);
    const [{ Test }, { ConfigModule }, { DatabaseModule }, { SchedulerLeaseModule }, { AuthModule }, { TenantModule }, { EformsignBackupExportModule }, { TenantAlsMiddleware }, { JwtGuard }, { TenantGuard }, { BranchManagerGuard }, { CurrentTenant }] = await Promise.all([
        import("@nestjs/testing"), import("@nestjs/config"), import("infrastructure/database/database.module"),
        import("module/scheduler-lease.module"), import("infrastructure/auth/auth.module"), import("infrastructure/tenant/tenant.module"),
        import("module/eformsign-backup-export.module"), import("infrastructure/tenant/tenant-als.middleware"),
        import("infrastructure/auth/jwt.guard"), import("infrastructure/tenant/tenant.guard"),
        import("infrastructure/auth/branch-manager.guard"), import("infrastructure/tenant/current-tenant.decorator"),
    ]);
    unchanged();
    const { EMAIL_PORT } = await import("domain/ports/email.port");
    const { Controller, Get, UseGuards, Module } = common;
    @Controller("__qa__")
    class ManagerProof {
        @Get("manager-proof")
        @UseGuards(JwtGuard, TenantGuard, BranchManagerGuard)
        proof(@CurrentTenant() tenant: { userId: string; branchId: string }) {
            return { allowed: true, userId: tenant.userId, branchId: tenant.branchId };
        }
    }
    @Module({
        imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), DatabaseModule, SchedulerLeaseModule, AuthModule, TenantModule, EformsignBackupExportModule],
        controllers: [ManagerProof],
    })
    class FixtureModule {
        configure(consumer: import("@nestjs/common").MiddlewareConsumer): void {
            consumer.apply(TenantAlsMiddleware).forRoutes("*");
        }
    }
    const email = refusalEmail();
    const db = new PrismaClient({ datasources: { db: { url: options.url } }, log: [] });
    unchanged();
    let app: INestApplication | undefined;
    let seeded: Seeded | undefined;
    let consumer: FixtureConsumer | undefined;
    let closed = false;
    let base = "";
    let ownerToken = "";
    let available = false;
    let workerHttp = { operation: "none", status: 0 };
    let queue: Promise<unknown> = Promise.resolve();
    let stage = "database";
    let phaseStage: "routeprobe" | "consumer-init" | "manual-negative" | "manual-stale" | "basic" | "pagination" | "kst" | "cleanup" = "routeprobe";
    let phaseStep: "routeprobe" | "consumer-init" | "manual-negative" | "manual-stale" | "post" | "idempotency" | "selectB" | "crossbranchread" | "restoreA" | "capture" | "consume" | "readresults" | "artifactcheck" | "cleanup" = "routeprobe";
    const started = performance.now();
    const record = async (rows: unknown) => {
        const bytes = JSON.stringify(rows);
        await fs.appendFile(path.join(options.session, "row-history.jsonl"), bytes + "\n", { mode: 0o600 });
        await fs.writeFile(path.join(options.session, "rows.json"), bytes, { mode: 0o600 });
    };
    let captureQueue = Promise.resolve();
    const capture = () => {
        captureQueue = captureQueue.then(async () => {
            if (!seeded) return;
            const previousStep = phaseStep;
            if (stage === "phase") phaseStep = "capture";
            await assertOtherTablesEmpty(db);
            await record(await attributableRows(db, options.profile, seeded.credentialId, seeded.accounts.map(a => a.email)));
            phaseStep = previousStep;
        });
        return captureQueue;
    };
    const http = async (...args: Parameters<typeof request>) => {
        await capture();
        try { return await request(...args); } finally { await capture(); }
    };
    let closing: Promise<void> | undefined;
    function close(): Promise<void> {
        if (closing) return closing;
        closed = true;
        closing = (async () => {
            let resourcesClosed = true;
            try {
                // Always close HTTP and DB even if worker close fails. Only proven
                // resource closure and attributable rows permit scoped cleanup.
                try { await consumer?.close(); } catch { resourcesClosed = false; }
                try { await app?.close(); } catch { resourcesClosed = false; }
                try { await captureQueue; } catch { resourcesClosed = false; }
                if (resourcesClosed && seeded) await cleanup(db, options.profile, seeded, record);
                demand(resourcesClosed, "NATIVE_CLEANUP_FAILED");
                unchanged();
            } finally { await db.$disconnect(); }
        })();
        return closing;
    }
    async function login(account: PrivateCredentials, expectedUser: string, owner = false) {
        const key = createHash("sha256").update(`post:login:identity:127.0.0.1:${account.email.trim().toLowerCase()}`).digest("hex");
        const authRows = async (): Promise<AuthRows> => ({
            sessions: (await db.auth_session.findMany({ where: { userId: expectedUser }, select: { id: true } })).map(row => row.id),
            refresh: (await db.auth_refresh_token.findMany({ where: { session: { userId: expectedUser } }, select: { id: true } })).map(row => row.id),
        });
        const rowsBefore = await authRows();
        const rejected = await http(base, "/auth/login", undefined, { email: account.email, password: randomBytes(32).toString("hex") });
        const rowsAfter = await authRows();
        const before = await db.auth_rate_limit.findUnique({ where: { keyHash: key }, select: { count: true } });
        // Keep transport/authentication failures distinct from disabled limiting.
        // Only fixed status/booleans and a classified header cross the IPC boundary.
        let failureContract = false;
        try { assertLoginFailureContract(rejected, rowsBefore, rowsAfter); failureContract = true; }
        finally {
            sendSafe({ stage: "rate-limit-proof", status: rejected.status, failureContract,
                header: rejected.rateLimit === "5" ? "identity5" : rejected.rateLimit === "100" ? "ip100" : rejected.rateLimit === null ? "absent" : "unknown",
                normalCredentialRejection: rejected.status === 201 && rejected.json?.["success"] === false,
                identityCounterOne: before?.count === 1 });
        }
        demand(rejected.rateLimit === "5", "REAL_RATE_LIMIT_ORACLE");
        demand(before?.count === 1, "REAL_RATE_LIMIT_ORACLE");
        const login = await http(base, "/auth/login", undefined, account);
        demand(login.status === 201 && login.json["success"] === true && typeof login.json["accessToken"] === "string" && login.json["accessToken"].length > 0
            && typeof login.json["refreshToken"] === "string" && login.json["refreshToken"].length > 0, "REAL_LOGIN_FAILED");
        demand(login.rateLimit === "5", "REAL_RATE_LIMIT_ORACLE");
        demand(await db.auth_rate_limit.count({ where: { keyHash: key } }) === 0, "REAL_RATE_LIMIT_ORACLE");
        const ipKey = createHash("sha256").update("post:login:ip:127.0.0.1:").digest("hex");
        demand((await db.auth_rate_limit.findUnique({ where: { keyHash: ipKey }, select: { count: true } }))!.count >= 2, "REAL_RATE_LIMIT_ORACLE");
        if (owner) {
            demand(login.json["requiresBranchSelection"] === true, "OWNER_BRANCH_SELECTION_MISSING");
            demand((await http(base, "/__qa__/manager-proof", login.json["accessToken"] as string)).status === 403, "UNSELECTED_JWT_ORACLE");
            demand((await http(base, "/eformsign-backups/runs", login.json["accessToken"] as string)).status === 403, "UNSELECTED_JWT_ORACLE");
        }
        const select = await http(base, "/auth/select-branch", login.json["accessToken"] as string, { branchId: A });
        demand(select.status === 201 && select.json["success"] === true && typeof select.json["accessToken"] === "string" && select.json["accessToken"].length > 0
            && typeof select.json["refreshToken"] === "string" && select.json["refreshToken"].length > 0, "REAL_BRANCH_SELECTION_FAILED");
        const token = select.json["accessToken"] as string;
        const me = await http(base, "/auth/me", token);
        demand(me.status === 200 && me.json["id"] === expectedUser && me.json["branchId"] === A, "REAL_ME_FAILED");
        return token;
    }
    async function authOracle() {
        demand(seeded);
        demand((await http(base, "/__qa__/manager-proof")).status === 401, "NO_JWT_ORACLE");
        demand((await http(base, "/eformsign-backups/runs")).status === 401, "NO_JWT_ORACLE");
        ownerToken = await login(seeded.accounts[0]!, USERS[0]!, true);
        const proof = await http(base, "/__qa__/manager-proof", ownerToken);
        demand(proof.status === 200 && proof.json["branchId"] === A && proof.json["userId"] === USERS[0], "OWNER_ORACLE");
        demand((await http(base, "/eformsign-backups/runs", ownerToken)).status === 200, "OWNER_ORACLE");
        const viewer = await login(seeded.accounts[1]!, USERS[1]!);
        demand((await http(base, "/__qa__/manager-proof", viewer)).status === 403, "VIEWER_ORACLE");
        demand((await http(base, "/eformsign-backups/runs", viewer)).status === 403, "VIEWER_ORACLE");
        const admin = await login(seeded.accounts[2]!, USERS[2]!);
        const spoof = await http(base, "/__qa__/manager-proof", admin, undefined, { "X-Branch-Id": B });
        demand(spoof.status === 200 && spoof.json["branchId"] === A && spoof.json["userId"] === USERS[2], "SPOOF_ORACLE");
        const manual = await http(base, "/eformsign-backups/runs", admin, undefined, { "X-Branch-Id": B });
        demand(manual.status === 200 && Array.isArray(manual.json["items"]) && manual.json["items"].length === 0, "SPOOF_ORACLE");
        demand((await http(base, "/auth/select-branch", admin, { branchId: B })).status === 403, "SELECT_B_ORACLE");
        const afterDenied = await http(base, "/__qa__/manager-proof", admin);
        demand(afterDenied.status === 200 && afterDenied.json["branchId"] === A && afterDenied.json["userId"] === USERS[2], "SELECT_B_ORACLE");
        await capture();
    }
    async function sourceOracle() {
        demand(seeded);
        const { EXPORT_SCOPE_REVISION, EXPORT_POLICY_REVISION } = await import("domain/eformsign-backup/export");
        const route = "/internal/eformsign-backup/v1/snapshots";
        const body = { companyId: COMPANY, scopeRevision: EXPORT_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION };
        demand((await http(base, route, undefined, body)).status === 401, "MACHINE_GUARD_ORACLE");
        const forbidden = await http(base, route, seeded.token, { ...body, companyId: "backup-qa-forbidden" }, { "Idempotency-Key": randomUUID() });
        // The existing export service deliberately hides other companies behind NOT_FOUND.
        demand(forbidden.status === 404, "MACHINE_COMPANY_ORACLE");
        const snapshot = await http(base, route, seeded.token, body, { "Idempotency-Key": randomUUID() });
        demand(snapshot.status === 202 && typeof snapshot.json["snapshotId"] === "string", "MACHINE_SNAPSHOT_ORACLE");
        // EformsignBackupExportService.createSnapshot synchronously returns the
        // persisted ready view (ea7513ab); company-wide counts include branch B.
        const machineCounts = snapshot.json["counts"] as Json | undefined;
        sendSafe({ stage: "machine-source-proof", ready: snapshot.json["status"] === "ready", failed: snapshot.json["status"] === "failed",
            companyMatches: snapshot.json["companyId"] === COMPANY,
            totalMatches: machineCounts?.["total"] === (options.profile === "pagination" ? 134 : 13), includedMatches: machineCounts?.["included"] === 5,
            excludedMatches: machineCounts?.["excludedByPolicy"] === (options.profile === "pagination" ? 128 : 7),
            policyPendingMatches: machineCounts?.["policyPending"] === 1,
            otherClassesZero: machineCounts?.["inaccessible"] === 0 && machineCounts["unknownTemplate"] === 0 });
        demand(snapshot.json["status"] === "ready" && snapshot.json["companyId"] === COMPANY
            && machineCounts?.["total"] === (options.profile === "pagination" ? 134 : 13)
            && machineCounts["included"] === 5 && machineCounts["excludedByPolicy"] === (options.profile === "pagination" ? 128 : 7)
            && machineCounts["inaccessible"] === 0 && machineCounts["unknownTemplate"] === 0 && machineCounts["policyPending"] === 1, "MACHINE_COUNTS_ORACLE");
        const items: Json[] = [];
        let cursor: string | null = null;
        do {
            const page = await http(base, `${route}/${snapshot.json["snapshotId"]}/candidates${cursor ? `?cursor=${encodeURIComponent(cursor)}` : "?limit=100"}`, seeded.token);
            demand(page.status === 200 && Array.isArray(page.json["items"]), "MACHINE_PAGE_ORACLE");
            items.push(...page.json["items"] as Json[]);
            cursor = page.json["nextCursor"] as string | null;
            demand(cursor === null || typeof cursor === "string");
        } while (cursor);
        const expected = frozenDocuments(options.profile);
        demand(items.length === expected.length && items.every((item, i) => item["documentId"] === expected[i]!.documentId && item["classification"] === expected[i]!.classification), "FROZEN_EXPORT_ORACLE");
        const { SbEformsignBackupRunRepository } = await import("infrastructure/database/repositories/sb.eformsign-backup-run.repository");
        const { prepareManualBackupSelection } = await import("application/utils/manual-backup-selection");
        const repository = new SbEformsignBackupRunRepository(db as import("infrastructure/database/prisma.service").PrismaService);
        const source = await repository.readSourceForRequest(A);
        // Real source reader/selection; no direct enqueue, result synthesis or projector-derived expectation.
        const all = prepareManualBackupSelection({ companyId: COMPANY, branchId: A, source, serviceRecordTemplateIds: new Set([RECORD_TEMPLATE]), scope: { period: "all", start: "", end: "", kind: "all", contractStages: ["created", "sent", "opened", "signed", "reviewed", "completed"], recordStages: ["created", "sent", "reviewed", "completed"] } });
        const a = expected.filter(e => e.branchId === A);
        demand(all.documents.length === a.length && all.documents.every((d, i) => d.documentId === a[i]!.documentId && d.currentMilestone === a[i]!.stage && d.candidate.classification === a[i]!.classification), "FROZEN_STAGE_ORACLE");
        demand(all.sourceCounts.total === (options.profile === "pagination" ? 133 : 12)
            && all.sourceCounts.included === 5 && all.sourceCounts.excludedByPolicy === (options.profile === "pagination" ? 127 : 6)
            && all.sourceCounts.policyPending === 1 && all.sourceCounts.inaccessible === 0 && all.sourceCounts.unknownTemplate === 0, "SOURCE_COUNTS_ORACLE");
        for (const profile of (options.profile === "pagination" ? ["basic", "pagination", "kst"] : ["basic", "kst"]) as Profile[]) {
            const intent = exerciseIntent(profile);
            const selection = prepareManualBackupSelection({ companyId: COMPANY, branchId: A, source, serviceRecordTemplateIds: new Set([RECORD_TEMPLATE]), scope: intent.scope });
            demand(JSON.stringify(selection.documents.map(d => d.documentId)) === JSON.stringify(intent.ids), "FROZEN_DATE_ORACLE");
            if (profile !== "basic") demand(selection.documents.every(d => d.candidate.artifacts.length === 0), "METADATA_ARTIFACT_ORACLE");
        }
        await capture();
        return { sourceA: a.length, includedA: 5, excludedA: options.profile === "pagination" ? 127 : 6, policyPendingA: 1, sourceB: 1,
            machineTotal: machineCounts["total"], machineIncluded: machineCounts["included"], machineExcluded: machineCounts["excludedByPolicy"], machinePolicyPending: machineCounts["policyPending"], authChecks: 7 };
    }
    async function exercise(profile: Profile) {
        if (!available) return { success: false, code: "PRODUCT_ROUTES_UNAVAILABLE" };
        demand(consumer && performance.now() - started < 30 * 60_000, "SESSION_LIMIT");
        demand(profile !== "pagination" || options.profile === "pagination", "PROFILE_NOT_SEEDED");
        phaseStage = profile;
        phaseStep = "post";
        const intent = exerciseIntent(profile);
        const requestKey = randomUUID(); // One key per intent, reused for transport retry only.
        const posted = await http(base, "/eformsign-backups/runs", ownerToken, { scope: intent.scope, requestKey });
        demand(posted.status === 202 && typeof posted.json["id"] === "string", "PRODUCT_POST_FAILED");
        const id = posted.json["id"] as string;
        assertPublicManualRun(posted.json);
        phaseStep = "idempotency";
        const duplicate = await http(base, "/eformsign-backups/runs", ownerToken, { scope: intent.scope, requestKey });
        demand(duplicate.status === 202 && duplicate.json["id"] === id, "PRODUCT_IDEMPOTENCY_ORACLE");
        phaseStep = "selectB";
        const switched = await http(base, "/auth/select-branch", ownerToken, { branchId: B });
        demand(switched.status === 201 && typeof switched.json["accessToken"] === "string", "PRODUCT_BRANCH_ORACLE");
        const branchB = switched.json["accessToken"] as string;
        phaseStep = "crossbranchread";
        for (const suffix of ["", "/documents"]) demand((await http(base, `/eformsign-backups/runs/${id}${suffix}`, branchB)).status === 404, "PRODUCT_BRANCH_ORACLE");
        phaseStep = "restoreA";
        const restored = await http(base, "/auth/select-branch", branchB, { branchId: A });
        demand(restored.status === 201 && typeof restored.json["accessToken"] === "string", "PRODUCT_BRANCH_ORACLE");
        ownerToken = restored.json["accessToken"] as string;
        let run = posted;
        const deadline = performance.now() + 90_000;
        while (["queued", "running"].includes(String(run.json["status"]))) {
            demand(performance.now() < deadline, "EXERCISE_TIMEOUT");
            phaseStep = "consume";
            await consumer.consume();
            phaseStep = "readresults";
            run = await http(base, `/eformsign-backups/runs/${encodeURIComponent(id)}`, ownerToken);
            demand(run.status === 200, "PRODUCT_GET_FAILED");
        }
        phaseStep = "readresults";
        const documents: Json[] = [];
        const pages: number[] = [];
        let cursor: string | null = null;
        do {
            const page = await http(base, `/eformsign-backups/runs/${encodeURIComponent(id)}/documents${cursor ? `?cursor=${encodeURIComponent(cursor)}` : "?limit=100"}`, ownerToken);
            demand(page.status === 200 && Array.isArray(page.json["items"]), "PRODUCT_DOCUMENTS_FAILED");
            const items = page.json["items"] as Json[];
            items.forEach(assertPublicManualDocument);
            documents.push(...items); pages.push(items.length);
            cursor = page.json["nextCursor"] as string | null;
            demand(cursor === null || typeof cursor === "string");
        } while (cursor);
        demand(JSON.stringify(documents.map(d => d["documentId"])) === JSON.stringify(intent.ids), "PRODUCT_SELECTION_ORACLE");
        if (profile === "pagination") demand(JSON.stringify(pages) === "[100,21]", "PRODUCT_PAGINATION_ORACLE");
        const summary = run.json["summary"] as Json;
        assertPublicManualRun(run.json);
        demand(summary["saved"] === intent.saved && summary["metadataOnly"] === intent.metadataOnly && summary["target"] === intent.ids.length, "PRODUCT_SUMMARY_ORACLE");
        demand(run.json["backupComplete"] === false && run.json["coverage"] === "unverified", "PRODUCT_COVERAGE_ORACLE");
        demand((summary["drive"] as Json)["state"] === "excluded", "PRODUCT_DRIVE_ORACLE");
        assertNativeDocumentObservations(profile, documents);
        phaseStep = "artifactcheck";
        // Verify actual C1 bytes as well as the public summary.
        await assertNativeLocalArtifacts(options.session, profile, intent.ids);
        phaseStep = "capture";
        await capture();
        return { success: true, selected: documents.length, saved: intent.saved, metadataOnly: intent.metadataOnly, pages, nativeOnly: true, killedWorkerRecovery: "unproven" };
    }
    async function manualOracle() {
        phaseStage = "manual-negative"; phaseStep = "manual-negative";
        demand(seeded);
        const expectSafe = (result: Awaited<ReturnType<typeof http>>, status: number, code: string) => {
            demand(result.status === status && result.json["code"] === code
                && Object.keys(result.json).sort().join() === "code,requestId"
                && typeof result.json["requestId"] === "string" && /^[0-9a-f-]{36}$/.test(result.json["requestId"]), "MANUAL_ERROR_ORACLE");
        };
        const intent = exerciseIntent("basic");
        const body = { scope: intent.scope, requestKey: randomUUID() };
        expectSafe(await http(base, "/eformsign-backups/runs", ownerToken, { ...body, companyId: COMPANY }), 400, "INVALID_REQUEST");
        expectSafe(await http(base, "/eformsign-backups/runs?limit=101", ownerToken), 400, "INVALID_REQUEST");
        expectSafe(await http(base, "/eformsign-backups/runs/not-a-uuid", ownerToken), 400, "INVALID_REQUEST");
        expectSafe(await http(base, "/internal/eformsign-backup/v1/manual-runs/claim", seeded.token, { companyId: "forbidden-company" }), 404, "NOT_FOUND");
        phaseStage = "manual-stale"; phaseStep = "manual-stale";
        const queued = await http(base, "/eformsign-backups/runs", ownerToken, body);
        demand(queued.status === 202 && typeof queued.json["id"] === "string", "MANUAL_STALE_ORACLE");
        const id = queued.json["id"] as string;
        const claimed = await http(base, "/internal/eformsign-backup/v1/manual-runs/claim", seeded.token, { companyId: COMPANY });
        demand(claimed.status === 200 && typeof claimed.json["leaseToken"] === "string", "MANUAL_STALE_ORACLE");
        const renewed = await http(base, `/internal/eformsign-backup/v1/manual-runs/${id}/renew`, seeded.token,
            { companyId: COMPANY, leaseToken: claimed.json["leaseToken"] });
        demand(renewed.status === 200, "MANUAL_STALE_ORACLE");
        const active = await http(base, `/eformsign-backups/runs/${id}`, ownerToken);
        demand(active.status === 200 && active.json["status"] === "running", "MANUAL_RENEWED_ORACLE");
        assertPublicManualRun(active.json);
        const changed = await db.$executeRaw`UPDATE public.eformsign_backup_run
            SET lease_expires_at = clock_timestamp() - interval '1 second'
            WHERE id = ${id}::uuid AND company_id = ${COMPANY} AND branch_id = ${A}::uuid AND status = 'running'`;
        demand(changed === 1, "MANUAL_STALE_ORACLE");
        const listed = await http(base, "/eformsign-backups/runs", ownerToken);
        demand(listed.status === 200, "MANUAL_STALE_ORACLE");
        const expired = await http(base, `/eformsign-backups/runs/${id}`, ownerToken);
        demand(expired.status === 200 && expired.json["status"] === "blocked" && expired.json["failureCode"] === "WORKER_LEASE_EXPIRED", "MANUAL_STALE_ORACLE");
        assertPublicManualRun(expired.json);
    }
    try {
        await assertOtherTablesEmpty(db, true);
        stage = "seed";
        seeded = await seed(db, options.profile, options.owner);
        await capture();
        stage = "compile";
        const module = await Test.createTestingModule({ imports: [FixtureModule] }).overrideProvider(EMAIL_PORT).useValue(email.adapter).compile();
        unchanged();
        app = module.createNestApplication({ logger: false });
        // Only fixed operation names and numeric statuses: never record URLs,
        // request/response bodies, authority headers or private lease material.
        app.use("/internal/eformsign-backup/v1/manual-runs", (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
            const operation = req.path.split("/").at(-1) ?? "";
            if (["claim", "renew", "candidates", "validate", "artifact", "document-results", "finish"].includes(operation)) {
                res.once("finish", () => { workerHttp = { operation, status: res.statusCode }; });
            }
            next();
        });
        app.use("/__qa__/control", (req: import("express").Request, res: import("express").Response) => {
            if (req.method !== "POST" || !capabilityMatches(options.capability, req.headers["x-qa-capability"]) || req.headers["x-qa-nonce"] !== options.nonce) { res.status(403).json({ code: "CONTROL_REFUSED" }); return; }
            const action = req.headers["x-qa-action"];
            const profile = req.headers["x-qa-profile"] ?? options.profile;
            if (!["readiness", "exercise", "stop"].includes(String(action)) || !["basic", "pagination", "kst"].includes(String(profile))) { res.status(400).json({ code: "CONTROL_REFUSED" }); return; }
            queue = queue.then(async () => {
                if (action === "stop") {
                    res.json({ nonce: options.nonce, stopping: true });
                    sendSafe({ stage: "stopping" });
                    return;
                }
                demand(!closed && performance.now() - started < 30 * 60_000, "SESSION_LIMIT");
                consumer?.assertHealthy();
                const result = action === "exercise" ? await exercise(profile as Profile) : { ready: true, backendOnly: true, nativeOnly: options.nativeOnly, productRoutes: available, healthy: consumer?.healthy ?? false, claims: consumer?.claims ?? 0, pid: process.pid };
                await capture();
                res.json({ ...result, nonce: options.nonce });
            }).catch(() => { if (!res.headersSent) res.status(503).json({ code: "CONTROL_FAILED" }); });
        });
        stage = "listen";
        await app.listen(options.port, "127.0.0.1");
        unchanged();
        const { PrismaService } = await import("infrastructure/database/prisma.service");
        demand(PrismaService.prototype instanceof PrismaClient, "PRISMA_PROVIDER_IDENTITY");
        const actual = app.get(PrismaService);
        demand(typeof actual.onModuleInit === "function" && typeof actual.onModuleDestroy === "function", "PRISMA_LIFECYCLE_MISSING");
        const batch = await actual.$transaction([actual.user.findUnique({ where: { id: USERS[0] }, select: { id: true } })]);
        const interactive = await actual.$transaction(async tx => tx.user.findUnique({ where: { id: USERS[0] }, select: { id: true } }));
        demand(batch[0]?.id === USERS[0] && interactive?.id === USERS[0], "REAL_TRANSACTION_ORACLE");
        unchanged();
        const address = app.getHttpServer().address() as { port: number };
        base = `http://127.0.0.1:${address.port}`;
        stage = "auth";
        await authOracle();
        stage = "source";
        const counts = await sourceOracle();
        stage = "phase";
        const routeProbe = await http(base, "/eformsign-backups/runs?limit=1", ownerToken);
        demand(routeProbe.status === 200, "PRODUCT_PHASE_UNKNOWN");
        available = routeProbe.status === 200;
        if (available) {
            const { createConsumer } = await import("./eformsign-backup-fixture-worker");
            phaseStage = "consumer-init"; phaseStep = "consumer-init";
            consumer = await createConsumer(options.session, base, seeded.token, capture);
            if (options.nativeOnly) {
                demand(options.profile === "pagination", "NATIVE_PAGINATION_REQUIRED");
                await manualOracle();
                for (const profile of ["basic", "pagination", "kst"] as const) await exercise(profile);
            } else consumer.start();
        }
        demand(email.count() === 0, "EMAIL_ATTEMPTED");
        unchanged();
        return { base, counts, available, close, exercise, settle: () => queue };
    } catch (error) {
        const diagnostic = { failureStage: stage, phaseStage, phaseStep, phaseFailure: phaseFailureCode(error), workerHttp,
            workerResponseInvalid: error instanceof WorkerError && error.reasonCode === "export-response-invalid",
            workerExportUnavailable: error instanceof WorkerError && error.reasonCode === "export-unavailable",
            workerControlUnavailable: error instanceof WorkerError && error.reasonCode === "control-unavailable",
            workerLedgerInconsistent: error instanceof WorkerError && error.reasonCode === "ledger-inconsistent",
            workerLockNotHeld: error instanceof WorkerError && error.reasonCode === "lock-not-held", authFailure: authFailureCode(error), sourceFailure: sourceFailureCode(error) };
        let cleanupComplete = false;
        try { await close(); cleanupComplete = true; } catch { /* Retain evidence; report only fixed codes and flags. */ }
        sendSafe({ stage: cleanupComplete ? "failed-clean" : "failed", ...diagnostic, cleanupComplete, retained: !cleanupComplete });
        throw error;
    }
}

async function childMain(): Promise<void> {
    demand(process.send && process.argv.length === 2, "CHILD_ENTRY_REFUSED");
    const options = await new Promise<FixtureOptions>(resolve => process.once("message", value => resolve(value as FixtureOptions)));
    let fixture: Awaited<ReturnType<typeof createFixture>> | undefined;
    let closing: Promise<void> | undefined;
    let booting = true;
    let stopRequested = false;
    let finished!: () => void;
    const finishedPromise = new Promise<void>(resolve => { finished = resolve; });
    const shutdown = () => {
        stopRequested = true;
        if (booting) return;
        if (closing) return;
        closing = (async () => {
            try { await fixture?.settle(); } finally { await fixture?.close(); }
            if (process.connected) await new Promise<void>(resolve => process.send!({ stage: "closed" }, () => resolve()));
            if (process.connected) process.disconnect();
        })().catch(() => { process.exitCode = 1; if (process.connected) process.disconnect(); }).finally(finished);
    };
    process.on("message", value => { if (value === "stop") shutdown(); });
    process.once("SIGTERM", shutdown);
    process.once("disconnect", shutdown);
    const ttl = setTimeout(shutdown, 30 * 60_000);
    try {
        fixture = await createFixture(options);
        booting = false;
        if (stopRequested) shutdown();
        else sendSafe({ stage: "ready", port: Number(new URL(fixture.base).port), counts: fixture.counts, productRoutes: fixture.available });
        await finishedPromise;
    } finally { clearTimeout(ttl); }
}
if (require.main === module) {
    void childMain().catch(() => { sendSafe({ stage: "failed" }); process.exitCode = 1; if (process.connected) process.disconnect(); });
}
