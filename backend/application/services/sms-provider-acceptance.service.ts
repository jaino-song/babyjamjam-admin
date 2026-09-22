import { ConflictException, Inject, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import {
    MessageLogEntity,
    SmsProviderAcceptanceState,
} from "domain/entities/message-log.entity";
import {
    IMessageLogRepository,
    MESSAGE_LOG_REPOSITORY,
} from "domain/repositories/message-log.repository.interface";

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function digest(value: unknown): string {
    return createHash("sha256").update(stableJson(value)).digest("hex");
}

/**
 * Build an opaque, deterministic logical identity.  The raw recipient and
 * message body never appear in the returned key or in logs.
 */
export function buildSmsProviderAcceptanceKey(scope: string, logicalIdentity: string): string {
    const normalizedScope = scope.trim();
    const normalizedIdentity = logicalIdentity.trim();
    if (!normalizedScope || !normalizedIdentity) {
        throw new InternalServerErrorException(codeOnlyProblemBody("INTERNAL_ERROR"));
    }
    if (normalizedIdentity.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
        throw new InternalServerErrorException(codeOnlyProblemBody("INTERNAL_ERROR"));
    }
    return `sms:${digest({ scope: normalizedScope, identity: normalizedIdentity })}`;
}

/** Return an opaque fingerprint for the exact provider-bound request. */
export function buildSmsProviderAcceptanceFingerprint(input: Record<string, unknown>): string {
    return digest(input);
}

export type SmsProviderReconciliationOutcome = "delivered" | "not-delivered";

export interface SmsProviderReconciliationInput {
    branchId: string;
    logId: number;
    outcome: SmsProviderReconciliationOutcome;
    actor: string;
    reason: string;
    providerMessageId?: string | null;
}

/**
 * Owns the local half of the SMS provider acceptance boundary.  It does not
 * send requests or assert provider idempotency; it only makes the local
 * attempt durable, fences the network crossing, and exposes a bounded
 * authoritative reconciliation seam.
 */
@Injectable()
export class SmsProviderAcceptanceService {
    constructor(
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
    ) {}

    async prepare(log: MessageLogEntity): Promise<MessageLogEntity> {
        if (log.providerAcceptanceState !== "prepared") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        const repository = this.logRepository as IMessageLogRepository & {
            prepareProviderAttempt?: (attempt: MessageLogEntity) => Promise<MessageLogEntity>;
        };
        if (typeof repository.prepareProviderAttempt === "function") {
            return repository.prepareProviderAttempt(log);
        }

        // Compatibility fallback for isolated unit doubles and legacy
        // repository implementations. Production uses the transactional
        // implementation above.
        return this.logRepository.save(log);
    }

    async beginProviderCall(
        log: MessageLogEntity,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageLogEntity> {
        if (log.providerAcceptanceState !== "prepared") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }

        const repository = this.logRepository as IMessageLogRepository & {
            claimProviderAttempt?: (
                attempt: MessageLogEntity,
                transaction?: Prisma.TransactionClient,
            ) => Promise<MessageLogEntity | null>;
        };
        if (typeof repository.claimProviderAttempt === "function") {
            const claimed = await repository.claimProviderAttempt(log, transaction);
            if (!claimed) {
                throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            }
            return claimed;
        }

        log.markProviderCallStarted();
        await this.logRepository.update(log, transaction);
        return log;
    }

    async persist(log: MessageLogEntity): Promise<MessageLogEntity> {
        return this.logRepository.update(log);
    }

    async reconcile(input: SmsProviderReconciliationInput): Promise<MessageLogEntity> {
        const actor = input.actor.trim();
        const reason = input.reason.trim();
        const providerMessageId = input.providerMessageId?.trim() || null;
        if (!actor || !reason) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        if (providerMessageId && providerMessageId.length > 200) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        if (input.outcome !== "delivered" && input.outcome !== "not-delivered") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }

        const source = await this.logRepository.findByIdInBranch(input.branchId, input.logId);
        if (!source || source.provider !== "aligo_sms") {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }

        const existingOutcome = this.reconciledOutcome(source.providerAcceptanceState);
        if (existingOutcome) {
            if (existingOutcome === input.outcome) return source;
            throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
        }
        if (!source.canReconcileProviderOutcome()) {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }

        const repository = this.logRepository as IMessageLogRepository & {
            reconcileProviderAttempt?: (
                attempt: MessageLogEntity,
                outcome: SmsProviderReconciliationOutcome,
                actor: string,
                reason: string,
                providerMessageId?: string | null,
            ) => Promise<MessageLogEntity | null>;
        };
        if (typeof repository.reconcileProviderAttempt === "function") {
            const reconciled = await repository.reconcileProviderAttempt(
                source,
                input.outcome,
                actor,
                reason,
                providerMessageId,
            );
            if (!reconciled) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }
            return reconciled;
        }

        source.reconcileProviderOutcome({
            outcome: input.outcome,
            actor,
            reason,
            providerMessageId,
        });
        return this.logRepository.update(source);
    }

    private reconciledOutcome(state: SmsProviderAcceptanceState): SmsProviderReconciliationOutcome | null {
        if (state === "reconciled_delivered") return "delivered";
        if (state === "reconciled_not_delivered") return "not-delivered";
        return null;
    }
}
