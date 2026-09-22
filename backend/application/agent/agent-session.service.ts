import { ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";

import type { BjjUIMessage } from "@babyjamjam/shared";
import type { AgentSessionOwner } from "domain/entities/agent-session.entity";
import {
    AGENT_SESSION_REPOSITORY,
    type AgentSessionPatch,
    type IAgentSessionRepository,
} from "domain/repositories/agent-session.repository.interface";
import { SchedulerLeaseService } from "application/services/scheduler-lease.service";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { AGENT_TASK_REPOSITORY, type IAgentTaskRepository } from "domain/repositories/agent-task.repository.interface";

export const DEFAULT_AGENT_RETENTION_DAYS = 30;

@Injectable()
export class AgentSessionService {
    constructor(
        @Inject(AGENT_SESSION_REPOSITORY) private readonly repository: IAgentSessionRepository,
        private readonly configService: ConfigService,
        private readonly schedulerLease: SchedulerLeaseService,
        @Optional() @Inject(AGENT_TASK_REPOSITORY) private readonly taskRepository?: IAgentTaskRepository,
    ) {}

    list(owner: AgentSessionOwner) {
        return this.repository.list(owner);
    }

    async get(id: string, owner: AgentSessionOwner) {
        const session = await this.repository.findOwned(id, owner);
        if (!session) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        return session;
    }

    async getForRestore(id: string, owner: AgentSessionOwner) {
        const session = await this.repository.findOwnedForRestore(id, owner);
        if (!session) throw new NotFoundException("Agent session not found");
        return session;
    }

    async assertActive(id: string, owner: AgentSessionOwner): Promise<void> {
        await this.get(id, owner);
    }

    create(owner: AgentSessionOwner, locale: string, model: string, agentVersion: string) {
        return this.repository.create({
            ...owner,
            locale,
            model,
            agentVersion,
            expiresAt: this.expiryFromNow(),
        });
    }

    async update(id: string, owner: AgentSessionOwner, patch: AgentSessionPatch) {
        const session = await this.repository.updateOwned(id, owner, patch);
        if (!session) throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        return session;
    }

    async archive(id: string, owner: AgentSessionOwner): Promise<void> {
        const result = await this.repository.archiveOwned(id, owner, new Date());
        if (result === "blocked") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        if (result === "not_found") {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
    }

    async unarchive(id: string, owner: AgentSessionOwner): Promise<void> {
        const result = await this.repository.unarchiveOwned(id, owner);
        if (result === "not_found") {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
    }

    async remove(id: string, owner: AgentSessionOwner) {
        const result = await this.repository.deleteOwned(id, owner);
        if (result === "blocked") {
            throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
        }
        if (result === "not_found") {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
    }

    async appendMessages(id: string, owner: AgentSessionOwner, messages: BjjUIMessage[], traceId?: string) {
        if (!await this.repository.appendMessages(id, owner, messages, traceId)) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
    }

    async upsertActionResultMessage(
        id: string,
        owner: AgentSessionOwner,
        message: BjjUIMessage,
        traceId?: string,
    ): Promise<boolean> {
        if (!await this.repository.upsertActionResultMessage(id, owner, message, traceId)) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        return true;
    }

    clearEntityMemory(id: string, owner: AgentSessionOwner) {
        return this.update(id, owner, { selectedEntities: {} });
    }

    @Cron(CronExpression.EVERY_HOUR)
    cleanupExpired(now = new Date()): Promise<number> {
        if (!this.schedulerLease.holdsLease()) return Promise.resolve(0);
        return this.cleanupTasksThenSessions(now);
    }

    private async cleanupTasksThenSessions(now: Date): Promise<number> {
        // Task payload purge and session deletion share the same scheduler
        // lease.  The task repository performs its own scoped lock/recheck;
        // deleting sessions afterwards preserves action/event evidence for
        // any row that was conservatively retained.
        if (this.taskRepository) await this.taskRepository.purgeExpired(now);
        return this.repository.deleteExpired(now);
    }

    private expiryFromNow(): Date {
        const configured = Number(this.configService.get<string>("AGENT_RETENTION_DAYS"));
        const days = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_AGENT_RETENTION_DAYS;
        return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
}
