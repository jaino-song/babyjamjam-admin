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

import { PrismaClient } from "@prisma/client";
import { assertEformsignBackfillConfirmation } from "../../application/utils/eformsign-backfill-safety";
import { SbEformsignDocumentJobRepository } from "../../infrastructure/database/repositories/sb.eformsign-document-job.repository";
import { createPrismaClientConfig } from "../../infrastructure/database/prisma-url.utils";
import { loadOperatorEnvironment } from "../../scripts/repair-eformsign-branch-ownership";
import { main } from "../../scripts/requeue-initial-finalization-jobs";

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
