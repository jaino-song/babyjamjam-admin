import {
    Controller,
    Get,
    Header,
    HttpStatus,
    Inject,
    Logger,
    Optional,
    Res,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Response } from "express";

import { SchedulerLeaseMode, SchedulerLeaseService } from "application/services/scheduler-lease.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ReadinessService } from "infrastructure/health/readiness.service";
import {
    findMissingColumns,
    listExpectedColumns,
    type ExistingColumn,
} from "infrastructure/health/schema-drift";

interface HealthResponse {
    status: "ok";
}

interface ReadinessResponse {
    status: "ok" | "unavailable";
}

type SchemaResponse =
    | { status: "ok"; checkedColumns: number }
    | { status: "drift"; missingColumns: number }
    | { status: "unavailable" };

interface SchemaCheckResult {
    statusCode: number;
    body: SchemaResponse;
}

const SCHEMA_CACHE_TTL_MS = 60_000;
const SCHEMA_LOG_COLUMN_LIMIT = 50;

interface LeaseResponse {
    mode: SchedulerLeaseMode;
    holderId: string;
    held: boolean;
}

@Controller()
export class HealthController {
    private readonly logger = new Logger(HealthController.name);
    private schemaCache: { result: SchemaCheckResult; expiresAt: number } | undefined;
    private schemaInFlight: Promise<SchemaCheckResult> | undefined;

    constructor(
        // The union type compiles to `Object` in design:paramtypes, so Nest
        // needs the explicit token; without it @Optional() silently injects
        // undefined and every readiness probe answers 503.
        @Optional()
        @Inject(PrismaService)
        private readonly prisma: PrismaService | undefined,
        private readonly readiness: ReadinessService,
        private readonly schedulerLease: SchedulerLeaseService,
    ) {}

    @Get("health")
    getHealth(): HealthResponse {
        return { status: "ok" };
    }

    @Get("health/ready")
    @Header("Cache-Control", "no-store")
    async getReadiness(
        @Res({ passthrough: true }) response: Response,
    ): Promise<ReadinessResponse> {
        response.setHeader("Cache-Control", "no-store");

        try {
            if (!this.readiness.isReady()) {
                throw new Error("Application readiness has been revoked");
            }

            if (!this.prisma) {
                throw new Error("Database service is unavailable");
            }

            await this.prisma.$queryRaw`SELECT 1`;
            response.status(HttpStatus.OK);
            return { status: "ok" };
        } catch {
            response.status(HttpStatus.SERVICE_UNAVAILABLE);
            return { status: "unavailable" };
        }
    }

    /**
     * Post-deploy proof that the database THIS process connects to holds every
     * column the Prisma schema expects. Public route: the body carries counts
     * only — never table/column names, SQL or error text (those go to the log).
     */
    @Get("health/schema")
    @Header("Cache-Control", "no-store")
    async getSchema(
        @Res({ passthrough: true }) response: Response,
    ): Promise<SchemaResponse> {
        response.setHeader("Cache-Control", "no-store");

        // Readiness and prisma presence are checked on every call, before the
        // cache, so a cached result is never served after readiness is revoked.
        if (!this.readiness.isReady() || !this.prisma) {
            response.status(HttpStatus.SERVICE_UNAVAILABLE);
            return { status: "unavailable" };
        }

        const now = Date.now();
        if (this.schemaCache && now < this.schemaCache.expiresAt) {
            response.status(this.schemaCache.result.statusCode);
            return this.schemaCache.result.body;
        }

        this.schemaInFlight ??= this.checkSchema(this.prisma).finally(() => {
            this.schemaInFlight = undefined;
        });
        const result = await this.schemaInFlight;
        response.status(result.statusCode);
        return result.body;
    }

    private async checkSchema(prisma: PrismaService): Promise<SchemaCheckResult> {
        try {
            const models = Prisma.dmmf.datamodel.models;
            const existing = await prisma.$queryRaw<ExistingColumn[]>`SELECT table_name::text AS table_name, column_name::text AS column_name FROM information_schema.columns WHERE table_schema = current_schema()`;
            const missing = findMissingColumns(models, existing);

            let result: SchemaCheckResult;
            if (missing.length === 0) {
                result = {
                    statusCode: HttpStatus.OK,
                    body: { status: "ok", checkedColumns: listExpectedColumns(models).length },
                };
            } else {
                const shown = missing.slice(0, SCHEMA_LOG_COLUMN_LIMIT).join(", ");
                const rest = missing.length - SCHEMA_LOG_COLUMN_LIMIT;
                this.logger.error(
                    `Schema drift: ${missing.length} expected column(s) missing: ${shown}${rest > 0 ? ` …and ${rest} more` : ""}`,
                );
                result = {
                    statusCode: HttpStatus.SERVICE_UNAVAILABLE,
                    body: { status: "drift", missingColumns: missing.length },
                };
            }

            this.schemaCache = { result, expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS };
            return result;
        } catch (error) {
            this.logger.error(
                "Schema drift check failed",
                error instanceof Error ? error.stack : String(error),
            );
            return {
                statusCode: HttpStatus.SERVICE_UNAVAILABLE,
                body: { status: "unavailable" },
            };
        }
    }

    /**
     * Which host runs background schedulers right now (ADR-010). Always 200: this is
     * an observation, not a readiness signal — a passive host is healthy AND not holding.
     */
    @Get("health/lease")
    @Header("Cache-Control", "no-store")
    getLease(@Res({ passthrough: true }) response: Response): LeaseResponse {
        response.setHeader("Cache-Control", "no-store");
        const snapshot = this.schedulerLease.snapshot();
        return { mode: snapshot.mode, holderId: snapshot.holderId, held: snapshot.held };
    }
}
