import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";

import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { PrismaService } from "infrastructure/database/prisma.service";
import type { DecisionTraceEventV1 } from "./decision/decision-contracts";
import { mergeDecisionTraceEvents } from "./decision/decision-trace";

@Injectable()
export class AgentTraceService {
    constructor(private readonly prisma: PrismaService) {}

    start(sessionId: string, principal: VerifiedTenantPrincipal, model: string, agentVersion: string, domains: string[]) {
        const id = randomUUID();
        return this.prisma.agent_trace.create({ data: {
            id, sessionId, userId: principal.userId, branchId: principal.branchId,
            model, agentVersion, routedDomains: domains,
            redactionMetadata: {
                excludedFields: ["phone", "address", "documentContent", "tokens", "signedUrls"],
            },
        } }).then(() => ({ id, startedAt: Date.now(), userId: principal.userId, branchId: principal.branchId }));
    }

    finish(trace: { id: string; startedAt: number; userId: string; branchId: string }, outcome: "succeeded" | "failed" | "cancelled", usage?: unknown, errorCategory?: string, stepMetadata?: unknown, decisionEvents?: readonly DecisionTraceEventV1[]) {
        const { stepMetadata: mergedStepMetadata } = mergeDecisionTraceEvents(stepMetadata, decisionEvents);
        return this.prisma.agent_trace.updateMany({ where: { id: trace.id, userId: trace.userId, branchId: trace.branchId }, data: {
            outcome, usage: usage as Prisma.InputJsonValue | undefined, errorCategory,
            stepMetadata: mergedStepMetadata as Prisma.InputJsonValue | undefined,
            latencyMs: Date.now() - trace.startedAt, finishedAt: new Date(),
        } });
    }
}
