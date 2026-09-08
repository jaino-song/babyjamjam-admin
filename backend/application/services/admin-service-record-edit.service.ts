import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";

import {
    validateServiceRecordAnswers,
    validateServiceRecordEditText,
} from "application/policies/service-record-answer-validation.policy";
import {
    ServiceRecordEditConflictError,
    ServiceRecordEditNotFoundError,
} from "domain/errors/service-record-edit.error";
import {
    SERVICE_RECORD_EDIT_REPOSITORY,
    type CreateServiceRecordEditDraftInput,
    type IServiceRecordEditRepository,
    type ServiceRecordEditDraft,
    type ServiceRecordEditJsonObject,
    type ServiceRecordEditJsonValue,
    type ServiceRecordEditSource,
} from "domain/repositories/service-record-edit.repository.interface";
import type {
    AdminServiceRecordEditChangesDto,
    AdminServiceRecordEditStateDto,
    CreateServiceRecordEditDraftDto,
    DiscardServiceRecordEditDraftDto,
    UpdateServiceRecordEditDraftDto,
} from "interface/dto/admin-service-record-edit.dto";

const EDITABLE_HEADER_KEYS = new Set([
    "momName",
    "momBirth",
    "babyName",
    "babyBirth",
    "deliveryType",
    "babyWeight",
]);
const EDITABLE_SESSION_KEYS = new Set([
    "sessionIndex",
    "serviceDate",
    "answers",
    "etcService",
    "notes",
    "paymentConfirmed",
]);
const MAX_CHANGES_BYTES = 64 * 1024;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SourceSnapshot = ServiceRecordEditSource;

interface LoadedSource {
    source: SourceSnapshot;
    fingerprint: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonValue(value: unknown): ServiceRecordEditJsonValue {
    if (value === null) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map((item) => jsonValue(item));
    if (isPlainRecord(value)) {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, jsonValue(item)]),
        );
    }
    throw new BadRequestException({ code: "SERVICE_RECORD_SOURCE_INVALID" });
}

