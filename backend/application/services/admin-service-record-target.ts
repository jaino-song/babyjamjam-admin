import { NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { codeOnlyProblemBody, codeOnlyProblemException } from "application/utils/problem-bodies";
import { resolveServiceRecordCaseTarget } from "./service-record-case-target";

export async function resolveAdminServiceRecordTarget(
    tx: Prisma.TransactionClient,
    scope: { branchId: string; clientId: number; caseId?: string },
    mode: "overview" | "read" | "write",
) {
    const target = await resolveServiceRecordCaseTarget(tx, scope);
    if (target.kind === "ambiguous") {
        if (mode === "overview") return null;
        throw codeOnlyProblemException("REQUEST_CONFLICT", { reason: "SERVICE_RECORD_CASE_SELECTION_REQUIRED" });
    }
    if (target.kind === "missing") {
        if (mode === "overview" && scope.caseId === undefined) return null;
        throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
    }
    if (target.kind === "retired" && mode === "write") {
        throw codeOnlyProblemException("SERVICE_RECORD_FINALIZED");
    }
    return target;
}
