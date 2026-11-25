jest.mock("@prisma/client", () => ({
    ...jest.requireActual("@prisma/client"),
    PrismaClient: jest.fn(),
}));
jest.mock("../../infrastructure/database/repositories/sb.eformsign-document-job.repository", () => ({
    SbEformsignDocumentJobRepository: jest.fn(),
}));
jest.mock("../../infrastructure/database/prisma-url.utils", () => ({ createPrismaClientConfig: jest.fn() }));
jest.mock("../../scripts/repair-eformsign-branch-ownership", () => ({
    loadOperatorEnvironment: jest.fn(), resolveOperatorDatabaseTarget: jest.fn(),
}));
jest.mock("../../application/utils/eformsign-backfill-safety", () => ({ assertEformsignBackfillConfirmation: jest.fn() }));

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { ConflictException, HttpException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { codeOnlyProblemBody } from "../../application/utils/problem-bodies";
import { assertEformsignBackfillConfirmation } from "../../application/utils/eformsign-backfill-safety";
import { SbEformsignDocumentJobRepository } from "../../infrastructure/database/repositories/sb.eformsign-document-job.repository";
import { createPrismaClientConfig } from "../../infrastructure/database/prisma-url.utils";
import { loadOperatorEnvironment, resolveOperatorDatabaseTarget } from "../../scripts/repair-eformsign-branch-ownership";
import { errorCodeOf, main } from "../../scripts/requeue-initial-finalization-jobs";

describe("initial finalization operator diagnostics", () => {
    const branchId = "00000000-0000-4000-8000-000000000010";
    const jobId = "00000000-0000-4000-8000-000000000001";
    const payload = { immutablePayload: {
        requiredSessionCount: 1,
        sessions: [{ sessionIndex: 1, serviceDate: "2026-09-01", locked: true, momApproval: "approved",
            clientSignature: "synthetic-signature", clientSignedAt: "synthetic-signed-at" }],
        plannedSessions: [{ sessionIndex: 1, serviceDate: "2026-09-01" }],
        branchName: "synthetic-private-branch", client: { name: "synthetic-private-client" },
    } };
    const prisma = { branch: { findMany: jest.fn() }, $queryRaw: jest.fn(),
        $transaction: jest.fn(), $disconnect: jest.fn() };
    const repository = { diagnoseInitialFinalizationJob: jest.fn(), requeueInitialFinalizationJob: jest.fn() };
    let output: jest.SpyInstance;

    beforeEach(() => {
        jest.resetAllMocks();
        jest.mocked(PrismaClient).mockImplementation(() => prisma as unknown as PrismaClient);
        jest.mocked(SbEformsignDocumentJobRepository).mockImplementation(() => repository as unknown as SbEformsignDocumentJobRepository);
        jest.mocked(createPrismaClientConfig).mockReturnValue({ missingRequiredEnvVars: [], appliedDefaults: [], options: {} });
        prisma.branch.findMany.mockResolvedValue([{ id: branchId, slug: "dev-qa" }]);
        prisma.$queryRaw.mockResolvedValue([{ id: jobId, branch_id: branchId }]);
        repository.diagnoseInitialFinalizationJob.mockResolvedValue({ kind: "diagnosed", jobId, verifier: true,
            jobEligible: true, stateStatus: "capability_unverified", progressStep: "preparing", payload });
        output = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    });
    afterEach(() => { output.mockRestore(); });

    it("uses the public diagnosis without requeueing and prints only payload shape checks", async () => {
        await main(["--branch-id", branchId]);
        expect(repository.diagnoseInitialFinalizationJob).toHaveBeenCalledTimes(1);
        expect(repository.diagnoseInitialFinalizationJob).toHaveBeenCalledWith({ jobId, branchId });
        expect(repository.requeueInitialFinalizationJob).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(output).toHaveBeenCalledTimes(1);
        expect(output).toHaveBeenCalledWith(`${JSON.stringify({ jobId, verifier: true, jobEligible: true,
            stateStatus: "capability_unverified", progressStep: "preparing", payloadChecks: {
                sessionCount: true, plannedDates: true, sessionsApprovedAndSigned: true, branchName: true, clientName: true,
            } })}\n`);
        const printed = String(output.mock.calls[0]?.[0]);
        expect(printed).not.toContain('"payload":');
        expect(printed).not.toContain("synthetic-");
        expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    });
    it("uses the shared strict identity and stopped/pre-send/error eligibility without changing dry-run defaults", async () => {
        await main(["--branch-id", branchId]);
        const query = prisma.$queryRaw.mock.calls[0]![0];
        expect(query.text).toContain("status IN ('failed', 'requires_attention')");
        expect(query.text).toContain("'SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED', 'PRE_SEND_RETRY_EXHAUSTED'");
        expect(query.text).toContain("IN ('', 'queued', 'validating', 'preparing')");
        expect(query.text).toContain("lease_token IS NULL");
        expect(query.text).toContain("snapshotReference");
        expect(query.text).toContain("generationKind");
        expect(query.text).not.toContain("request_key LIKE");
        expect(query.values).toContainEqual([branchId]);
        expect(repository.requeueInitialFinalizationJob).not.toHaveBeenCalled();
    });
    it("prints not_found without inspecting or exposing a payload", async () => {
        repository.diagnoseInitialFinalizationJob.mockResolvedValue({ kind: "not_found" });
        await main(["--branch-id", branchId]);
        expect(output).toHaveBeenCalledWith(`${JSON.stringify({ jobId, result: "not_found" })}\n`);
        expect(repository.requeueInitialFinalizationJob).not.toHaveBeenCalled();
    });
    it("prints verifier and job ineligibility reasons independently", async () => {
        repository.diagnoseInitialFinalizationJob.mockResolvedValue({ kind: "diagnosed", jobId, verifier: false,
            reason: "SERVICE_RECORD_INITIAL_FINALIZATION_STATE_NOT_READY", jobEligible: false,
            jobReason: "SERVICE_RECORD_INITIAL_FINALIZATION_SEND_EVIDENCE_PRESENT",
            stateStatus: "processing", progressStep: "creating", payload: null });
        await main(["--branch-id", branchId]);
        expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ jobId, verifier: false,
            reason: "SERVICE_RECORD_INITIAL_FINALIZATION_STATE_NOT_READY", jobEligible: false,
            jobReason: "SERVICE_RECORD_INITIAL_FINALIZATION_SEND_EVIDENCE_PRESENT", stateStatus: "processing",
            progressStep: "creating", payloadChecks: { sessionCount: false, branchName: false } });
        expect(repository.requeueInitialFinalizationJob).not.toHaveBeenCalled();
    });
    it.each([
        "SERVICE_RECORD_INITIAL_FINALIZATION_SEND_EVIDENCE_PRESENT",
        "SERVICE_RECORD_INITIAL_FINALIZATION_JOB_NOT_STOPPED",
    ])("prints the specific apply refusal %s", async (reason) => {
        repository.requeueInitialFinalizationJob.mockResolvedValue({ kind: "not_requeueable", reason });
        await main(["--branch-id", branchId, "--apply", "--confirm-target", "synthetic-target",
            "--confirm-branch-slug", "dev-qa"]);
        expect(assertEformsignBackfillConfirmation).toHaveBeenCalledTimes(1);
        expect(repository.requeueInitialFinalizationJob).toHaveBeenCalledWith({ jobId, branchId });
        expect(repository.diagnoseInitialFinalizationJob).not.toHaveBeenCalled();
        expect(output).toHaveBeenCalledWith(`${JSON.stringify({ jobId, result: "not_requeueable", reason })}\n`);
    });
    it("prints help before environment or database setup", async () => {
        await main(["--help"]);
        expect(output).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
        expect(loadOperatorEnvironment).not.toHaveBeenCalled();
        expect(createPrismaClientConfig).not.toHaveBeenCalled();
        expect(PrismaClient).not.toHaveBeenCalled();
        expect(repository.diagnoseInitialFinalizationJob).not.toHaveBeenCalled();
        expect(repository.requeueInitialFinalizationJob).not.toHaveBeenCalled();
    });
});

