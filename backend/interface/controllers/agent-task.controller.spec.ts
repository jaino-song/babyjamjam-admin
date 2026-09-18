import { ForbiddenException } from "@nestjs/common";
import { Controller, Get, INestApplication } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AgentTaskConflictException } from "application/agent/agent-task.service";
import { ServiceRecordSentryExceptionFilter } from "infrastructure/observability/service-record-sentry-exception.filter";
import { AgentTaskController } from "./agent-task.controller";

const principal = {
    userId: "user-1",
    branchId: "branch-1",
    globalRole: "admin",
    branchRole: "manager",
};

function response() {
    return { setHeader: jest.fn() };
}

describe("AgentTaskController", () => {
    it("requires the verified tenant principal and sends no-store task responses", async () => {
        const tasks = {
            create: jest.fn().mockResolvedValue({ receipt: {}, snapshot: {} }),
            get: jest.fn().mockResolvedValue({}),
            patch: jest.fn().mockResolvedValue({ receipt: {}, snapshot: {} }),
            command: jest.fn().mockResolvedValue({ receipt: {}, snapshot: {} }),
        };
        const controller = new AgentTaskController(tasks as never);
        const res = response();
        const request = { tenant: principal };

        await expect(controller.create({ sessionId: "s", capabilityId: "clients.create", clientEventId: "e", operations: [] }, request as never, res as never)).resolves.toEqual({ receipt: {}, snapshot: {} });
        expect(tasks.create).toHaveBeenCalledWith(principal, expect.objectContaining({ capabilityId: "clients.create" }));
        expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");

        await controller.get("task-1", request as never, res as never);
        await controller.patch("task-1", { clientEventId: "e", expectedRevision: 1, operations: [] }, request as never, res as never);
        await controller.command("task-1", { clientEventId: "e", expectedRevision: 1, command: "pause" }, request as never, res as never);
        expect(tasks.get).toHaveBeenCalledWith(principal, "task-1");
        expect(tasks.patch).toHaveBeenCalledWith(principal, "task-1", expect.objectContaining({ expectedRevision: 1 }));
        expect(tasks.command).toHaveBeenCalledWith(principal, "task-1", expect.objectContaining({ command: "pause" }));
    });

    it("does not fall back to a body principal", () => {
        const controller = new AgentTaskController({} as never);

        expect(() => controller.get("task-1", { userId: "body-user" } as never, response() as never)).toThrow(ForbiddenException);
    });
});

@Controller("agent-task-conflict-probe")
class AgentTaskConflictProbeController {
    @Get()
    conflict() {
        throw new AgentTaskConflictException("revision");
    }
}

describe("Agent task conflict transport", () => {
    let app: INestApplication;

    beforeAll(async () => {
        const module = await Test.createTestingModule({ controllers: [AgentTaskConflictProbeController] }).compile();
        app = module.createNestApplication();
        app.useGlobalFilters(new ServiceRecordSentryExceptionFilter(app.get(HttpAdapterHost)));
        await app.init();
    });

    afterAll(async () => { await app.close(); });

    it("preserves the bounded unknown task conflict body through the real global filter", async () => {
        const response = await request(app.getHttpServer()).get("/agent-task-conflict-probe").expect(409);
        expect(response.body).toEqual({ code: "AGENT_TASK_CONFLICT", message: "Task input conflict", reason: "revision" });
        expect(JSON.stringify(response.body)).not.toContain("raw");
    });
});
