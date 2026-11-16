/**
 * Dry-run: --branch-id <uuid> [--branch-id <uuid>] [--job-id <uuid>]
 * Apply: add --apply --confirm-target '<environment>@<sanitized-db-target>'
 *        --confirm-branch-slug <slug> (repeat for every requested branch).
 * Only pre-dispatch INITIAL jobs are eligible. No provider calls are made.
 * The dry run takes no locks and writes nothing.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { assertEformsignBackfillConfirmation } from "../application/utils/eformsign-backfill-safety";
import { SbEformsignDocumentJobRepository } from "../infrastructure/database/repositories/sb.eformsign-document-job.repository";
import { createPrismaClientConfig } from "../infrastructure/database/prisma-url.utils";
import { loadOperatorEnvironment, resolveOperatorDatabaseTarget } from "./repair-eformsign-branch-ownership";
import type { PrismaService } from "../infrastructure/database/prisma.service";

const USAGE = `Requeue initial service-record finalization jobs (dry-run by default).
Usage: NODE_PATH=. ts-node scripts/requeue-initial-finalization-jobs.ts
  --branch-id <uuid>           Required, repeatable; limits reads and writes
  --job-id <uuid>              Optional, repeatable
  --apply                     Requeue eligible jobs one at a time
  --confirm-target <target>   Required with --apply (environment@sanitized-db-target)
  --confirm-branch-slug <slug> Required with --apply for every branch, repeatable
  --help                      Print this usage without database access
`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

export function initialPayloadShapeChecks(payload: unknown): Record<string, boolean> {
    const frozen = record(record(payload)?.["immutablePayload"]);
    const sessions = Array.isArray(frozen?.["sessions"]) ? frozen["sessions"] : [];
    const planned = Array.isArray(frozen?.["plannedSessions"]) ? frozen["plannedSessions"] : [];
    const required = frozen?.["requiredSessionCount"];
    const present = (value: unknown) => typeof value === "string" && value.trim().length > 0;
    return {
        sessionCount: Number.isInteger(required) && Number(required) > 0 && sessions.length === required,
        plannedDates: planned.length === sessions.length && sessions.length > 0 && sessions.every((value, index) => {
            const session = record(value);
            const plan = record(planned[index]);
            return session?.["sessionIndex"] === index + 1 && plan?.["sessionIndex"] === index + 1
                && typeof session?.["serviceDate"] === "string"
                && session["serviceDate"] === plan?.["serviceDate"];
        }),
        sessionsApprovedAndSigned: sessions.length > 0 && sessions.every((value) => {
            const session = record(value);
            return session?.["locked"] === true && session["momApproval"] === "approved"
                && present(session["clientSignature"]) && present(session["clientSignedAt"]);
        }),
        branchName: present(frozen?.["branchName"]),
        clientName: present(record(frozen?.["client"])?.["name"]),
    };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
    if (argv.includes("--help")) { process.stdout.write(USAGE); return; }
    const branchIds = new Set<string>();
    const jobIds = new Set<string>();
    const slugs = new Set<string>();
    let apply = false;
    let confirmTarget: string | undefined;
    for (let index = 0; index < argv.length; index++) {
        const flag = argv[index];
        if (flag === "--apply") { apply = true; continue; }
        const value = argv[++index];
        if (!value || value.startsWith("--")) throw new Error("INVALID_ARGUMENTS");
        if (flag === "--branch-id" && UUID.test(value)) branchIds.add(value);
        else if (flag === "--job-id" && UUID.test(value)) jobIds.add(value);
        else if (flag === "--confirm-branch-slug") slugs.add(value);
        else if (flag === "--confirm-target") confirmTarget = value;
        else throw new Error("INVALID_ARGUMENTS");
    }
    if (branchIds.size === 0) throw new Error("BRANCH_REQUIRED");
    loadOperatorEnvironment();
    if (apply) {
        assertEformsignBackfillConfirmation(resolveOperatorDatabaseTarget(), confirmTarget);
        if (slugs.size === 0) throw new Error("BRANCH_CONFIRMATION_REQUIRED");
    }
    const config = createPrismaClientConfig();
    if (config.missingRequiredEnvVars.length > 0 || !config.options) throw new Error("DATABASE_CONFIGURATION_REQUIRED");
    const prisma = new PrismaClient(config.options);
    const repository = new SbEformsignDocumentJobRepository(prisma as PrismaService);
    try {
        const branches = await prisma.branch.findMany({
            where: { id: { in: [...branchIds] } }, select: { id: true, slug: true },
        });
        if (branches.length !== branchIds.size) throw new Error("BRANCH_NOT_FOUND");
        if (apply && (slugs.size !== branches.length || branches.some((branch) => !branch.slug || !slugs.has(branch.slug)))) {
            throw new Error("BRANCH_CONFIRMATION_MISMATCH");
        }
        const candidates = await prisma.$queryRaw<Array<{ id: string; branch_id: string }>>(Prisma.sql`
            SELECT id, branch_id FROM eformsign_document_job
            WHERE job_type = 'create_document' AND source = 'auto_finalize'
              AND request_key LIKE 'service-record-initial-finalization:%'
              AND status = 'requires_attention'
              AND last_error_code = 'SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED'
              AND document_id IS NULL AND branch_id = ANY(${[...branchIds]}::uuid[])
              ${jobIds.size ? Prisma.sql`AND id = ANY(${[...jobIds]}::uuid[])` : Prisma.empty}
            ORDER BY id
        `);
        for (const candidate of candidates) {
            if (!branchIds.has(candidate.branch_id)) throw new Error("BRANCH_SCOPE_MISMATCH");
            if (apply) {
                const result = await repository.requeueInitialFinalizationJob({ jobId: candidate.id, branchId: candidate.branch_id });
                process.stdout.write(`${JSON.stringify({ jobId: candidate.id, result: result.kind,
                    ...(result.kind === "not_requeueable" ? { reason: result.reason } : {}) })}\n`);
                continue;
            }
            const diagnostic = await repository.diagnoseInitialFinalizationJob({
                jobId: candidate.id, branchId: candidate.branch_id,
            });
            if (diagnostic.kind === "not_found") {
                process.stdout.write(`${JSON.stringify({ jobId: candidate.id, result: "not_found" })}\n`);
                continue;
            }
            process.stdout.write(`${JSON.stringify({ jobId: diagnostic.jobId, verifier: diagnostic.verifier,
                ...(diagnostic.reason === undefined ? {} : { reason: diagnostic.reason }),
                jobEligible: diagnostic.jobEligible,
                ...(diagnostic.jobReason === undefined ? {} : { jobReason: diagnostic.jobReason }),
                stateStatus: diagnostic.stateStatus, progressStep: diagnostic.progressStep,
                payloadChecks: initialPayloadShapeChecks(diagnostic.payload) })}\n`);
        }
    } finally { await prisma.$disconnect(); }
}

if (require.main === module) {
    main().catch(() => { process.stderr.write("INITIAL_FINALIZATION_REQUEUE_FAILED\n"); process.exitCode = 1; });
}
