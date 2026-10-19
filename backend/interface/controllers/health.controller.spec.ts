import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";

import { HealthController } from "./health.controller";
import { SchedulerLeaseService, type SchedulerLeaseSnapshot } from "application/services/scheduler-lease.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ReadinessService } from "infrastructure/health/readiness.service";
import { listExpectedColumns } from "infrastructure/health/schema-drift";

interface MockResponse {
    setHeader: jest.Mock;
    status: jest.Mock;
}

function createResponse(): MockResponse {
    return {
        setHeader: jest.fn(),
        status: jest.fn(),
    };
}

function createLease(overrides: Partial<SchedulerLeaseSnapshot> = {}): SchedulerLeaseService {
    const snapshot: SchedulerLeaseSnapshot = {
        mode: "required",
        holderId: "lightnode",
        instanceId: "instance-1",
        held: true,
        lastRenewOkAgoMs: 1_000,
        ...overrides,
    };
    return { snapshot: jest.fn(() => snapshot) } as unknown as SchedulerLeaseService;
}

describe("HealthController", () => {
    it("should receive PrismaService through Nest injection and report ready", async () => {
        // Regression: the constructor types prisma as `PrismaService | undefined`,
        // which TypeScript emits as `Object` in design:paramtypes. Under
        // @Optional() Nest then injects undefined instead of failing, and every
        // readiness probe answered 503 — the LightNode deploy of b51f63c75 rolled
        // back on exactly this. Only a real DI container can observe it, so this
        // test compiles a module instead of calling the constructor directly.
        const queryRaw = jest.fn().mockResolvedValue([{ result: 1 }]);
        const moduleRef = await Test.createTestingModule({
            controllers: [HealthController],
            providers: [
                ReadinessService,
                { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
                { provide: SchedulerLeaseService, useValue: createLease() },
            ],
        }).compile();
        const controller = moduleRef.get(HealthController);
        const response = createResponse();

        await expect(controller.getReadiness(response as never)).resolves.toEqual({
            status: "ok",
        });

        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(response.status).toHaveBeenCalledWith(200);
    });

    it("should report process liveness without external dependencies", () => {
        const controller = new HealthController(undefined, new ReadinessService(), createLease());

        expect(controller.getHealth()).toEqual({ status: "ok" });
    });

    it("should report readiness after a successful SELECT 1 and disable caching", async () => {
        const queryRaw = jest.fn().mockResolvedValue([{ result: 1 }]);
        const readiness = new ReadinessService();
        const controller = new HealthController(
            { $queryRaw: queryRaw } as never,
            readiness,
            createLease(),
        );
        const response = createResponse();

        await expect(controller.getReadiness(response as never)).resolves.toEqual({
            status: "ok",
        });

        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(queryRaw.mock.calls[0]?.[0]?.[0]).toBe("SELECT 1");
        expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
        expect(response.status).toHaveBeenCalledWith(200);
        expect(readiness.isReady()).toBe(true);
    });

    it("should return a generic 503 without database details when readiness fails", async () => {
        const databaseMessage = "postgresql://user:password@db.example.test:5432/app?secret=value";
        const queryRaw = jest.fn().mockRejectedValue(new Error(databaseMessage));
        const readiness = new ReadinessService();
        const controller = new HealthController(
            { $queryRaw: queryRaw } as never,
            readiness,
            createLease(),
        );
        const response = createResponse();

        const result = await controller.getReadiness(response as never);

        expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
        expect(response.status).toHaveBeenCalledWith(503);
        expect(result).toEqual({ status: "unavailable" });
        expect(JSON.stringify(result)).not.toContain(databaseMessage);
        expect(readiness.isReady()).toBe(true);
    });

    it("should fail closed without probing the database after process readiness is revoked", async () => {
        const queryRaw = jest.fn().mockResolvedValue([{ result: 1 }]);
        const readiness = new ReadinessService();
        const controller = new HealthController(
            { $queryRaw: queryRaw } as never,
            readiness,
            createLease(),
        );
        const response = createResponse();

        readiness.markNotReady();

        await expect(controller.getReadiness(response as never)).resolves.toEqual({
            status: "unavailable",
        });

        expect(queryRaw).not.toHaveBeenCalled();
        expect(response.status).toHaveBeenCalledWith(503);
    });

    it("should expose the scheduler lease snapshot without the process instance id", () => {
        const controller = new HealthController(undefined, new ReadinessService(), createLease());
        const response = createResponse();

        expect(controller.getLease(response as never)).toEqual({
            mode: "required",
            holderId: "lightnode",
            held: true,
        });
        expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
        expect(response.status).not.toHaveBeenCalled();
    });

    it("should report standby and not held on a passive host", () => {
        const controller = new HealthController(
            undefined,
            new ReadinessService(),
            createLease({ mode: "standby", held: false, lastRenewOkAgoMs: null }),
        );

        expect(controller.getLease(createResponse() as never)).toEqual({
            mode: "standby",
            holderId: "lightnode",
            held: false,
        });
    });

    describe("getSchema", () => {
        const expectedColumns = listExpectedColumns(Prisma.dmmf.datamodel.models);
        const allRows = expectedColumns.map((column) => {
            const dot = column.lastIndexOf(".");
            return { table_name: column.slice(0, dot), column_name: column.slice(dot + 1) };
        });
        let now: number;

        beforeEach(() => {
            now = 1_000_000;
            jest.spyOn(Date, "now").mockImplementation(() => now);
            jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
        });

        afterEach(() => {
            jest.restoreAllMocks();
        });

        function createSchemaController(queryRaw: jest.Mock, readiness = new ReadinessService()) {
            return new HealthController({ $queryRaw: queryRaw } as never, readiness, createLease());
        }

        it("should report ok with the number of checked columns when nothing is missing", async () => {
            const queryRaw = jest.fn().mockResolvedValue(allRows);
            const response = createResponse();

            await expect(
                createSchemaController(queryRaw).getSchema(response as never),
            ).resolves.toEqual({ status: "ok", checkedColumns: expectedColumns.length });

            expect(expectedColumns.length).toBeGreaterThan(0);
            expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
            expect(response.status).toHaveBeenCalledWith(200);
        });

        it("should cast catalog columns to text in the issued SQL", async () => {
            const queryRaw = jest.fn().mockResolvedValue(allRows);

            await createSchemaController(queryRaw).getSchema(createResponse() as never);

            const sql = (queryRaw.mock.calls[0]?.[0] as string[]).join("?");
            expect(sql).toContain("table_name::text");
            expect(sql).toContain("column_name::text");
            expect(sql).toContain("current_schema()");
        });

        it("should report drift as a count without leaking column names and log the list", async () => {
            const [missing, ...rest] = allRows;
            const queryRaw = jest.fn().mockResolvedValue(rest);
            const response = createResponse();

            const result = await createSchemaController(queryRaw).getSchema(response as never);

            expect(result).toEqual({ status: "drift", missingColumns: 1 });
            expect(response.status).toHaveBeenCalledWith(503);
            const body = JSON.stringify(result);
            expect(body).not.toContain(missing?.table_name);
            expect(body).not.toContain(missing?.column_name);
            expect(Logger.prototype.error).toHaveBeenCalledWith(
                expect.stringContaining(`${missing?.table_name}.${missing?.column_name}`),
            );
        });

        it("should cap the logged missing-column list", async () => {
            const queryRaw = jest.fn().mockResolvedValue([]);

            const result = await createSchemaController(queryRaw).getSchema(createResponse() as never);

            expect(result).toEqual({ status: "drift", missingColumns: expectedColumns.length });
            const logged = (Logger.prototype.error as jest.Mock).mock.calls[0]?.[0] as string;
            expect(logged).toContain(`…and ${expectedColumns.length - 50} more`);
        });

        it("should answer unavailable when prisma is undefined", async () => {
            const controller = new HealthController(undefined, new ReadinessService(), createLease());
            const response = createResponse();

            await expect(controller.getSchema(response as never)).resolves.toEqual({
                status: "unavailable",
            });
            expect(response.status).toHaveBeenCalledWith(503);
            expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
        });

        it("should answer unavailable without leaking the error when the query throws", async () => {
            const secret = "postgresql://user:password@db.example.test:5432/app";
            const queryRaw = jest.fn().mockRejectedValue(new Error(secret));
            const response = createResponse();

            const result = await createSchemaController(queryRaw).getSchema(response as never);

            expect(result).toEqual({ status: "unavailable" });
            expect(JSON.stringify(result)).not.toContain(secret);
            expect(response.status).toHaveBeenCalledWith(503);
            expect(Logger.prototype.error).toHaveBeenCalled();
        });

        it("should not cache an unavailable result", async () => {
            const queryRaw = jest
                .fn()
                .mockRejectedValueOnce(new Error("boom"))
                .mockResolvedValueOnce(allRows);
            const controller = createSchemaController(queryRaw);

            await expect(controller.getSchema(createResponse() as never)).resolves.toEqual({
                status: "unavailable",
            });
            await expect(controller.getSchema(createResponse() as never)).resolves.toEqual({
                status: "ok",
                checkedColumns: expectedColumns.length,
            });
            expect(queryRaw).toHaveBeenCalledTimes(2);
        });

        it("should answer unavailable without querying when readiness is revoked", async () => {
            const queryRaw = jest.fn().mockResolvedValue(allRows);
            const readiness = new ReadinessService();
            const controller = createSchemaController(queryRaw, readiness);
            const response = createResponse();

            readiness.markNotReady();

            await expect(controller.getSchema(response as never)).resolves.toEqual({
                status: "unavailable",
            });
            expect(queryRaw).not.toHaveBeenCalled();
            expect(response.status).toHaveBeenCalledWith(503);
        });

        it("should not serve a cached ok after readiness is revoked", async () => {
            const queryRaw = jest.fn().mockResolvedValue(allRows);
            const readiness = new ReadinessService();
            const controller = createSchemaController(queryRaw, readiness);

            await controller.getSchema(createResponse() as never);
            readiness.markNotReady();
            const response = createResponse();

            await expect(controller.getSchema(response as never)).resolves.toEqual({
                status: "unavailable",
            });
            expect(response.status).toHaveBeenCalledWith(503);
            expect(queryRaw).toHaveBeenCalledTimes(1);
        });

        it("should reuse the cached result within 60 seconds and re-query after expiry", async () => {
            const queryRaw = jest.fn().mockResolvedValue(allRows);
            const controller = createSchemaController(queryRaw);

            await controller.getSchema(createResponse() as never);
            now += 59_000;
            const cached = createResponse();
            await expect(controller.getSchema(cached as never)).resolves.toEqual({
                status: "ok",
                checkedColumns: expectedColumns.length,
            });
            expect(cached.status).toHaveBeenCalledWith(200);
            expect(queryRaw).toHaveBeenCalledTimes(1);

            now += 1_000;
            await controller.getSchema(createResponse() as never);
            expect(queryRaw).toHaveBeenCalledTimes(2);
        });

        it("should cache a drift result with its 503 status", async () => {
            const queryRaw = jest.fn().mockResolvedValue(allRows.slice(1));
            const controller = createSchemaController(queryRaw);

            await controller.getSchema(createResponse() as never);
            const second = createResponse();
            await expect(controller.getSchema(second as never)).resolves.toEqual({
                status: "drift",
                missingColumns: 1,
            });
            expect(second.status).toHaveBeenCalledWith(503);
            expect(queryRaw).toHaveBeenCalledTimes(1);
        });

        it("should share one in-flight query between concurrent calls", async () => {
            let release: (rows: typeof allRows) => void = () => undefined;
            const queryRaw = jest.fn().mockReturnValue(
                new Promise<typeof allRows>((resolve) => {
                    release = resolve;
                }),
            );
            const controller = createSchemaController(queryRaw);

            const first = controller.getSchema(createResponse() as never);
            const second = controller.getSchema(createResponse() as never);
            release(allRows);

            await expect(Promise.all([first, second])).resolves.toEqual([
                { status: "ok", checkedColumns: expectedColumns.length },
                { status: "ok", checkedColumns: expectedColumns.length },
            ]);
            expect(queryRaw).toHaveBeenCalledTimes(1);
        });
    });
});