function stableStringify(value: ServiceRecordEditJsonValue): string {
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    if (isPlainRecord(value)) {
        return `{${Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

function sourceFingerprint(source: SourceSnapshot): string {
    // Lifecycle/retry timestamps and the optimistic case version are kept in
    // the immutable snapshot but deliberately excluded from this business
    // fingerprint. A status-only transition must not invalidate a draft.
    const fingerprintPayload = jsonValue({
        caseId: source.caseId,
        formVersion: source.formVersion,
        requiredSessionCount: source.requiredSessionCount,
        startDate: source.startDate,
        endDate: source.endDate,
        client: {
            id: source.client.id,
            duration: source.client.duration,
            startDate: source.client.startDate,
            endDate: source.client.endDate,
        },
        header: source.header,
        sessions: source.sessions,
        assignments: source.assignments,
        plannedSessions: source.plannedSessions,
    });
    return createHash("sha256").update(stableStringify(fingerprintPayload)).digest("hex");
}

function mapDraft(draft: ServiceRecordEditDraft): ServiceRecordEditDraft {
    return draft;
}

@Injectable()
export class AdminServiceRecordEditService {
    constructor(
        @Inject(SERVICE_RECORD_EDIT_REPOSITORY)
        private readonly repository: IServiceRecordEditRepository,
    ) {}

    async startDraft(
        branchId: string,
        clientId: number,
        actorUserId: string,
        dto: CreateServiceRecordEditDraftDto = {},
    ): Promise<AdminServiceRecordEditStateDto> {
        const loaded = await this.loadSource(branchId, { clientId });
        const changes = this.validateChanges(dto.changes, loaded.source);
        const input: CreateServiceRecordEditDraftInput = {
            branchId,
            serviceRecordCaseId: loaded.source.caseId,
            actorUserId,
            sourceCaseVersion: loaded.source.caseVersion,
            sourceFingerprint: loaded.fingerprint,
            sourceSnapshot: jsonValue({ ...loaded.source, caseVersion: loaded.source.caseVersion }),
            ...(changes ? { changes } : {}),
        };
        let draft: ServiceRecordEditDraft;
        try {
            draft = await this.repository.createOrResumeDraft(input);
        } catch (error) {
            this.throwRepositoryNotFound(error);
        }
        return this.state(draft, loaded);
    }

    async getDraft(branchId: string, clientId: number): Promise<AdminServiceRecordEditStateDto> {
        const loaded = await this.loadSource(branchId, { clientId });
        const draft = await this.repository.findActiveDraft(branchId, loaded.source.caseId);
        return this.state(draft, loaded);
    }

    async updateDraft(
        branchId: string,
        draftId: string,
        actorUserId: string,
        dto: UpdateServiceRecordEditDraftDto,
    ): Promise<AdminServiceRecordEditStateDto> {
        const target = await this.resolveDraftTarget(branchId, draftId);
        const changes = this.validateChanges(dto.changes, target.loaded.source);
        if (!changes) throw new BadRequestException("Draft changes are required");

        let draft: ServiceRecordEditDraft;
        try {
            draft = await this.repository.updateDraft({
                branchId,
                serviceRecordCaseId: target.loaded.source.caseId,
                draftId,
                expectedDraftVersion: dto.expectedDraftVersion,
                actorUserId,
                changes,
            });
        } catch (error) {
            if (error instanceof ServiceRecordEditNotFoundError) this.throwRepositoryNotFound(error);
            await this.throwConflictWithLatest(branchId, target.loaded.source.caseId, draftId, error);
            throw error;
        }
        const latest = await this.loadSource(branchId, { caseId: target.loaded.source.caseId });
        return this.state(draft, latest);
    }

    async discardDraft(
        branchId: string,
        draftId: string,
        actorUserId: string,
        dto: DiscardServiceRecordEditDraftDto,
    ): Promise<AdminServiceRecordEditStateDto> {
        const target = await this.resolveDraftTarget(branchId, draftId);
        let draft: ServiceRecordEditDraft;
        try {
            draft = await this.repository.discardDraft({
                branchId,
                serviceRecordCaseId: target.loaded.source.caseId,
                draftId,
                expectedDraftVersion: dto.expectedDraftVersion,
                actorUserId,
            });
        } catch (error) {
            if (error instanceof ServiceRecordEditNotFoundError) this.throwRepositoryNotFound(error);
            await this.throwConflictWithLatest(branchId, target.loaded.source.caseId, draftId, error);
            throw error;
        }
        const latest = await this.loadSource(branchId, { caseId: target.loaded.source.caseId });
        return this.state(draft, latest);
    }

    private async throwConflictWithLatest(
        branchId: string,
        caseId: string,
        draftId: string,
        error: unknown,
    ): Promise<never> {
        if (!(error instanceof ServiceRecordEditConflictError)) throw error;
        const latest = await this.repository.findDraft(branchId, caseId, draftId);
        const current = await this.loadSource(branchId, { caseId });
        throw new ConflictException({
            code: error.code,
            message: error.message,
            latestDraft: latest ? mapDraft(latest) : null,
            sourceChanged: latest ? latest.sourceFingerprint !== current.fingerprint : false,
            sourceCaseVersion: current.source.caseVersion,
            sourceFingerprint: current.fingerprint,
        });
    }

    private throwRepositoryNotFound(error: unknown): never {
        if (error instanceof ServiceRecordEditNotFoundError) {
            throw new NotFoundException("Service-record edit resource was not found");
        }
        throw error;
    }

    private state(draft: ServiceRecordEditDraft | null, loaded: LoadedSource): AdminServiceRecordEditStateDto {
        return {
            draft: draft ? mapDraft(draft) : null,
            sourceChanged: draft ? draft.sourceFingerprint !== loaded.fingerprint : false,
            sourceCaseVersion: loaded.source.caseVersion,
            sourceFingerprint: loaded.fingerprint,
        };
    }

    private validateChanges(
        raw: AdminServiceRecordEditChangesDto | undefined,
        source: SourceSnapshot,
    ): ServiceRecordEditJsonObject | undefined {
        if (raw === undefined) return undefined;
        if (!isPlainRecord(raw)) throw new BadRequestException("Draft changes must be an object");

        const serialized = JSON.stringify(raw);
        if (typeof serialized !== "string") throw new BadRequestException("Draft changes must be serializable");
        if (Buffer.byteLength(serialized, "utf8") > MAX_CHANGES_BYTES) {
            throw new BadRequestException("제공기록 초안이 너무 큽니다.");
        }

        const unknownRoot = Object.keys(raw).filter((key) => key !== "header" && key !== "sessions");
        if (unknownRoot.length > 0) {
            throw new BadRequestException(`Unknown service-record draft field: ${unknownRoot[0]}`);
        }

        const rawRecord = raw as unknown as Record<string, unknown>;
        const output: ServiceRecordEditJsonObject = {};
        if (rawRecord["header"] !== undefined) output["header"] = this.validateHeader(rawRecord["header"]);
        if (rawRecord["sessions"] !== undefined) output["sessions"] = this.validateSessions(rawRecord["sessions"], source);
        return output;
    }

    private validateHeader(raw: unknown): ServiceRecordEditJsonValue {
        if (!isPlainRecord(raw)) throw new BadRequestException("Draft header must be an object");
        const output: Record<string, ServiceRecordEditJsonValue> = {};
        for (const [key, value] of Object.entries(raw)) {
            if (!EDITABLE_HEADER_KEYS.has(key)) {
                throw new BadRequestException(`Unknown service-record header field: ${key}`);
            }
            if (typeof value !== "string" || value.length > 120) {
                throw new BadRequestException(`Invalid service-record header field: ${key}`);
            }
            output[key] = value.trim();
        }
        return output;
    }

    private validateSessions(raw: unknown, source: SourceSnapshot): ServiceRecordEditJsonValue {
        if (!Array.isArray(raw)) throw new BadRequestException("Draft sessions must be an array");
        if (raw.length > 100) throw new BadRequestException("Too many service-record sessions");

        const maxSessionIndex = source.requiredSessionCount ?? source.sessions.reduce(
            (max, session) => Math.max(max, session.sessionIndex),
            0,
        );
        const seen = new Set<number>();
        const sessions: ServiceRecordEditJsonValue[] = [];
        for (const value of raw) {
            if (!isPlainRecord(value)) throw new BadRequestException("Draft session must be an object");
            const unknownFields = Object.keys(value).filter((key) => !EDITABLE_SESSION_KEYS.has(key));
            if (unknownFields.length > 0) {
                throw new BadRequestException(`Unknown service-record session field: ${unknownFields[0]}`);
            }
            const sessionIndex = value["sessionIndex"];
            if (typeof sessionIndex !== "number" || !Number.isInteger(sessionIndex) || sessionIndex < 1 || sessionIndex > maxSessionIndex) {
                throw new BadRequestException(`Session ${String(sessionIndex)} is outside the contracted range 1..${maxSessionIndex}`);
            }
            if (source.sessions.some((session) => session.sessionIndex === sessionIndex && session.ambiguous)) {
                throw new BadRequestException(`Session ${sessionIndex} has ambiguous legacy source rows`);
            }
            if (seen.has(sessionIndex)) throw new BadRequestException(`Duplicate service-record session: ${sessionIndex}`);
            seen.add(sessionIndex);

            const session: Record<string, ServiceRecordEditJsonValue> = { sessionIndex };
            if (value["serviceDate"] !== undefined) session["serviceDate"] = this.validateDate(value["serviceDate"]);
            if (value["answers"] !== undefined) session["answers"] = jsonValue(validateServiceRecordAnswers(value["answers"]));
            if (value["etcService"] !== undefined) session["etcService"] = validateServiceRecordEditText(value["etcService"], "etcService");
            if (value["notes"] !== undefined) session["notes"] = validateServiceRecordEditText(value["notes"], "notes");
            if (value["paymentConfirmed"] !== undefined) {
                if (typeof value["paymentConfirmed"] !== "boolean") throw new BadRequestException("paymentConfirmed must be boolean");
                session["paymentConfirmed"] = value["paymentConfirmed"];
            }
            sessions.push(session);
        }
        return sessions;
    }

    private validateDate(value: unknown): string {
        if (typeof value !== "string" || !DATE_ONLY_PATTERN.test(value)) {
            throw new BadRequestException("서비스 제공일자는 YYYY-MM-DD 형식이어야 합니다.");
        }
        const parts = value.split("-").map(Number);
        const year = parts[0]!;
        const month = parts[1]!;
        const day = parts[2]!;
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
            throw new BadRequestException("서비스 제공일자가 올바르지 않습니다.");
        }
        return value;
    }

    private async resolveDraftTarget(branchId: string, draftId: string): Promise<{ loaded: LoadedSource }> {
        if (!UUID_PATTERN.test(draftId)) throw new NotFoundException("Service-record draft not found");
        const draft = await this.repository.findDraftById(branchId, draftId);
        if (!draft) throw new NotFoundException("Service-record draft not found");
        return { loaded: await this.loadSource(branchId, { caseId: draft.serviceRecordCaseId }) };
    }

    private async loadSource(
        branchId: string,
        target: { clientId?: number; caseId?: string },
    ): Promise<LoadedSource> {
        const source = await this.repository.loadSource(branchId, target);
        if (!source) throw new NotFoundException("Service-record source was not found");
        return { source, fingerprint: sourceFingerprint(source) };
    }
}