describe("errorCodeOf", () => {
    const fallback = "INITIAL_FINALIZATION_REQUEUE_FAILED";

    it.each([
        "INVALID_ARGUMENTS", "BRANCH_REQUIRED", "BRANCH_CONFIRMATION_REQUIRED",
        "BRANCH_NOT_FOUND", "BRANCH_CONFIRMATION_MISMATCH", "BRANCH_SCOPE_MISMATCH",
        "DATABASE_CONFIGURATION_REQUIRED", "TARGET_UNKNOWN", "TARGET_CONFIRMATION_MISMATCH",
    ])("preserves the operator code %s", (code) => {
        expect(errorCodeOf(new Error(code))).toBe(code);
    });

    it("preserves a conflict code", () => {
        expect(errorCodeOf(new ConflictException("SERVICE_RECORD_WRITE_TARGET_CHANGED")))
            .toBe("SERVICE_RECORD_WRITE_TARGET_CHANGED");
    });

    it("uses the problem body code without exposing catalog text", () => {
        expect(errorCodeOf(new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"))))
            .toBe("SERVICE_RECORD_WRITE_TARGET_CHANGED");
    });

    it("reads code-only conflict bodies", () => {
        expect(errorCodeOf(new ConflictException({ code: "REQUEST_CONFLICT" }))).toBe("REQUEST_CONFLICT");
    });

    it("prefers a response code over its message", () => {
        const error = new ConflictException({ code: "REQUEST_CONFLICT", message: "OTHER_SAFE_CODE" });
        error.message = "free text";
        expect(errorCodeOf(error)).toBe("REQUEST_CONFLICT");
    });

    it("reads safe string and message responses", () => {
        const stringResponse = new HttpException("REQUEST_CONFLICT", 409);
        stringResponse.message = "free text";
        expect(errorCodeOf(stringResponse)).toBe("REQUEST_CONFLICT");
        const objectResponse = new ConflictException({ code: "free text", message: "REQUEST_CONFLICT" });
        objectResponse.message = "free text";
        expect(errorCodeOf(objectResponse)).toBe("REQUEST_CONFLICT");
    });

    it.each([{ code: "P2002" }, { errorCode: "P1001" }])("reads Prisma-style codes %j", (error) => {
        expect(errorCodeOf(error)).toBe(Object.values(error)[0]);
    });

    it.each([
        new ConflictException({ message: "free text" }),
        new Error("connect ECONNREFUSED 10.0.0.1:5432"),
        new Error("Customer synthetic-private-client failed"),
        new Error("SELECT * FROM clients WHERE name = 'synthetic-private-client'"),
        new Error("AB"), new Error("A".repeat(81)), new Error("SAFE_CODE\n"),
        { code: "free text", errorCode: "unsafe-value" },
        null, "BRANCH_REQUIRED",
    ])("redacts unsafe errors %#", (error) => {
        expect(errorCodeOf(error)).toBe(fallback);
    });
});

describe("initial finalization CLI failures", () => {
    const branchId = "00000000-0000-4000-8000-000000000010";
    const jobId = "00000000-0000-4000-8000-000000000001";
    const nextJobId = "00000000-0000-4000-8000-000000000002";
    const applyArgs = ["--branch-id", branchId, "--apply", "--confirm-target", "synthetic-target",
        "--confirm-branch-slug", "dev-qa"];
    const scriptPath = resolve(__dirname, "../../scripts/requeue-initial-finalization-jobs.ts");
    const compiledScript = transpileModule(readFileSync(scriptPath, "utf8"), {
        compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    }).outputText;
    const prisma = { branch: { findMany: jest.fn() }, $queryRaw: jest.fn(), $disconnect: jest.fn() };
    const repository = { requeueInitialFinalizationJob: jest.fn() };

    // Execute the real CLI catch with mocked dependencies; never start a database client.
    async function runCli(argv: string[]) {
        const cliProcess = { argv: ["node", scriptPath, ...argv], exitCode: 0,
            stdout: { write: jest.fn() }, stderr: { write: jest.fn() } };
        const cliModule = { exports: {} };
        const cliRequire = Object.assign(
            (id: string) => require(require.resolve(id, { paths: [dirname(scriptPath)] })),
            { main: cliModule },
        );
        await runInNewContext(compiledScript, {
            require: cliRequire, module: cliModule, exports: cliModule.exports, process: cliProcess, Error,
        });
        return cliProcess;
    }

    beforeEach(() => {
        jest.resetAllMocks();
        jest.mocked(PrismaClient).mockImplementation(() => prisma as unknown as PrismaClient);
        jest.mocked(SbEformsignDocumentJobRepository).mockImplementation(() => repository as unknown as SbEformsignDocumentJobRepository);
        jest.mocked(createPrismaClientConfig).mockReturnValue({ missingRequiredEnvVars: [], appliedDefaults: [], options: {} });
        prisma.branch.findMany.mockResolvedValue([{ id: branchId, slug: "dev-qa" }]);
        prisma.$queryRaw.mockResolvedValue([{ id: jobId, branch_id: branchId }, { id: nextJobId, branch_id: branchId }]);
    });

    it.each([
        [{ environment: "unknown", databaseHost: "synthetic-host", databaseTarget: "synthetic-db" }, "TARGET_UNKNOWN"],
        [{ environment: "production", databaseHost: "synthetic-host", databaseTarget: "synthetic-db" }, "TARGET_CONFIRMATION_MISMATCH"],
    ] as const)("classifies confirmation errors without exposing the target: %j", async (target, code) => {
        jest.mocked(resolveOperatorDatabaseTarget).mockReturnValue(target);
        jest.mocked(assertEformsignBackfillConfirmation).mockImplementation(() => {
            throw new Error("Set confirmation to production@synthetic-private-database-target");
        });
        const cli = await runCli(applyArgs);
        expect(cli.stderr.write.mock.calls).toEqual([[`${code}\n`]]);
        expect(cli.stdout.write).not.toHaveBeenCalled();
        expect(cli.exitCode).toBe(1);
        expect(createPrismaClientConfig).not.toHaveBeenCalled();
        expect(PrismaClient).not.toHaveBeenCalled();
    });

    it.each([
        [new ConflictException("SERVICE_RECORD_WRITE_TARGET_CHANGED"), "SERVICE_RECORD_WRITE_TARGET_CHANGED"],
        [new Error("SELECT synthetic-private-client FROM synthetic-table"), "INITIAL_FINALIZATION_REQUEUE_FAILED"],
    ] as const)("prints a failed apply job and stops before the next job %#", async (error, code) => {
        repository.requeueInitialFinalizationJob.mockRejectedValueOnce(error);
        const cli = await runCli(applyArgs);
        expect(cli.stdout.write.mock.calls).toEqual([[`${JSON.stringify({ jobId, result: "error", code })}\n`]]);
        expect(cli.stderr.write.mock.calls).toEqual([[`${code}\n`]]);
        expect(cli.exitCode).toBe(1);
        expect(repository.requeueInitialFinalizationJob.mock.calls).toEqual([[{ jobId, branchId }]]);
        expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    });

    it("prints only BRANCH_REQUIRED and exits before environment or database setup", async () => {
        const cli = await runCli([]);
        expect(cli.stderr.write.mock.calls).toEqual([["BRANCH_REQUIRED\n"]]);
        expect(cli.stdout.write).not.toHaveBeenCalled();
        expect(cli.exitCode).toBe(1);
        expect(loadOperatorEnvironment).not.toHaveBeenCalled();
        expect(createPrismaClientConfig).not.toHaveBeenCalled();
        expect(PrismaClient).not.toHaveBeenCalled();
    });
});
